import { Notice, PluginSettingTab, Setting, requestUrl } from "obsidian";

export const DEFAULT_SETTINGS = {
  /* 导航器 */
  navigatorEnabled: true,
  autoShow: true,
  corner: "br",
  freeLeft: null,
  freeTop: null,
  width: 292,
  height: 210,
  padding: 0,
  innerPadding: 6,
  opacity: 0.95,
  tickMs: 250,
  showViewport: true,
  dimOutside: true,
  highlightSelection: true,
  outlineOnly: false,
  showZoomBadge: true,
  maxFreedrawPoints: 48,
  mapScale: 0.11,
  standardX: 0,
  standardY: 0,

  /* 缩放锚点 */
  centerAnchor: true,

  /* 顺滑缩放 */
  smoothEnabled: true,
  smoothSettleMs: 120,
  suppressHints: true,

  /* 界面语言：zh / en */
  uiLang: "zh",
};

export class MinimapSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  /** 中英双语取词 */
  L(zh, en) {
    return (this.plugin.settings.uiLang || "zh") === "en" ? en : zh;
  }

  display() {
    const { containerEl } = this;
    const s = this.plugin.settings;
    const L = (zh, en) => this.L(zh, en);
    containerEl.replaceChildren();

    const title = document.createElement("h2");
    title.textContent = "Excali Canvas Optimizer";
    containerEl.appendChild(title);

    const intro = document.createElement("p");
    intro.className = "setting-item-description";
    intro.textContent = L(
      "Excalidraw 的配套优化插件：右下角的导航小地图（不缩小也能看清全图）+ 缩放/拖动的冻结渲染（几千笔画也不卡）。不修改文档、不进撤销栈。",
      "A companion optimizer for Excalidraw: a minimap navigator (see the whole drawing without zooming out) plus freeze-based zoom/pan rendering that keeps pages with thousands of strokes smooth. It never modifies your documents or the undo stack."
    );
    containerEl.appendChild(intro);

    /* ---------------- 语言 ---------------- */
    new Setting(containerEl)
      .setName(L("界面语言（Language）", "Language"))
      .setDesc(L("设置页的显示语言，切换后立即生效。", "Language of this settings page. Applies immediately."))
      .addDropdown((d) => {
        d.addOption("zh", "中文");
        d.addOption("en", "English");
        return d.setValue(s.uiLang || "zh").onChange(async (v) => {
          s.uiLang = v;
          await this.plugin.saveSettingsAndSync();
          this.display();
        });
      });

    /* ---------------- 常用 ---------------- */
    containerEl.createEl("h3", { text: L("常用", "General") });

    new Setting(containerEl)
      .setName(L("显示导航小地图", "Show navigator minimap"))
      .setDesc(
        L(
          "在 Excalidraw 画布角落显示缩略地图；关掉后不挂面板、不轮询。",
          "Show a thumbnail of the whole drawing in the canvas corner. Turning it off unmounts the panel and stops polling."
        )
      )
      .addToggle((t) =>
        t.setValue(s.navigatorEnabled !== false).onChange(async (v) => {
          s.navigatorEnabled = v;
          await this.plugin.saveSettingsAndSync();
        })
      );

    new Setting(containerEl)
      .setName(L("缩放锚点固定在画布中心", "Lock zoom anchor to canvas center"))
      .setDesc(
        L(
          "开启后缩放始终围绕画布中心；关闭则跟随光标。TourBox 这类滚轮设备建议在驱动里把旋钮映射成纯键盘按键（Ctrl+= 放大、Ctrl+- 缩小、Ctrl+0 复位）：光标不在画布上时滚轮事件不会传给画布，插件接不到。",
          "When on, zooming always pivots on the canvas center; when off, it follows the cursor. For wheel devices such as TourBox, map the knob to plain keys instead (Ctrl+= zoom in, Ctrl+- zoom out, Ctrl+0 reset): wheel events outside the canvas are consumed by Obsidian and never reach the plugin."
        )
      )
      .addToggle((t) =>
        t.setValue(s.centerAnchor !== false).onChange(async (v) => {
          s.centerAnchor = v;
          await this.plugin.saveSettingsAndSync();
        })
      );

    new Setting(containerEl)
      .setName(L("顺滑缩放", "Smooth zoom"))
      .setDesc(
        L(
          "缩放时冻结画面、只移动一张位图，停手后再渲染高清。关掉就是 Excalidraw 原生行为。",
          "Freeze the current frame during zoom gestures, move a single bitmap, then render once on release. Turn off for native Excalidraw behaviour."
        )
      )
      .addToggle((t) =>
        t.setValue(s.smoothEnabled !== false).onChange(async (v) => {
          s.smoothEnabled = v;
          if (this.plugin.smooth) {
            this.plugin.smooth.enabled = v;
            if (!v) this.plugin.smooth.commit();
          }
          await this.plugin.saveSettingsAndSync();
        })
      );

    new Setting(containerEl)
      .setName(L("关闭画布提示（Show hint）", "Suppress “Show hint”"))
      .setDesc(
        L(
          "Excalidraw 那条操作提示每次打开都会自己回来，这里在进入画布和切换标签后自动关掉。",
          "Excalidraw re-enables its hint on every open; this turns it off whenever you enter a drawing or switch tabs."
        )
      )
      .addToggle((t) =>
        t.setValue(s.suppressHints !== false).onChange(async (v) => {
          s.suppressHints = v;
          await this.plugin.saveSettingsAndSync();
        })
      );

    new Setting(containerEl)
      .setName(L("停手判定", "Settle delay"))
      .setDesc(
        L(
          "停手后等多久才渲染高清（毫秒）。越大越省 CPU，但变清晰更慢；缩得很小时会自动再延长。",
          "How long to wait after you stop before rendering at full quality (ms). Larger saves CPU but sharpens later; it extends automatically when zoomed far out."
        )
      )
      .addSlider((sl) =>
        sl
          .setLimits(120, 600, 20)
          .setValue(s.smoothSettleMs || 120)
          .setDynamicTooltip()
          .onChange(async (v) => {
            s.smoothSettleMs = v;
            await this.plugin.saveSettingsAndSync();
          })
      );

    /* ---------------- 高级 ---------------- */
    containerEl.createEl("h3", { text: L("高级", "Advanced") });

    new Setting(containerEl)
      .setName(L("小地图刷新间隔", "Minimap refresh interval"))
      .setDesc(
        L(
          "多久重新采样一次主画布状态。数值越大越省 CPU，但蓝框与小地图跟手会变迟钝；越小越跟手、开销越高。拖动主画布时会自动提速到 60 毫秒。",
          "How often the minimap re-samples the canvas. Larger values save CPU but make the viewport box lag; smaller values feel smoother but cost more. It speeds up to 60 ms while you are panning."
        )
      )
      .addSlider((sl) =>
        sl
          .setLimits(60, 600, 10)
          .setValue(Number(s.tickMs) || 250)
          .setDynamicTooltip()
          .onChange(async (v) => {
            s.tickMs = v;
            await this.plugin.saveSettingsAndSync();
          })
      );

    new Setting(containerEl)
      .setName(L("重置所有设置", "Reset all settings"))
      .setDesc(
        L(
          "把本插件的全部设置恢复为默认值（含面板位置、尺寸、缩放比例）。",
          "Restore every setting to its default value, including panel position, size and map scale."
        )
      )
      .addButton((b) =>
        b
          .setButtonText(L("全部重置", "Reset"))
          .setWarning()
          .onClick(async () => {
            Object.assign(this.plugin.settings, DEFAULT_SETTINGS);
            await this.plugin.saveSettingsAndSync();
            this.plugin.sync();
            this.display();
            new Notice(L("已恢复默认设置", "Settings reset to defaults"));
          })
      );

    new Setting(containerEl)
      .setName(L("检测更新", "Check for updates"))
      .setDesc(L("从 GitHub 检查是否有新版本（当前 v" + this.plugin.manifest.version + "）", "Check GitHub for a newer release (current v" + this.plugin.manifest.version + ")"))
      .addButton((b) =>
        b.setButtonText(L("检测", "Check")).onClick(async () => {
          const cur = this.plugin.manifest.version;
          const repo = "https://github.com/changxi4848/excalidraw-canvas-optimizer";
          try {
            const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 10000));
            const req = requestUrl({
              url: "https://api.github.com/repos/changxi4848/excalidraw-canvas-optimizer/releases/latest",
              headers: { "User-Agent": "obsidian-excali-canvas-optimizer" },
              throw: false,
            });
            const res = await Promise.race([req, timeout]);
            if (!res || res.status >= 400) {
              new Notice(L("检测失败：GitHub 返回 " + (res ? res.status : "无响应") + "。可能是网络无法访问 GitHub。\n发布页：" + repo + "/releases", "Check failed: GitHub returned " + (res ? res.status : "no response") + ". The network may not reach GitHub.\nReleases: " + repo + "/releases"), 15000);
              return;
            }
            const data = res.json || {};
            const tag = String(data.tag_name || "");
            const latest = tag.replace(/^v/i, "");
            if (!latest) {
              new Notice(L("GitHub 上还没有发布版本\n" + repo + "/releases", "No release published yet\n" + repo + "/releases"), 10000);
              return;
            }
            if (latest === cur) new Notice(L("已是最新版本 v", "You are on the latest version v") + cur);
            else new Notice(L("发现新版本 " + tag + "（当前 v" + cur + "）\n" + (data.html_url || repo + "/releases"), "New version " + tag + " available (current v" + cur + ")\n" + (data.html_url || repo + "/releases")), 15000);
          } catch (err) {
            const msg = String(err && err.message ? err.message : err);
            if (msg === "timeout") {
              new Notice(L("检测超时：10 秒没连上 GitHub。需要代理才能访问。\n发布页：" + repo + "/releases", "Timed out: could not reach GitHub within 10 s. A proxy may be required.\nReleases: " + repo + "/releases"), 15000);
            } else {
              new Notice(L("检测失败：" + msg + "\n可能是网络无法访问 GitHub。发布页：" + repo + "/releases", "Check failed: " + msg + "\nGitHub may be unreachable.\nReleases: " + repo + "/releases"), 15000);
            }
          }
        })
      );

    /* ---------------- 关于 ---------------- */
    containerEl.createEl("h3", { text: L("关于", "About") });

    const aboutLines = L(
      [
        "Excali Canvas Optimizer  v" + this.plugin.manifest.version,
        "作者：卢长希  https://github.com/changxi4848",
        "Excalidraw 的第三方辅助优化插件，个人开发维护，仅供学习使用参考，仅支持 Windows 桌面端。",
        "",
        "两个功能：导航小地图 + 缩放/拖动性能优化。",
        "导航小地图：缩略图只画色块与折线，几千笔画也能看清全局；切标签自动刷新，开关即时生效。",
        "性能优化：缩放与拖动时冻结画面、只移动一张位图，停手后渲染一帧高清，避免每帧全量重绘。",
        "",
        "小地图手势：点击 = 把主画布移过去；拖亮色区 = 移动视口；拖暗色区 = 拖地图并设定标准位置；滚轮 = 缩放地图；Shift+拖 = 锁轴；双击 = 整张图。",
        "面板手势：拖三颗点 = 移动；拖右下角 = 改大小；◎ = 回正；底部横条 = 缩放地图（越靠边越精细）。",
        "主画布缩放：Ctrl+滚轮 / 触摸板双指 / Ctrl+= 放大 / Ctrl+- 缩小 / Ctrl+0 复位。",
        "主画布平移：Alt+方向键 / 空格+拖 / 中键拖 / 手型工具。",
      ],
      [
        "Excali Canvas Optimizer  v" + this.plugin.manifest.version,
        "Author: Lu Changxi  https://github.com/changxi4848",
        "A third-party companion optimizer for Excalidraw. Personal project, provided as-is for learning and reference. Windows desktop only.",
        "",
        "Two features: navigator minimap + smooth zoom/pan.",
        "Minimap: draws only blocks and polylines, so thousands of strokes stay readable; refreshes on tab switch and toggles instantly.",
        "Smooth zoom/pan: freezes the frame during gestures, moves one bitmap, then renders once on release instead of re-rendering every frame.",
        "",
        "Minimap: click = jump the canvas there; drag the blue box = pan; drag the dim area = move the map and set a new standard position; wheel = zoom the map; Shift+drag = lock an axis; double-click = fit the drawing.",
        "Panel: drag the three dots = move; drag the bottom-right corner = resize; ◎ = recenter; bottom bar = zoom the map (finer towards the edges).",
        "Canvas zoom: Ctrl+wheel / trackpad pinch / Ctrl+= / Ctrl+- / Ctrl+0.",
        "Canvas pan: Alt+arrow keys / Space+drag / middle-drag / hand tool.",
      ]
    );

    for (const line of aboutLines) {
      const p = document.createElement("p");
      p.className = "setting-item-description";
      p.textContent = line;
      containerEl.appendChild(p);
    }
  }
}
