/*
 * 画布焦点与滚轮助手（本地插件，无构建步骤）
 *
 * 职责：
 *   1. 切回 Excalidraw 画布标签时，把键盘焦点打到内层 .excalidraw-container，
 *      并在按键时兜底转发（否则 V / P / 空格 要先用鼠标点一下画布才生效）。
 *   2. 切标签时把当前视图区域中心（窗口比例）发给本地助手服务，
 *      由它把光标搬进内容区并微抖，唤醒 Chromium 的滚轮目标（TourBox 旋钮用）。
 *   3. 自动拉起 / 结束 helper.py。
 */

import { Notice, MarkdownView, PluginSettingTab, Setting } from "obsidian";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";

const HELPER_PORT = 37250;

const DEFAULT_SETTINGS = {
  enableFocusFix: true,
  enableWheelWake: true,
  helperPython: "C:\\Users\\14785\\AppData\\Local\\Python\\pythoncore-3.14-64\\pythonw.exe",
  autoStartHelper: true,
};

export class FocusHelper {
  constructor(plugin) {
    this.plugin = plugin;
    this.app = plugin.app;
    this.settings = Object.assign({}, DEFAULT_SETTINGS, plugin.settings.focus || {});
  }

  async start() {
    // 日志没有上限，长期会涨到几 MB；启动时超过 2MB 就清空
    try {
      const dir = this.plugin.manifest && this.plugin.manifest.dir;
      if (dir) {
        const lp = path.join(dir, "helper.log");
        if (fs.existsSync(lp) && fs.statSync(lp).size > 2 * 1024 * 1024) fs.writeFileSync(lp, "");
      }
    } catch (err) {
      /* ignore */
    }
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await (this.plugin.settings.focus || {}));
    this.helperProc = null;

    await this.startHelper();

    // ---- 事件 ----
    this.plugin.registerEvent(
      this.app.workspace.on("active-leaf-change", () => {
        this.scheduleRestore("leaf-change");
        if (this.settings.enableWheelWake) {
          if (this._wakeTimer) window.clearTimeout(this._wakeTimer);
      this._wakeTimer = window.setTimeout(() => this.wakeWheel(), 260);
        }
      })
    );
    this.plugin.registerEvent(
      this.app.workspace.on("layout-change", () => this.scheduleRestore("layout-change"))
    );
    this.plugin.registerDomEvent(window, "focus", () => {
      this.scheduleRestore("win-focus");
      if (this.settings.enableWheelWake) {
        if (this._wakeTimer) window.clearTimeout(this._wakeTimer);
      this._wakeTimer = window.setTimeout(() => this.wakeWheel(), 260);
      }
    });

    this.plugin.registerDomEvent(window, "keydown", (ev) => this.keyHandler(ev, "DOWN"), true);
    this.plugin.registerDomEvent(window, "keyup", (ev) => this.keyHandler(ev, "UP"), true);

    // ---- 命令 ----
    this.plugin.addCommand({
      id: "toggle-pen-mouse-mode",
      name: "切换笔/鼠标模式（滚轮唤醒）",
      callback: async () => {
        const mode = await this.helperMode();
        const next = mode === "pen" ? "mouse" : "pen";
        await this.setHelperMode(next);
        new Notice(`滚轮唤醒：${next === "pen" ? "笔模式（会搬光标）" : "鼠标模式（不动光标）"}`);
      },
    });
    this.plugin.addCommand({
      id: "jiggle-now",
      name: "手动抖动光标一次",
      callback: () => this.fetchHelper("/jiggle"),
    });
    this.plugin.addCommand({
      id: "restore-focus-now",
      name: "立即恢复画布焦点",
      callback: () => this.restoreFocus("manual"),
    });

    this.addSettingTab(new CanvasFocusHelperSettingTab(this.app, this));
  }

  onunload() {
    this.stopHelper();
  }

  /* ---------------- 助手进程 ---------------- */

  async startHelper() {
    if (!this.settings.autoStartHelper) return;

    const alive = await this.pingHelper();
    if (alive) {
      console.log("[焦点助手] 助手已在运行，复用");
      return;
    }

    const scriptPath = path.join(this.plugin.manifest.dir || "", "helper.py");
    const abs = this.plugin.manifest.dir
      ? path.join(this.app.vault.adapter.basePath, this.plugin.manifest.dir, "helper.py")
      : scriptPath;

    if (!fs.existsSync(abs)) {
      console.warn("[焦点助手] 找不到 helper.py:", abs);
      return;
    }
    if (!fs.existsSync(this.settings.helperPython)) {
      console.warn("[焦点助手] 找不到 pythonw:", this.settings.helperPython);
      return;
    }

    try {
      this.helperProc = spawn(this.settings.helperPython, [abs], {
        cwd: path.dirname(abs),
        windowsHide: true,
        stdio: "ignore",
      });
      this.helperProc.on("exit", (code) => {
        console.log("[焦点助手] 助手退出 code=", code);
        this.helperProc = null;
      });
      console.log("[焦点助手] 已启动助手", abs);
    } catch (e) {
      console.error("[焦点助手] 启动失败", e);
    }
  }

  stopHelper() {
    if (this.helperProc) {
      try {
        this.helperProc.kill();
      } catch (e) {}
      this.helperProc = null;
    }
  }

  async pingHelper() {
    try {
      const r = await fetch(`http://127.0.0.1:${HELPER_PORT}/ping`, { cache: "no-store" });
      return (await r.text()) === "pong";
    } catch (e) {
      return false;
    }
  }

  async helperMode() {
    try {
      const r = await fetch(`http://127.0.0.1:${HELPER_PORT}/mode`, { cache: "no-store" });
      return (await r.text()).trim();
    } catch (e) {
      return "unknown";
    }
  }

  async setHelperMode(mode) {
    try {
      await fetch(`http://127.0.0.1:${HELPER_PORT}/mode?force=${mode}`, { cache: "no-store" });
    } catch (e) {}
  }

  fetchHelper(pathname) {
    try {
      fetch(`http://127.0.0.1:${HELPER_PORT}${pathname}`, { cache: "no-store" }).catch(() => {});
    } catch (e) {}
  }

  /* ---------------- 滚轮唤醒 ---------------- */

  wakeWheel() {
    try {
      const leaf = this.app.workspace.activeLeaf;
      const view = leaf && leaf.view;
      const el = view && view.containerEl;
      if (!el) return;
      // 用场景画布而非容器：容器含顶部工具栏，回中会偏上
      const cv = el.querySelector("canvas.excalidraw__canvas");
      const r = (cv && cv.clientWidth > 50 ? cv : el).getBoundingClientRect();
      if (!r || r.width < 50 || r.height < 50) return;

      const fx = (r.left + r.width / 2) / window.innerWidth;
      const fy = (r.top + r.height / 2) / window.innerHeight;
      const fw = r.width / window.innerWidth;
      const fh = r.height / window.innerHeight;
      this.fetchHelper(`/point?fx=${fx.toFixed(3)}&fy=${fy.toFixed(3)}&fw=${fw.toFixed(3)}&fh=${fh.toFixed(3)}`);
    } catch (e) {}
  }

  /* ---------------- 画布焦点 ---------------- */

  scheduleRestore(reason) {
    if (!this.settings.enableFocusFix) return;
    [0, 80, 200, 450].forEach((ms) =>
      window.setTimeout(() => this.restoreFocus(`${reason}+${ms}ms`), ms)
    );
  }

  getWrapper() {
    try {
      const leaf = this.app.workspace.activeLeaf;
      const view = leaf && leaf.view;
      if (view && view.getViewType && view.getViewType() === "excalidraw") {
        const w = view.containerEl.querySelector(".excalidraw-wrapper");
        if (w) return w;
      }
    } catch (e) {}
    return document.querySelector(".workspace-leaf.mod-active .excalidraw-wrapper");
  }

  getCanvasTarget(wrapper) {
    return (
      wrapper &&
      (wrapper.querySelector(".excalidraw.excalidraw-container") ||
        wrapper.querySelector(".excalidraw") ||
        wrapper.querySelector("canvas") ||
        wrapper)
    );
  }

  focusCanvas(wrapper) {
    const target = this.getCanvasTarget(wrapper);
    if (!target) return { target: null, ok: false };
    try {
      target.focus({ preventScroll: true });
    } catch (e) {}
    const ok = target === document.activeElement || target.contains(document.activeElement);
    return { target, ok };
  }

  isTyping(el) {
    return (
      !!el &&
      (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable === true)
    );
  }

  restoreFocus(reason) {
    try {
      if (this.isTyping(document.activeElement)) return;
      const wrapper = this.getWrapper();
      if (!wrapper) return;

      const canvasEl = wrapper.querySelector(".excalidraw.excalidraw-container");
      if (canvasEl && canvasEl.contains(document.activeElement)) return;

      const { ok } = this.focusCanvas(wrapper);
      if (!ok) console.log("[焦点助手] 聚焦失败", reason);
    } catch (e) {}
  }

  keyHandler(ev, phase) {
    try {
      if (ev.__focusHelperHandled) return;
      if (ev.ctrlKey || ev.metaKey || ev.altKey) return;

      const wrapper = this.getWrapper();
      if (!wrapper) return;

      const canvasEl = wrapper.querySelector(".excalidraw.excalidraw-container");
      if (canvasEl && canvasEl.contains(document.activeElement)) return;
      if (this.isTyping(document.activeElement)) return;

      const { target, ok } = this.focusCanvas(wrapper);
      if (!ok) return;

      ev.__focusHelperHandled = true;
      ev.stopPropagation();
      ev.preventDefault();

      const clone = new KeyboardEvent(ev.type, {
        key: ev.key,
        code: ev.code,
        location: ev.location,
        repeat: ev.repeat,
        altKey: ev.altKey,
        ctrlKey: ev.ctrlKey,
        metaKey: ev.metaKey,
        shiftKey: ev.shiftKey,
        bubbles: true,
        cancelable: true,
        composed: true,
      });
      clone.__focusHelperHandled = true;
      target.dispatchEvent(clone);
    } catch (e) {}
  }
};

/* ---------------- 设置页 ---------------- */

class CanvasFocusHelperSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h3", { text: "画布焦点与滚轮助手" });

    new Setting(containerEl)
      .setName("恢复画布键盘焦点")
      .setDesc("切回 Excalidraw 标签时自动把焦点打到画布，快捷键立刻可用。")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.enableFocusFix).onChange(async (v) => {
          this.plugin.settings.enableFocusFix = v;
          await this.plugin.saveData(this.plugin.settings);
        })
      );

    new Setting(containerEl)
      .setName("切标签时唤醒滚轮")
      .setDesc("把光标送进内容区中心，让 TourBox 旋钮（=鼠标滚轮）立刻可用。")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.enableWheelWake).onChange(async (v) => {
          this.plugin.settings.enableWheelWake = v;
          await this.plugin.saveData(this.plugin.settings);
        })
      );

    new Setting(containerEl)
      .setName("当前滚轮唤醒模式")
      .setDesc("笔模式会搬动光标；鼠标模式完全不动光标。")
      .addButton((b) =>
        b.setButtonText("切换到笔模式").onClick(async () => {
          await this.plugin.setHelperMode("pen");
          new Notice("已切换到笔模式");
        })
      )
      .addButton((b) =>
        b.setButtonText("切换到鼠标模式").onClick(async () => {
          await this.plugin.setHelperMode("mouse");
          new Notice("已切换到鼠标模式");
        })
      );

    new Setting(containerEl)
      .setName("Python 路径（pythonw.exe）")
      .setDesc("用于启动 helper.py。留空则不自动启动。")
      .addText((t) =>
        t.setValue(this.plugin.settings.helperPython).onChange(async (v) => {
          this.plugin.settings.helperPython = v.trim();
          await this.plugin.saveData(this.plugin.settings);
        })
      );

    new Setting(containerEl)
      .setName("随 Obsidian 启动助手")
      .setDesc("关闭后需要手动运行 helper.py。")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.autoStartHelper).onChange(async (v) => {
          this.plugin.settings.autoStartHelper = v;
          await this.plugin.saveData(this.plugin.settings);
        })
      );

    new Setting(containerEl)
      .setName("助手状态")
      .addButton((b) =>
        b.setButtonText("检查").onClick(async () => {
          const alive = await this.plugin.pingHelper();
          const mode = await this.plugin.helperMode();
          new Notice(alive ? `助手运行中，模式：${mode}` : "助手未响应（检查 Python 路径）");
        })
      );
  }
}
