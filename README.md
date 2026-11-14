# Excali Canvas Optimizer

**Excali Canvas Optimizer（Excali 画布优化）** — a companion plugin for [Obsidian](https://obsidian.md) + [Excalidraw](https://github.com/zsviczian/obsidian-excalidraw-plugin).

> Requires [obsidian-excalidraw-plugin](https://github.com/zsviczian/obsidian-excalidraw-plugin) to be installed and enabled.

---

## What problem it solves / 解决什么问题

**English** — Excalidraw is great, but once a page grows to thousands of strokes two things break down: (1) you cannot tell where you are without zooming out, and the canvas gets blurry and slow when you do; (2) every zoom step or pan re-renders the whole scene, so gestures stutter. This plugin solves both. It never modifies your documents and never touches the undo stack — it only manipulates the view.

**中文** — Excalidraw 很好用，但一页笔记画到几千笔之后会出现两个问题：①想纵览全局只能缩小，缩到 10% 就糊、而且越缩越卡；②每滚一格、每拖一下都要把整页重画一遍，手势卡顿。本插件分别解决这两件事，**不修改任何文档内容、不进撤销栈**，只操作视图。

---

## Features / 功能

### 1. Navigator minimap / 导航小地图

**English** — A thumbnail of the whole drawing docked to the canvas corner. It draws only blocks and polylines (never real strokes), so pages with thousands of strokes stay cheap. Click to jump, drag the blue box to pan, drag the dim area to move the map itself, wheel to zoom the map. Refreshes automatically when you switch tabs or open a file.

**中文** — 右下角常驻一张缩略图，**只画色块与折线**（不重绘真实笔画），几千笔画也几乎不耗性能。单击把主画布移过去；拖蓝框移动视口；拖暗色区移动地图本身并设定"标准位置"；滚轮缩放地图。切换标签或打开文件时自动刷新。

### 2. Smooth zoom / pan / 缩放与拖动优化

**English** — Excalidraw re-renders the whole scene on every zoom or pan step. This plugin freezes the current frame into a bitmap, moves that bitmap during the gesture, and commits once when you stop. The smaller you zoom out, the longer the settle window (you are overviewing, not drawing).

**中文** — Excalidraw 原版在缩放或平移时逐帧全量重绘。本插件在手势开始时把当前画面**冻结**成一张位图，手势中只移动这张图，停手后只提交一次渲染高清。缩得越小、元素越多，停手判定自动延长。

---

## Installation / 安装

**English**
1. Download `main.js`, `manifest.json`, `styles.css` from [Releases](https://github.com/changxi4848/excalidraw-canvas-optimizer/releases).
2. Put them into `<your vault>/.obsidian/plugins/excalidraw-canvas-optimizer/`.
3. Restart Obsidian, then enable **Excali Canvas Optimizer** in **Settings → Community plugins**.

**中文**
1. 从 [Releases](https://github.com/changxi4848/excalidraw-canvas-optimizer/releases) 下载 `main.js`、`manifest.json`、`styles.css`；
2. 放进 `<你的库>/.obsidian/plugins/excalidraw-canvas-optimizer/`；
3. 重启 Obsidian，在 **设置 → 第三方插件** 里启用 **Excali Canvas Optimizer**。

---

## Usage / 使用

### Canvas / 主画布

| Action / 操作 | How / 方式 |
| --- | --- |
| Zoom / 缩放 | `Ctrl + wheel`, trackpad pinch, `Ctrl + =`, `Ctrl + -`, `Ctrl + 0` |
| Pan / 平移 | `Alt + arrow keys`, `Space + drag`, middle-button drag, hand tool |

> `Ctrl±` is intercepted only inside an Excalidraw view — it will not zoom the whole Obsidian UI.
> `Ctrl±` 只在 Excalidraw 视图内被拦截，不会缩放整个 Obsidian 界面。

### Minimap / 小地图

| Action / 操作 | Effect / 效果 |
| --- | --- |
| Click / 单击 | Jump the canvas there / 把主画布移过去 |
| Drag blue box / 拖蓝框 | Pan the viewport / 移动视口 |
| Drag dim area / 拖暗色区 | Move the map, sets new standard position / 移动地图并设定标准位置 |
| Wheel or bottom bar / 滚轮或底部横条 | Zoom the map / 缩放地图 |
| `Shift + drag` | Lock to one axis / 锁定单轴 |
| Double-click / 双击 | Fit the whole drawing / 缩放到整张图 |

Panel: drag the three dots to move · drag the bottom-right corner to resize · `◎` recenters. Controls appear on hover.
面板：拖三颗点移动 · 拖右下角改大小 · `◎` 回正，鼠标移上去才显示。

---

## Settings / 设置

**English**
- Show navigator minimap
- Lock zoom anchor to canvas center (off = follow cursor)
- Smooth zoom (freeze rendering)
- Suppress Excalidraw "Show hint"
- Settle delay (default 120 ms)
- Advanced: minimap refresh interval, reset all settings, check for updates

**中文**
- 显示导航小地图
- 缩放锚点固定在画布中心（关闭则跟随光标）
- 顺滑缩放（冻结渲染）
- 关闭画布提示（Show hint）
- 停手判定（默认 120ms）
- 高级：小地图刷新间隔、重置所有设置、检测更新

---

## Known limitations / 已知限制

**English**
- Wheel events outside the canvas are consumed by the Obsidian UI, so "zoom while the cursor is off-canvas" is not possible from a plugin. Map wheel devices such as TourBox to plain keys (`Ctrl + =` / `Ctrl + -`) instead.
- During gestures the canvas is a frozen bitmap: zooming in looks slightly soft and the surrounding area is a low-res underlay. Both are restored when you release.
- Windows desktop only. No external dependencies, no background processes, no Python.

**中文**
- 光标不在画布上时，滚轮事件由 Obsidian 界面接收，插件收不到，所以"画布外滚轮缩放"无法实现。TourBox 这类滚轮设备建议在驱动里映射成纯键盘按键（`Ctrl + =` / `Ctrl + -`）。
- 手势中画面是冻结位图：放大时略糊，外围是低清底图，松手即恢复清晰。
- 仅支持 Windows 桌面端，无外部依赖、无后台进程、无 Python。

---

## Performance / 性能

**English** — The minimap only redraws blocks and polylines; per-frame panning costs 0.01–0.02 ms, layer rebuild 7–10 ms for 4,600 elements, freeze capture 1–3 ms. The expensive full re-render happens only once, after you stop. A fast single CPU core matters most; integrated graphics are enough.

**中文** — 小地图只画色块与折线：平移 0.01–0.02 ms/帧，图层重建约 7–10 ms（4600 元素），冻结抓帧 1–3 ms。真正的全量重绘只在你停手之后发生一次。单核 CPU 频率最关键，核显足够。

---

## Author / 作者

**卢长希 (Lu Changxi)** — <https://github.com/changxi4848>

Personal project, provided as-is for learning and reference. No support guarantees.
个人开发维护，仅供学习使用参考，不承诺响应时间。

## License / 许可

[MIT](LICENSE)
