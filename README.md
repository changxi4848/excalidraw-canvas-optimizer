# Excali 画布优化

> 给 Obsidian + Excalidraw 的两块补丁：一个随时能看清全局的导航小地图，一套不卡手的缩放/拖动。

Excalidraw 很好用，但当一页笔记画到几千笔之后，会同时出现两个问题：

1. **看不清自己在哪**——想纵览全局只能把画布缩小，缩到 10% 就什么都糊了，而且越缩越卡；
2. **缩放和拖动开始卡**——每滚一格、每拖一下，Excalidraw 都要把整页重画一遍。

这个插件分别解决这两件事，并且**不修改你的任何文档内容、不进撤销栈**，只操作视图。

---

## English (short)

**Excali Canvas Optimizer** — a community plugin for [Obsidian](https://obsidian.md) + [Excalidraw](https://github.com/zsviczian/obsidian-excalidraw-plugin).

- **Navigator minimap** — a thumbnail anchored to the canvas that only draws blocks and polylines (never re-renders strokes), so a 5,000-stroke page stays readable and cheap. Click to jump, drag the blue box to pan, wheel/bar to zoom the map, double-click to fit.
- **Smooth zoom / pan** — while zooming, Excalidraw re-renders the whole scene every frame. This plugin freezes the current frame, moves a single bitmap during the gesture, and commits once when you stop. The smaller you zoom out, the longer the settle window.
- **Tablet (pen) mode** — no Ctrl needed for wheel zoom, cursor recentring on tab switch, keyboard focus hand-off.

Windows desktop only. Does not modify your documents or undo stack. MIT licensed.


---

## 三个功能

### 1. 导航小地图

右下角常驻一张缩略图，**只画色块和折线**（不重绘真实笔画），所以即使几千笔画也几乎不耗性能。

- 一眼看出当前视口在整张图的哪个位置；
- 点击任意位置把主画布移过去，不平移不缩放；
- 蓝色方框 = 当前视口，可以按住拖动；
- 暗色区域 = 视口之外，可以拖动它移动地图本身，松手后这个相对位置成为"标准位置"；
- 可以拖顶部三颗点移动面板、拖右下角改大小、`◎` 回正、底部横条缩放地图。

### 2. 缩放 / 拖动性能优化

Excalidraw 原版在缩放或平移时是**每帧全量重绘**。这个插件改成：

- 手势开始时**冻结**当前画面（一张位图），手势进行中只移动这张图；
- 停手后**只提交一次**，让 Excalidraw 渲染一帧高清；
- 缩得越小、元素越多，停手判定自动延长——因为那种时候你是在纵览全局，不是在画。

效果：手势过程从"每帧重绘整页"变成"移动一张图"，几千笔画的页面也能顺滑缩放。

### 3. 数位板体验优化（笔模式）

- 笔悬停/滚轮不再需要按 Ctrl 就能缩放主画布；
- 切换标签页时把光标复位到画面中心，让缩放快捷键的中心正确；
- 自动接管键盘焦点：切回画布即可直接按 `V` `P` 空格，不用先用鼠标点一下。

---

## 安装

这个插件不在 Obsidian 社区市场里，需要手动安装：

1. 下载/克隆本仓库到 `<你的库>/.obsidian/plugins/excalidraw-canvas-optimizer/`；
2. 目录里至少要有 `main.js`、`manifest.json`、`styles.css`、`helper.py`；
3. 重启 Obsidian，在 **设置 → 第三方插件** 里启用 **Excali 画布优化**。

> 需要先安装并启用 [obsidian-excalidraw-plugin](https://github.com/zsviczian/obsidian-excalidraw-plugin)。

---

## 手势速查

**小地图**

| 操作 | 效果 |
| --- | --- |
| 单击 | 把主画布移到该位置 |
| 拖亮色区（蓝框） | 移动视口 |
| 拖暗色区 | 拖动地图，并设定新的标准位置 |
| 滚轮 / 底部横条 | 缩放地图（横条越靠边越精细） |
| Shift + 拖 | 锁定单轴 |
| 双击 | 缩放到整张图 |

**面板**：拖三颗点移动 · 拖右下角改大小 · `◎` 回正 · 鼠标移上去才显示这些控件。

**主画布缩放**：`Ctrl + 滚轮`、触摸板双指、`Ctrl` `+` / `-` / `0`。
**主画布拖动**：`空格 + 拖`、鼠标中键拖、手型工具。

---

## 设置

- **常用**：导航器开关、交互模式（鼠标 / 笔）、顺滑缩放开关、关闭画布提示、停手判定（默认 120ms）
- **高级**：自动显示、压暗视口外、高亮选中、只画轮廓、显示百分比、透明度、采样点数、刷新间隔、重置位置
- **关于**：作者与完整手势说明

位置、大小、地图比例**不放在设置里**——直接拖面板、滚轮、拖横条就行。

---

## 性能说明

| 操作 | 频率 | 开销 |
| --- | --- | --- |
| 小地图平移跟随 | 每帧 | 0.01–0.02 ms |
| 小地图图层重建 | 内容变化时 | 7–10 ms / 4600 元素 |
| 冻结抓帧 | 手势开始（空闲时会预抓） | 1–3 ms |
| 手势中移动画面 | 每帧 | 一个 CSS transform，约等于 0 |

真正的重活（全量重绘）仍然只发生在**你停手之后**。

**硬件**：单核 CPU 频率最关键（JS 在主线程），核显足够，屏幕分辨率 × DPR 会线性放大开销。普通笔记任何轻薄本都行；3–5 千笔画建议 12 代 i5 / R5 以上 + 16 GB。

---

## 已知限制

- **放大时会略糊**：冻结原理是缩放一张位图，放大倍数越大越糊，松手立刻恢复清晰；
- **手势超出原视野时外围是低清底图**，不是原生清晰度；
- 缩小后立刻拖动，可能有一帧轻微跳动；
- 拖小地图蓝框时仍走原生重绘（拖动大图时会略顿）；
- **仅支持 Windows 桌面端**（数位板优化依赖本地 Python 辅助进程 `helper.py`）。

---

## 作者

**卢长希** — <https://github.com/changxi4848>

个人开发、随缘维护。我自己每天用 Obsidian + Excalidraw 学数学，遇到问题通常会第一时间发现并顺手修掉，但不承诺响应时间。

## 许可

[MIT](LICENSE)
