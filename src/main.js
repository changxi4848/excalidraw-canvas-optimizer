/**
 * Obsidian 插件入口：把"轻量导航小地图"挂到 Excalidraw 画布上。
 *
 * 为什么单独做插件而不是改 Excalidraw 的渲染：
 *   Excalidraw 缩小后卡，是因为它要把每个元素的笔画（手绘点、粗糙纹理）全部重画一遍。
 *   小地图在另一块 canvas 上只画"色块 + 折线"，与主画布的元素数量无关地便宜，
 *   所以可以一边保持 100% 缩放继续写，一边看整张图的布局。
 */

import { Notice, Plugin } from "obsidian";
import { clamp, scrollToPinScenePoint, viewportSizeOf, zoomOf } from "./geometry.js";
import { MinimapPanel } from "./panel.js";
import { DEFAULT_SETTINGS, MinimapSettingTab } from "./settings.js";
import { SmoothZoom } from "./smooth.js";
import { FocusHelper } from "./focus.js";

const EXCALIDRAW_VIEW = "excalidraw";

export default class ExcalidrawMinimapPlugin extends Plugin {
  async onload() {
    const saved = await this.loadData();
    this.settings = Object.assign({}, DEFAULT_SETTINGS, saved || {});
    if (!saved) {
      // 从旧的两个插件迁移一次配置（导航器 + 顺滑缩放）
      try {
        const raw = await this.app.vault.adapter.read(".obsidian/plugins/excalidraw-minimap/data.json");
        const legacy = JSON.parse(raw);
        this.settings = Object.assign({}, DEFAULT_SETTINGS, legacy, { navigatorEnabled: true });
      } catch (err) { /* 没有旧配置就用默认 */ }
    }
    /** @type {Map<object, MinimapPanel>} */
    this.panels = new Map();
    this.pending = new Map();
    /** 用户手动开关过的叶子：show / hide（没记录就听 autoShow） */
    this.leafState = new Map();
    this.panMethod = "updateScene";
    this._verify = null;
    this._raf = null;
    this._saveTimer = null;
    this._syncTimer = null;

    // ---- 稳定性：模块隔离 / 失败计数 ----
    this._failures = new Map();
    this._moduleErrors = {};

    this.smooth = new SmoothZoom(this);
    this.focus = new FocusHelper(this);
    if (this.settings.inputMode === "pen") {
      try { await this.focus.start(); } catch (err) { this._moduleErrors.focus = String(err && (err.message || err)); console.warn("[optimizer] 笔模式助手启用失败", err); }
    }
    this.smooth.enabled = this.settings.smoothEnabled !== false;
    try {
      this.smooth.start();
    } catch (err) {
      this._moduleErrors.smooth = String(err && (err.message || err));
      console.error("[optimizer] 顺滑缩放启用失败", err);
    }

    this.addRibbonIcon("map", "切换 Excalidraw 小地图", () => this.toggleActive());

    this.addCommand({
      id: "toggle-minimap",
      name: "切换当前画布的小地图",
      callback: () => this.toggleActive(),
    });

    this.addCommand({
      id: "fit-minimap-bounds",
      name: "小地图：把视口拉回全部内容",
      callback: () => this.fitViewport(),
    });

    this.addSettingTab(new MinimapSettingTab(this.app, this));

    this.registerEvent(this.app.workspace.on("layout-change", () => this.scheduleSync()));
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => {
      for (const p of this.panels.values()) {
        p._st = null;
        p._items = null;
        p._vw = 0;
        p._vh = 0;
        p._painted = false;
        p._layerDirty = true;
        p._followAt = performance.now();
      }
      this.scheduleSync();
      const leaf = this.app.workspace.activeLeaf;
      const v = leaf && leaf.view;
      if (v && v.getViewType && v.getViewType() === EXCALIDRAW_VIEW) this.suppressHints(v);
    }));
    this.registerEvent(this.app.workspace.on("file-open", () => this.scheduleSync()));
    this.register(() => {
      if (this._tickTimer) window.clearTimeout(this._tickTimer);
      if (this._syncTimer) window.clearTimeout(this._syncTimer);
      if (this._saveTimer) window.clearTimeout(this._saveTimer);
      if (this._raf) cancelAnimationFrame(this._raf);
    });

    this.app.workspace.onLayoutReady(() => this.scheduleSync());
    this.scheduleTick();
  }

  moduleHealth() {
    return { errors: this._moduleErrors || {}, failures: Array.from((this._failures || new Map()).entries()) };
  }

  onunload() {
    if (this._pendingTimer) { clearInterval(this._pendingTimer); this._pendingTimer = null; }
    this.pending.clear();
    if (this.focus) { try { this.focus.stop(); } catch (err) { /* ignore */ } }
    if (this.smooth) this.smooth.stop();
    for (const panel of this.panels.values()) panel.unmount();
    this.panels.clear();
  }

  /* --------------------------------------------------------- 设置 */

  saveSettings() {
    if (this._saveTimer) window.clearTimeout(this._saveTimer);
    this._saveTimer = window.setTimeout(() => {
      this._saveTimer = null;
      this.saveData(this.settings);
    }, 250);
  }

  /** 设置页改"地图比例"：立刻套到所有面板上（不动它们的中心）。 */
  /** 关掉 Excalidraw 的"显示提示"：不同版本字段名不同，凡是带 hint 的布尔值一律关掉 */
  suppressHints(view) {
    if (!view || this.settings.suppressHints === false) return;
    const api = view.excalidrawAPI;
    if (!api || typeof api.getAppState !== "function") return;
    try {
      const st = api.getAppState();
      const patch = {};
      for (const k of Object.keys(st)) {
        if (/hint/i.test(k) && st[k] === true) patch[k] = false;
      }
      if (Object.keys(patch).length) {
        api.updateScene({ appState: patch, captureUpdate: "NEVER" });
      }
    } catch (err) {
      /* ignore */
    }
  }

  async setInputMode(mode) {
    this.settings.inputMode = mode;
    await this.saveData(this.settings);
    // 设置变化后立刻重新挂载/卸载面板（否则关掉导航器不会马上消失）
    this.safe("navigator", () => this.sync());
    try {
      if (mode === "pen") await this.focus.start();
      else this.focus.stop();
    } catch (err) {
      console.warn("[optimizer] focus toggle failed", err);
    }
  }

  async setMapScale(scale) {
    this.settings.mapScale = scale;
    await this.saveData(this.settings);
    for (const panel of this.panels.values()) panel.applyMapScale(scale);
  }

  async saveSettingsAndSync() {
    if (this._saveTimer) {
      window.clearTimeout(this._saveTimer);
      this._saveTimer = null;
    }
    await this.saveData(this.settings);
    for (const panel of this.panels.values()) {
      panel.applyLayout();
      panel.invalidate();
    }
    this.safe("tick", () => this.tickAll());
  }

  /* --------------------------------------------------------- 面板生命周期 */

  scheduleSync() {
    if (this._syncTimer) window.clearTimeout(this._syncTimer);
    this._syncTimer = window.setTimeout(() => {
      this._syncTimer = null;
      this.safe("navigator", () => this.sync());
    }, 120);
  }

  shouldShow(leaf) {
    const state = this.leafState.get(leaf);
    if (state === "show") return true;
    if (state === "hide") return false;
    return Boolean(this.settings.autoShow);
  }

  /** 当前活动叶（兼容新旧 API）。 */
  activeLeaf() {
    const workspace = this.app.workspace;
    if (typeof workspace.getMostRecentLeaf === "function") {
      const leaf = workspace.getMostRecentLeaf();
      if (leaf) return leaf;
    }
    return workspace.activeLeaf || null;
  }

  /** 轮询待挂载的画布：加载完（能拿到 canvas）就挂上小地图 */
  ensurePendingLoop() {
    if (this._pendingTimer) return;
    this._pendingTimer = setInterval(() => {
      const now = performance.now();
      for (const [leaf, at] of Array.from(this.pending.entries())) {
        const alive = leaf && leaf.view && leaf.view.containerEl && leaf.view.containerEl.isConnected;
        if (!alive || now - at > 15000) this.pending.delete(leaf);
      }
      if (!this.pending.size) {
        clearInterval(this._pendingTimer);
        this._pendingTimer = null;
        return;
      }
      this.safe("navigator", () => this.sync());
    }, 150);
  }

  /** 稳定性包装：同一处连续失败 5 次就停用该功能并提示，避免无声劣化 */
  safe(name, fn, fallback) {
    try {
      const out = fn();
      this._failures.delete(name);
      return out;
    } catch (err) {
      const n = (this._failures.get(name) || 0) + 1;
      this._failures.set(name, n);
      if (n === 1 || n === 5) console.warn("[optimizer] " + name + " 失败 " + n + " 次", err);
      if (n === 5) {
        this._moduleErrors[name] = String(err && (err.message || err));
        if (name === "smooth" && this.smooth) this.smooth.enabled = false;
        if (name === "navigator") this.settings.navigatorEnabled = false;
        new Notice("Excali 画布优化：" + name + " 连续出错，已自动停用");
      }
      return fallback;
    }
  }

  sync() {
    // 侧边栏开合会改变画布尺寸：把每个面板的视口缓存清掉，下一帧按新尺寸重算
    for (const p of this.panels.values()) {
      p._st = null;
      p._vw = 0;
      p._vh = 0;
      p._painted = false;
      p._layerDirty = true;
      p._followAt = performance.now(); // 刚重算过，别立刻触发"跟随回正"，否则地图会闪一下
    }
    if (this.settings.navigatorEnabled === false) {
      for (const panel of this.panels.values()) panel.unmount();
      this.panels.clear();
      return;
    }
    let leaves = [];
    try {
      leaves = this.app.workspace.getLeavesOfType(EXCALIDRAW_VIEW);
    } catch (err) {
      leaves = [];
    }
    const live = new Set(leaves);

    for (const [leaf, panel] of Array.from(this.panels.entries())) {
      const view = leaf.view;
      const stale =
        !live.has(leaf) ||
        !view ||
        panel.leaf.view !== view ||
        !view.containerEl ||
        !view.containerEl.isConnected ||
        !panel.el ||
        !panel.el.isConnected ||
        (panel._container !== view.containerEl);
      if (stale) {
        panel.unmount();
        this.panels.delete(leaf);
      }
    }

    for (const leaf of leaves) {
      if (!this.shouldShow(leaf)) {
        const panel = this.panels.get(leaf);
        if (panel) {
          panel.unmount();
          this.panels.delete(leaf);
        }
        continue;
      }
      let panel = this.panels.get(leaf);
      if (!panel || panel.leaf.view !== leaf.view) {
        if (panel) {
          panel.unmount();
          this.panels.delete(leaf);
        }
        panel = new MinimapPanel(this, leaf);
        if (!panel.mount()) {
          panel.unmount();
          // 画布还没加载完：放进待挂载队列，轮询到它就绪再挂
          this.pending.set(leaf, performance.now());
          this.ensurePendingLoop();
          continue;
        }
        this.pending.delete(leaf);
        panel._container = leaf.view.containerEl;
        this.panels.set(leaf, panel);
        this.suppressHints(leaf.view);
      } else {
        panel.applyLayout();
      }
    }

    for (const key of Array.from(this.leafState.keys())) {
      if (!live.has(key)) this.leafState.delete(key);
    }

    this.safe("tick", () => this.tickAll());
  }

  toggleActive() {
    const leaf = this.activeLeaf();    const view = leaf && leaf.view;
    if (!view || !view.getViewType || view.getViewType() !== EXCALIDRAW_VIEW) {
      new Notice("请先打开一张 Excalidraw 画布");
      return;
    }
    const showing = this.shouldShow(leaf);
    this.leafState.set(leaf, showing ? "hide" : "show");
    this.safe("navigator", () => this.sync());
  }

  /* --------------------------------------------------------- 轮询 */

  scheduleTick() {
    if (this._tickTimer) window.clearTimeout(this._tickTimer);
    const base = Math.max(60, Number(this.settings.tickMs) || 250);
    // 主画布正在动的时候临时提速，让小地图的蓝框跟手
    const now = performance.now();
    let fast = false;
    for (const panel of this.panels.values()) {
      if (panel._movedAt && now - panel._movedAt < 700) {
        fast = true;
        break;
      }
    }
    const delay = fast ? Math.min(60, base) : base;
    this._tickTimer = window.setTimeout(() => {
      this._tickTimer = null;
      this.safe("tick", () => this.tickAll());
      this.scheduleTick();
    }, delay);
  }

  tickAll() {
    if (this.settings.navigatorEnabled === false) return;
    // 兜底收敛：活动画布没有面板（或面板被重建掉了）就补挂，最多每 250ms 检查一次
    try {
      const leaf = this.app.workspace.activeLeaf;
      const v = leaf && leaf.view;
      if (v && v.getViewType && v.getViewType() === EXCALIDRAW_VIEW && v.containerEl && v.containerEl.isConnected) {
        const panel = this.panels.get(leaf);
        if (panel && panel.el && !panel.el.isConnected) {
          panel.unmount();
          this.panels.delete(leaf);
          this.scheduleSync();
        } else if (!panel && this.shouldShow(leaf)) {
          this.scheduleSync();
        }
      }
    } catch (err) {
      /* ignore */
    }

    if (document.hidden) return;
    for (const panel of this.panels.values()) {
      try {
        panel.tick(performance.now());
      } catch (err) {
        console.error("[excalidraw-minimap] 绘制失败", err);
      }
    }
    this.checkViewportCalibration();
  }

  /* --------------------------------------------------------- 视口操作 */

  canvasSizeOf(view, appState) {
    const size = viewportSizeOf(appState, null);
    if (size.width > 1 && size.height > 1) return size;
    const canvas = view.containerEl && view.containerEl.querySelector("canvas");
    if (canvas && canvas.clientWidth > 1) {
      return { width: canvas.clientWidth, height: canvas.clientHeight };
    }
    return { width: 800, height: 600 };
  }

  panTo(view, sceneX, sceneY) {
    const api = view && view.excalidrawAPI;
    if (!api || typeof api.getAppState !== "function") return;
    const st = api.getAppState();
    if (!st) return;
    const size = this.canvasSizeOf(view, st);
    const zoom = zoomOf(st);
    const scrollX = size.width / (2 * zoom) - sceneX;
    const scrollY = size.height / (2 * zoom) - sceneY;
    this.applyViewport(view, { scrollX, scrollY }, { x: sceneX, y: sceneY });
    this.queueVerify(view, scrollX, scrollY);
  }

  zoomAt(view, scenePoint, viewportX, viewportY, nextZoom) {
    const api = view && view.excalidrawAPI;
    if (!api || typeof api.getAppState !== "function") return;
    const st = api.getAppState();
    if (!st) return;
    const next = scrollToPinScenePoint(scenePoint.x, scenePoint.y, viewportX, viewportY, nextZoom, st);
    this.applyViewport(view, next, null);
  }

  /** 小地图的"回到全部内容"：等价于主画布的 Shift+1，但不需要先点到画布。 */
  fitViewport() {
    const leaf = this.activeLeaf();
    const view = leaf && leaf.view;
    const api = view && view.excalidrawAPI;
    if (!api || typeof api.getSceneElements !== "function") return;
    if (typeof api.scrollToContent === "function") {
      const els = (api.getSceneElements() || []).filter((el) => el && !el.isDeleted);
      api.scrollToContent(els, { fitToViewport: true, viewportZoomFactor: 0.9 });
      return;
    }
  }

  applyViewport(view, patch, anchor) {
    const api = view && view.excalidrawAPI;
    if (!api) return false;

    if (this.panMethod === "setViewport" && anchor && typeof api.setViewport === "function" && !Number.isFinite(patch.zoom)) {
      try {
        api.setViewport({ target: { x: anchor.x, y: anchor.y, width: 0, height: 0 }, fit: "none" });
        return true;
      } catch (err) {
        console.warn("[excalidraw-minimap] setViewport 失败，退回 updateScene", err);
        this.panMethod = "updateScene";
      }
    }

    const appState = {};
    if (Number.isFinite(patch.scrollX)) appState.scrollX = patch.scrollX;
    if (Number.isFinite(patch.scrollY)) appState.scrollY = patch.scrollY;
    if (Number.isFinite(patch.zoom)) appState.zoom = { value: clamp(patch.zoom, 0.1, 30) };
    try {
      // captureUpdate:"NEVER" 是 Excalidraw 的官方常量值，避免平移/缩放污染撤销栈
      api.updateScene({ appState, captureUpdate: "NEVER" });
      return true;
    } catch (err) {
      console.error("[excalidraw-minimap] updateScene 失败", err);
      return false;
    }
  }

  /**
   * 不同 Excalidraw 版本对"用 updateScene 改 scrollX/Y"的支持不完全一致。
   * 第一次平移后核对一下真实视口：没动就自动切到官方 setViewport。
   */
  queueVerify(view, expectedX, expectedY) {
    if (this._verify && this._verify.confirmed) return;
    this._verify = { view, expectedX, expectedY, at: Date.now(), confirmed: false };
  }

  checkViewportCalibration() {
    const check = this._verify;
    if (!check || check.confirmed) return;
    if (Date.now() - check.at < 500) return;
    const api = check.view && check.view.excalidrawAPI;
    if (!api || typeof api.getAppState !== "function") {
      this._verify = null;
      return;
    }
    const st = api.getAppState();
    if (!st) {
      this._verify = null;
      return;
    }
    const dx = Math.abs(st.scrollX - check.expectedX);
    const dy = Math.abs(st.scrollY - check.expectedY);
    if (dx > 2 || dy > 2) {
      if (typeof api.setViewport === "function") {
        console.info("[excalidraw-minimap] updateScene 未改变视口，改用 setViewport");
        this.panMethod = "setViewport";
      }
    }
    check.confirmed = true;
    this._verify = null;
  }
}
