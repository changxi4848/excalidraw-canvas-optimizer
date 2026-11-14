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

  /* 交互模式 */
  centerAnchor: true,
  inputMode: "mouse",

  /* 顺滑缩放 */
  smoothEnabled: true,
  smoothSettleMs: 120,
  suppressHints: true,
};

export class MinimapSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    const s = this.plugin.settings;
    containerEl.replaceChildren();

    const title = document.createElement("h2");
    title.textContent = "Excali 画布优化";
    containerEl.appendChild(title);

    const intro = document.createElement("p");
    intro.className = "setting-item-description";
    intro.textContent =
      "两块功能：①右下角的导航小地图——不缩小主画布也能看清整张图的位置和对齐；②顺滑缩放——缩放时先冻结画面，停手后再渲染高清，几千笔画也不卡。";
    containerEl.appendChild(intro);

    /* ---------------- 常用 ---------------- */
    containerEl.createEl("h3", { text: "常用" });

    new Setting(containerEl)
      .setName("显示导航小地图")
      .setDesc("关掉后不挂面板、不轮询；需要时可用左侧栏图标或命令唤出。")
      .addToggle((t) =>
        t.setValue(s.navigatorEnabled !== false).onChange(async (v) => {
          s.navigatorEnabled = v;
          await this.plugin.saveSettingsAndSync();
        })
      );

    new Setting(containerEl)
      .setName("缩放锚点固定在画布中心")
      .setDesc("开启后缩放始终围绕画布中心；关闭则跟随光标。TourBox 这类滚轮设备建议在驱动里把旋钮映射成纯键盘按键（Ctrl+= 放大、Ctrl+- 缩小、Ctrl+0 复位）：光标不在画布上时滚轮事件不会传给画布，插件接不到。")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.centerAnchor !== false).onChange(async (v) => {
          this.plugin.settings.centerAnchor = v;
          await this.plugin.saveSettingsAndSync();
        })
      );

    new Setting(containerEl)
      .setName("顺滑缩放")
      .setDesc("缩放时冻结画面、只移动一张位图，停手后再渲染高清。关掉就是 Excalidraw 原生行为。")
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
      .setName("关闭画布提示（Show hint）")
      .setDesc("Excalidraw 那条“要移动画布，请按住…”的提示每次重启都会自己回来，这里每次进入画布时自动关掉。")
      .addToggle((t) =>
        t.setValue(s.suppressHints !== false).onChange(async (v) => {
          s.suppressHints = v;
          await this.plugin.saveSettingsAndSync();
        })
      );

    new Setting(containerEl)
      .setName("停手判定")
      .setDesc("停手后等多久才渲染高清（毫秒）。越大越省 CPU，但变清晰更慢；缩得很小时插件会自动再延长。")
      .addSlider((sl) =>
        sl
          .setLimits(120, 600, 20)
          .setValue(s.smoothSettleMs || 260)
          .setDynamicTooltip()
          .onChange(async (v) => {
            s.smoothSettleMs = v;
            await this.plugin.saveSettingsAndSync();
          })
      );

    /* ---------------- 高级 ---------------- */

    const hint = document.createElement("p");
    hint.className = "setting-item-description";
    hint.textContent =
      "位置、大小、地图比例不在这里调：直接拖面板顶部的三颗点移动、拖右下角斜纹改大小、滚轮或用底部横条改比例。";
    adv.appendChild(hint);

    containerEl.createEl("h3", { text: "高级" });

    new Setting(containerEl)
      .setName("小地图刷新间隔")
      .setDesc("多久重新采样一次主画布状态。数值越大越省 CPU，但蓝框与小地图跟手会变迟钝；越小越跟手、开销越高。拖动主画布时会自动提速到 60 毫秒。")
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
      .setName("重置所有设置")
      .setDesc("把本插件的全部设置恢复为默认值（含面板位置、尺寸、缩放比例）。")
      .addButton((b) =>
        b.setButtonText("全部重置").setWarning().onClick(async () => {
          Object.assign(this.plugin.settings, DEFAULT_SETTINGS);
          await this.plugin.saveSettingsAndSync();
          this.plugin.sync();
          this.display();
          new Notice("已恢复默认设置");
        })
      );

    new Setting(containerEl)
      .setName("检测更新")
      .setDesc("从 GitHub 检查是否有新版本（当前 v" + this.plugin.manifest.version + "）")
      .addButton((b) =>
        b.setButtonText("检测").onClick(async () => {
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
              new Notice("检测失败：GitHub 返回 " + (res ? res.status : "无响应") + "。可能是网络无法访问 GitHub。\n发布页：" + repo + "/releases", 15000);
              return;
            }
            const data = res.json || {};
            const tag = String(data.tag_name || "");
            const latest = tag.replace(/^v/i, "");
            if (!latest) { new Notice("GitHub 上还没有发布版本\n" + repo + "/releases", 10000); return; }
            if (latest === cur) new Notice("已是最新版本 v" + cur);
            else new Notice("发现新版本 " + tag + "（当前 v" + cur + "）\n" + (data.html_url || repo + "/releases"), 15000);
          } catch (err) {
            const msg = String(err && err.message ? err.message : err);
            if (msg === "timeout") {
              new Notice("检测超时：10 秒没连上 GitHub。需要代理才能访问。\n发布页：" + repo + "/releases", 15000);
            } else {
              new Notice("检测失败：" + msg + "\n可能是网络无法访问 GitHub。发布页：" + repo + "/releases", 15000);
            }
          }
        })
      );

    const aboutLines = [
      "Excali Canvas Optimizer  v1.0.2",
      "作者：卢长希  https://github.com/changxi4848",
      "Excalidraw 的第三方辅助优化插件，个人开发维护，仅供学习使用参考，仅支持 Windows 桌面端。",
      "",
      "两个功能：导航小地图 + 缩放/拖动性能优化。",
      "导航小地图：缩略图只画色块与折线，几千笔画也能看清全局；切标签自动刷新，开关即时生效。",
      "性能优化：缩放与拖动时冻结画面、只移动一张位图，停手后渲染一帧高清，避免每帧全量重绘。",
      "",
      "小地图手势：点击 = 把主画布移过去；拖亮色区 = 移动视口；拖暗色区 = 拖地图并设定标准位置；滚轮 = 缩放地图；Shift+拖 = 锁轴；双击 = 整张图。",
      "面板手势：拖三颗点 = 移动；拖右下角 = 改大小；◎ = 回正；底部横条 = 缩放地图（越靠边越精细）。",
      "主画布缩放：Ctrl+滚轮 / 触摸板双指 / Ctrl+= 放大 / Ctrl+- 缩小 / Ctrl+0 复位（只在 Excalidraw 视图内拦截，不会缩放整个界面）。",
      "主画布平移：Alt+方向键 / 空格+拖 / 中键拖 / 手型工具。",
      "说明：光标不在画布上时，滚轮事件由 Obsidian 界面接收，插件收不到；因此 TourBox 等滚轮设备建议在驱动里映射成纯键盘按键（Ctrl+= / Ctrl+-）。",
    ];
    for (const line of aboutLines) {
      const p = document.createElement("p");
      p.className = "setting-item-description";
      p.textContent = line;
      containerEl.appendChild(p);
    }
  }
}
