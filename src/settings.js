import { PluginSettingTab, Setting } from "obsidian";

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
      .setName("交互模式")
      .setDesc(
        "鼠标：滚轮缩放小地图，Ctrl+滚轮缩放主画布。笔（数位板）：滚轮直接缩放主画布不用按 Ctrl，并接管键盘焦点与滚轮目标（TourBox 旋钮可用）。"
      )
      .addDropdown((d) => {
        d.addOption("mouse", "鼠标");
        d.addOption("pen", "笔（数位板）");
        return d.setValue(s.inputMode || "mouse").onChange(async (v) => {
          await this.plugin.setInputMode(v);
          await this.plugin.saveSettingsAndSync();
        });
      });

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
    const adv = document.createElement("details");
    adv.className = "exo-advanced";
    const sum = document.createElement("summary");
    sum.textContent = "高级选项";
    adv.appendChild(sum);
    containerEl.appendChild(adv);

    const hint = document.createElement("p");
    hint.className = "setting-item-description";
    hint.textContent =
      "位置、大小、地图比例不在这里调：直接拖面板顶部的三颗点移动、拖右下角斜纹改大小、滚轮或用底部横条改比例。";
    adv.appendChild(hint);

    new Setting(adv)
      .setName("自动显示小地图")
      .setDesc("打开 Excalidraw 画布时自动出现；关掉后需手动唤出。")
      .addToggle((t) =>
        t.setValue(s.autoShow).onChange(async (v) => {
          s.autoShow = v;
          await this.plugin.saveSettingsAndSync();
        })
      );

    new Setting(adv)
      .setName("压暗视口以外区域")
      .setDesc("一眼看出当前屏幕看到的是整张图的哪一块。")
      .addToggle((t) =>
        t.setValue(s.dimOutside).onChange(async (v) => {
          s.dimOutside = v;
          await this.plugin.saveSettingsAndSync();
        })
      );

    new Setting(adv)
      .setName("高亮选中的元素")
      .setDesc("在小地图上给选中的元素描一圈蓝边。")
      .addToggle((t) =>
        t.setValue(s.highlightSelection).onChange(async (v) => {
          s.highlightSelection = v;
          await this.plugin.saveSettingsAndSync();
        })
      );

    new Setting(adv)
      .setName("只画轮廓")
      .setDesc("不填色只描边，元素特别多、机器吃力时最省。")
      .addToggle((t) =>
        t.setValue(s.outlineOnly).onChange(async (v) => {
          s.outlineOnly = v;
          await this.plugin.saveSettingsAndSync();
        })
      );

    new Setting(adv)
      .setName("显示缩放百分比")
      .setDesc("小地图左上角显示地图比例。")
      .addToggle((t) =>
        t.setValue(s.showZoomBadge).onChange(async (v) => {
          s.showZoomBadge = v;
          await this.plugin.saveSettingsAndSync();
        })
      );

    new Setting(adv)
      .setName("面板透明度")
      .setDesc("小地图的不透明度，挡到内容时可以调低。")
      .addSlider((sl) =>
        sl
          .setLimits(0.4, 1, 0.02)
          .setValue(s.opacity)
          .setDynamicTooltip()
          .onChange(async (v) => {
            s.opacity = v;
            await this.plugin.saveSettingsAndSync();
          })
      );

    new Setting(adv)
      .setName("手绘采样点数")
      .setDesc("每条手绘在小地图上最多画几个点（默认 48）。调小更省。")
      .addSlider((sl) =>
        sl
          .setLimits(8, 160, 4)
          .setValue(s.maxFreedrawPoints)
          .setDynamicTooltip()
          .onChange(async (v) => {
            s.maxFreedrawPoints = v;
            await this.plugin.saveSettingsAndSync();
          })
      );

    new Setting(adv)
      .setName("刷新间隔")
      .setDesc("默认 250 毫秒；主画布移动时会自动提到 60 毫秒跟随。")
      .addSlider((sl) =>
        sl
          .setLimits(60, 600, 10)
          .setValue(s.tickMs)
          .setDynamicTooltip()
          .onChange(async (v) => {
            s.tickMs = v;
            await this.plugin.saveSettingsAndSync();
          })
      );

    new Setting(adv)
      .setName("恢复默认位置和大小")
      .setDesc("放回右下角、尺寸回到 292×210。")
      .addButton((b) =>
        b.setButtonText("重置").onClick(async () => {
          s.corner = "br";
          s.freeLeft = null;
          s.freeTop = null;
          s.width = 292;
          s.height = 210;
          await this.plugin.saveSettingsAndSync();
          this.display();
        })
      );

    /* ---------------- 关于 ---------------- */
    containerEl.createEl("h3", { text: "关于" });

    const aboutLines = [
      "Excali 画布优化  v1.0.0",
      "作者：卢长希  https://github.com/changxi4848",
      "该插件是 Excalidraw 的第三方辅助优化插件，个人开发、随缘维护，仅支持 Windows 端。",
      "",
      "三个功能：导航小地图 + 缩放拖动性能优化 + 数位板体验优化。",
      "导航小地图：操作很简单，自己试。",
      "缩放拖动优化：取消了原版的全域实时刷新，改用更流畅的冻结方案。",
      "数位板体验优化：笔模式下切换标签页时，把鼠标光标复位到画面中心，让缩放快捷键的中心正确。",
      "",
      "小地图手势：点击 = 把主画布移过去；拖亮色区 = 移动视口；拖暗色区 = 拖地图并设定标准位置；滚轮 = 缩放地图；Shift+拖 = 锁轴；双击 = 整张图。",
      "面板手势：拖三颗点 = 移动；拖右下角 = 改大小；◎ = 回正；底部横条 = 缩放地图（越靠边越精细）。",
      "主画布缩放：Ctrl+滚轮 / 触摸板双指 / Ctrl± / Ctrl+0；拖动：空格+拖、中键拖、手型工具。",
    ];
    for (const line of aboutLines) {
      const p = document.createElement("p");
      p.className = "setting-item-description";
      p.textContent = line;
      containerEl.appendChild(p);
    }
  }
}
