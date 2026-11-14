# Excali Canvas Optimizer

**Excali 画布优化** — [Obsidian](https://obsidian.md) + [Excalidraw](https://github.com/zsviczian/obsidian-excalidraw-plugin) 的配套优化插件。

> 需要先安装并启用 [obsidian-excalidraw-plugin](https://github.com/zsviczian/obsidian-excalidraw-plugin)。

---

## 它解决什么问题

Excalidraw 很好用，但当一页笔记画到几千笔之后，会同时出现两个问题：

1. **看不清自己在哪**——想纵览全局只能把画布缩小，缩到 10% 什么都糊了，而且越缩越卡；
2. **缩放和拖动开始卡**——每滚一格、每拖一下，Excalidraw 都要把整页重画一遍。

这个插件分别解决这两件事，并且**不修改任何文档内容、不进撤销栈**，只操作视图。

---

## 两个功能

### 1. 导航小地图

右下角常驻一张缩略图，**只画色块和折线**（不重绘真实笔画），所以几千笔画也几乎不耗性能。

- 一眼看出当前视口在整张图的哪个位置；
- 单击任意位置把主画布移过去；
- 蓝色方框 = 当前视口，可拖动；
- 暗色区域 = 视口之外，拖动它移动地图本身，松手后成为"标准位置"；
- 拖顶部三颗点移动面板、拖右下角改大小、`◎` 回正、底部横条缩放地图；
- 切换标签页或打开文件时自动刷新，开关设置即时生效。

### 2. 缩放 / 拖动性能优化

Excalidraw 原版在缩放或平移时是**每帧全量重绘**。这个插件改成：

- 手势开始时**冻结**当前画面（一张位图），手势进行中只移动这张图；
- 停手后**只提交一次**，让 Excalidraw 渲染一帧高清；
- 缩得越小、元素越多，停手判定自动延长——那种时候你是在纵览全局，不是在画。

效果：手势过程从"每帧重绘整页"变成"移动一张图"，几千笔画的页面也能顺滑缩放。

---

## 安装

不在 Obsidian 社区市场内（审核中/未发布），需手动安装：

1. 从 [Releases](https://github.com/changxi4848/excalidraw-canvas-optimizer/releases) 下载 `main.js`、`manifest.json`、`styles.css`；
2. 放到 `<你的库>/.obsidian/plugins/excalidraw-canvas-optimizer/`；
3. 重启 Obsidian，在 **设置 → 第三方插件** 里启用 **Excali Canvas Optimizer**。

---

## 操作速查

### 主画布

| 操作 | 方式 |
| --- | --- |
| 缩放 | `Ctrl + 滚轮`、触摸板双指、`Ctrl + =` 放大、`Ctrl + -` 缩小、`Ctrl + 0` 复位 |
| 平移 | `Alt + 方向键`、`空格 + 拖`、鼠标中键拖、手型工具 |

> `Ctrl±` 只在 Excalidraw 视图内被拦截，**不会缩放整个 Obsidian 界面**。

### 小地图

| 操作 | 效果 |
| --- | --- |
| 单击 | 把主画布移到该位置 |
| 拖蓝框 | 移动视口 |
| 拖暗色区 | 拖动地图，并设定新的标准位置 |
| 滚轮 / 底部横条 | 缩放地图（横条越靠边越精细） |
| `Shift + 拖` | 锁定单轴 |
| 双击 | 缩放到整张图 |

### 面板

拖三颗点移动 · 拖右下角改大小 · `◎` 回正 · 鼠标移上去才显示这些控件。

---

## 设置

**常用**

- 显示导航小地图
- 缩放锚点固定在画布中心（关闭则跟随光标）
- 顺滑缩放
- 关闭画布提示（Show hint）
- 停手判定（默认 120ms）

**高级**

- 小地图刷新间隔（越大越省 CPU、跟手越迟钝；拖动时自动提速到 60ms）
- 重置所有设置
- 检测更新（比对 GitHub 最新 Release）

---

## 已知限制

- **光标不在画布上时，滚轮事件由 Obsidian 界面接收，插件收不到**，因此无法实现"画布外滚轮缩放"。TourBox 这类滚轮设备建议在驱动里把旋钮映射成纯键盘按键（`Ctrl + =` / `Ctrl + -`）。
- 手势中画面是冻结位图，**放大会略糊**，松手立刻恢复清晰；外围区域是低清底图。
- 缩得很小之后再拖动/缩放，停手判定会自动延长（能省则省）。
- **仅支持 Windows 桌面端**，不含任何外部依赖（无 Python、无后台进程）。

---

## 性能

| 操作 | 频率 | 开销 |
| --- | --- | --- |
| 小地图平移跟随 | 每帧 | 0.01–0.02 ms |
| 小地图图层重建 | 内容变化时 | 7–10 ms / 4600 元素 |
| 冻结抓帧 | 手势开始（空闲时预抓） | 1–3 ms |
| 手势中移动画面 | 每帧 | 一个 CSS transform，≈ 0 |

真正的重活（全量重绘）只发生在**你停手之后**。

单核 CPU 频率最关键，核显足够；屏幕分辨率 × DPR 会线性放大开销。

---

## English (short)

A companion plugin for Excalidraw in Obsidian:

- **Navigator minimap** — thumbnail of the whole drawing that draws only blocks and polylines, so pages with thousands of strokes stay cheap. Click to jump, drag the box to pan, wheel to zoom the map.
- **Smooth zoom / pan** — freezes the current frame, moves a single bitmap during the gesture, commits once on release instead of re-rendering every frame.

Windows desktop only. No telemetry, no background processes, does not modify your documents or the undo stack. MIT licensed.

---

## 作者

**卢长希** — <https://github.com/changxi4848>

个人开发维护，仅供学习使用参考。不承诺响应时间。

## 许可

[MIT](LICENSE)
