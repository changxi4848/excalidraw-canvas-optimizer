/**
 * 悬浮小地图面板。
 *
 * 架构（按用户要求）：
 *   - 地图 = 一张大的静态位图，位置/比例由世界坐标决定，跟面板大小无关；
 *   - 面板 = 窗口：只显示框住的部分，改大小不重画、不缩放、内容纹丝不动；
 *   - 蓝框和压暗都是 DOM（蓝框 div + box-shadow），主画布平移时只改一个 transform；
 *   - canvas 只在"场景变了 / 地图比例变了 / 窗口跑出覆盖范围"时重画。
 */

import { clamp, visibleSceneRect, zoomOf } from "./geometry.js";
import { buildItems, createItemCache, isLightColor, sceneBounds, sceneSignature } from "./scene.js";
import { drawScene } from "./renderer.js";
import {
  centerOnPoint,
  clampScale,
  expandRect,
  fitScale,
  offsetForPoint,
  panelWorldRect,
  rectContains,
  toWorld,
  viewForBounds,
  zoomAround,
} from "./mapview.js";

const MIN_PANEL_W = 150;
const MIN_PANEL_H = 110;
const SNAP_DISTANCE = 40;
/** 标准位置最多偏离面板中心多少（占面板尺寸比例） */
const MAX_STANDARD = 0.4;
/** 场景变化后最短重建间隔（毫秒） */
const REBUILD_INTERVAL = 220;
/** 覆盖范围重建的最短间隔（毫秒） */
const COVERAGE_INTERVAL = 90;
/** 元素很多时的重建间隔 / 停笔等待 / 最大滞后 */
const HEAVY_INTERVAL = 750;
const HEAVY_QUIET = 320;
const HEAVY_MAX_STALE = 1800;
const HEAVY_COUNT = 1200;
/** 覆盖范围在窗口外多渲染多少（相对窗口宽高） */
const COVERAGE_MARGIN = 0.75;
/** 离屏位图像素上限 */
const MAX_LAYER_PIXELS = 4.2e6;


export class MinimapPanel {
  constructor(plugin, leaf) {
    this.plugin = plugin;
    this.leaf = leaf;

    this.host = null;
    this.el = null;
    this.canvas = null;
    this.ctx = null;
    this.box = null;
    this.handle = null;
    this.bar = null;
    this.badge = null;

    this._scale = null;
    this._ox = 0;
    this._oy = 0;
    this._viewReady = false;
    this._viewport = null;

    this._items = null;
    this._itemCache = createItemCache();
    this._sceneBox = null;
    this._stats = null;

    this._layer = null;
    this._layerCtx = null;
    this._layerCover = null;
    this._layerScale = 0;
    this._layerDirty = true;
    this._layerAt = 0;

    this._st = null;
    this._zoom = 1;
    this._vw = 0;
    this._vh = 0;
    this._els = null;
    this._sig = 0;
    this._sizeKey = "";
    this._selKey = null;
    this._selSet = null;
    this._painted = false;

    this._dragMode = null;
    this._dragStart = null;
    this._resizeStart = null;
    this._handleCorner = "tl";
    this._statusInset = 0;
    this._pendingPan = null;
    this._raf = null;
    this._placeholder = null;
  }

  /** 地图视图（世界 → 面板像素）。 */
  get mapView() {
    return { scale: this._scale || 1, ox: this._ox, oy: this._oy };
  }

  /** 这个面板所属的 Obsidian 视图。 */
  get leafView() {
    return this.leaf && this.leaf.view;
  }

  get settings() {
    return this.plugin.settings;
  }

  /* ------------------------------------------------------------ 生命期 */

  mount() {
    const view = this.leafView;
    if (!view || !view.containerEl) return false;
    this.host = view.containerEl;
    this.host.classList.add("emm-host");

    this.el = document.createElement("div");
    this.el.className = "emm-panel";

    this.canvas = document.createElement("canvas");
    this.canvas.className = "emm-canvas";

    this.box = document.createElement("div");
    this.box.className = "emm-box";

    // 压暗用 4 块实心 div：比 9999px 的 box-shadow 便宜得多，而且不产生巨大图层
    this.dimLayer = document.createElement("div");
    this.dimLayer.className = "emm-dim";
    this.dimParts = [0, 1, 2, 3].map(() => {
      const part = document.createElement("div");
      this.dimLayer.appendChild(part);
      return part;
    });

    this.bar = document.createElement("div");
    this.bar.className = "emm-bar";
    this.bar.title = "拖动这里移动小地图";
    const dots = document.createElement("div");
    dots.className = "emm-bar-dots";
    for (let i = 0; i < 3; i += 1) dots.appendChild(document.createElement("i"));
    this.bar.appendChild(dots);

    this.resetBtn = document.createElement("div");
    this.resetBtn.className = "emm-reset";
    this.resetBtn.title = "回正：把标准位置复位到导航器中心";
    this.resetBtn.textContent = "◎";

    this.handle = document.createElement("div");
    this.handle.className = "emm-handle";
    this.handle.title = "拖动这个角调整大小（对角固定不动）";

    this.zoomBar = document.createElement("div");
    this.zoomBar.className = "emm-zoombar";
    this.zoomKnob = document.createElement("div");
    this.zoomKnob.className = "emm-zoombar-knob";
    this.zoomBar.appendChild(this.zoomKnob);

    this.badge = document.createElement("div");
    this.badge.className = "emm-badge";

    this.el.append(this.canvas, this.dimLayer, this.box, this.bar, this.resetBtn, this.handle, this.zoomBar, this.badge);
    this.host.appendChild(this.el);

    this.ctx = this.canvas.getContext("2d", { alpha: true });
    this.applyLayout();
    this.bindCanvas();
    this.bindWindowPenWheel();
    this.bindBar();
    this.bindReset();
    this.bindZoomBar();
    this.bindHandle();
    this.tick(performance.now(), true);
    return true;
  }


  unmount() {
    if (this._penWheel) window.removeEventListener("wheel", this._penWheel, { capture: true });
    this.stopAnimation();
    if (this._raf) {
      cancelAnimationFrame(this._raf);
      this._raf = null;
    }
    if (this.host) this.host.classList.remove("emm-host");
    if (this.el && this.el.parentElement) this.el.parentElement.removeChild(this.el);
    this.el = null;
    this.canvas = null;
    this.ctx = null;
    this.box = null;
    this._layer = null;
    this._layerCtx = null;
    this._items = null;
    this._st = null;
    this._layerCover = null;
    this._painted = false;
    this._viewReady = false;
  }

  /* ------------------------------------------------------------ 布局 */

  statusBarInset() {
    const bar = document.querySelector(".status-bar");
    if (!bar || !this.host) return 0;
    const barRect = bar.getBoundingClientRect();
    if (barRect.height <= 0) return 0;
    const hostRect = this.host.getBoundingClientRect();
    const overlap = hostRect.bottom - barRect.top;
    return overlap > 0 ? Math.min(barRect.height, overlap) : 0;
  }

  applyLayout() {
    if (!this.el) return;
    const s = this.settings;
    const style = this.el.style;
    const free = s.freeLeft != null && s.freeTop != null;
    this._statusInset = this.statusBarInset();

    style.width = `${Math.round(s.width)}px`;
    style.height = `${Math.round(s.height)}px`;
    style.opacity = String(s.opacity);

    style.left = style.right = style.top = style.bottom = "auto";
    if (free) {
      style.left = `${Math.round(s.freeLeft)}px`;
      style.top = `${Math.round(s.freeTop)}px`;
    } else {
      // 始终紧贴视图边缘（不再受旧的 padding 设置影响）
      const pad = 0;
      const bottom = this._statusInset;
      if (s.corner === "br") {
        style.right = `${pad}px`;
        style.bottom = `${bottom}px`;
      } else if (s.corner === "bl") {
        style.left = `${pad}px`;
        style.bottom = `${bottom}px`;
      } else if (s.corner === "tr") {
        style.right = `${pad}px`;
        style.top = `${pad}px`;
      } else {
        style.left = `${pad}px`;
        style.top = `${pad}px`;
      }
    }
    this.badge.classList.toggle("is-hidden", !s.showZoomBadge);
    this.updateHandleCorner();
    this._sizeKey = "";
  }

  /** 把手放在"朝向画面中心"的那一角。 */
  updateHandleCorner() {
    if (!this.el || !this.host) return;
    const hostRect = this.host.getBoundingClientRect();
    const r = this.el.getBoundingClientRect();
    if (!r.width || !hostRect.width) return;
    const margin = 56;
    const nearLeft = r.left - hostRect.left <= margin;
    const nearRight = hostRect.right - r.right <= margin;
    const nearTop = r.top - hostRect.top <= margin;
    const nearBottom = hostRect.bottom - r.bottom - this._statusInset <= margin;

    // 默认右下；贴着哪个角，把手就换到它的对角，保证有地方可拖
    let corner = "br";
    if (nearRight && nearBottom) corner = "tl";
    else if (nearRight && nearTop) corner = "bl";
    else if (nearLeft && nearBottom) corner = "tr";
    else if (nearLeft && nearTop) corner = "br";

    this._handleCorner = corner;
    this.el.dataset.handle = corner;
  }

  /* ------------------------------------------------------------ 视图初始化 */

  /**
   * 首次显示：默认把整张图装进面板（mapScale > 0 时才用固定比例）。
   * 这样打开就是"全图"，比例读数与画布缩放同一口径。
   */
  ensureView(size) {
    if (this._viewReady) return;
    const configured = Number(this.settings.mapScale);
    const box = this._sceneBox || this._viewport;
    let v;
    if (configured > 0) {
      const cx = box ? box.x + box.width / 2 : 0;
      const cy = box ? box.y + box.height / 2 : 0;
      v = centerOnPoint({ scale: clampScale(configured), ox: 0, oy: 0 }, cx, cy, size.width, size.height);
    } else if (box) {
      v = viewForBounds(box, size.width, size.height, this.settings.innerPadding);
    } else {
      v = { scale: 0.5, ox: 0, oy: 0 };
    }
    this._scale = v.scale;
    this._ox = v.ox;
    this._oy = v.oy;
    this._viewReady = true;
    this._layerDirty = true;
  }

  /** 设置变了：丢位图、下一轮重画。 */
  invalidate() {
    this._layerDirty = true;
    this._painted = false;
    this._sizeKey = "";
  }

  /** 设置页改了"地图比例"就套用。 */
  applyMapScale(scale) {
    if (Number(scale) > 0) this._scale = clampScale(scale);
    else this._viewReady = false; // 0 = 自适应，下次 tick 重新适配整张图
    this._layerDirty = true;
    this.paint();
    this.tick(performance.now(), true);
  }

  /* ------------------------------------------------------------ 交互 */

  bindWindowPenWheel() {
    const onWinWheel = (ev) => {
      if (!this.el || !this.penActive()) return;
      const r = this.el.getBoundingClientRect();
      const inside = ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom;
      if (!inside) return;
      ev.preventDefault();
      ev.stopPropagation();
      this.onWheel(ev);
    };
    window.addEventListener("wheel", onWinWheel, { capture: true, passive: false });
    this._penWheel = onWinWheel;
  }

  bindCanvas() {
    const canvas = this.canvas;

    canvas.addEventListener("pointerdown", (ev) => {
      if (ev.button !== 0) return;
      ev.preventDefault();
      ev.stopPropagation();
      this.stopAnimation();
      this._optimistic = null;
      const rect = canvas.getBoundingClientRect();
      const px = ev.clientX - rect.left;
      const py = ev.clientY - rect.top;
      this._shiftAxis = null;
      this._dragStart = {
        view: { ...this.mapView },
        pointerX: ev.clientX,
        pointerY: ev.clientY,
        ox: this._ox,
        oy: this._oy,
      };
      try {
        canvas.setPointerCapture(ev.pointerId);
      } catch (err) {
        /* ignore */
      }
      if (this.boxHit(px, py)) {
        this._dragMode = "pan";
        const vp = this._viewport;
        const v = this.mapView;
        if (vp) {
          const centerX = vp.x * v.scale + v.ox + (vp.width * v.scale) / 2;
          const centerY = vp.y * v.scale + v.oy + (vp.height * v.scale) / 2;
          this._dragStart.grabX = centerX - px;
          this._dragStart.grabY = centerY - py;
          this._dragStart.centerX = centerX;
          this._dragStart.centerY = centerY;
        }
        this.navigateToEvent(ev);
      } else {
        // 拖暗色区域 = 拖地图；松手后这个相对位置成为新的"标准位置"
        this._dragMode = "panMap";
      }
    });

    window.addEventListener(
      "pointermove",
      (ev) => {
        this._pointerType = ev.pointerType || "mouse";
        this._pointerAt = performance.now();
      },
      { capture: true, passive: true }
    );

    canvas.addEventListener("pointermove", (ev) => {
      if (this._dragMode === "pan") {
        ev.preventDefault();
        this.navigateToEvent(ev);
        return;
      }
      if (this._dragMode !== "panMap" || !this._dragStart) return;
      ev.preventDefault();
      this.dragMapTo(ev);
    });

    const end = (ev) => {
      if (this._dragMode === "panMap") {
        this._dragMode = null;
        this.commitStandard();
        return;
      }
      if (this._dragMode !== "pan") return;
      this._dragMode = null;
      this._optimistic = null;
      try {
        canvas.releasePointerCapture(ev.pointerId);
      } catch (err) {
        /* ignore */
      }
      // 先把还没落地的那一次平移做完，再回中，否则蓝框会慢半拍
      if (this._raf) {
        cancelAnimationFrame(this._raf);
        this._raf = null;
      }
      const pending = this._pendingPan;
      this._pendingPan = null;
      if (pending) this.plugin.panTo(this.leafView, pending.x, pending.y);
      this.recenter();
      this._painted = false;
    };
    canvas.addEventListener("pointerup", end);
    canvas.addEventListener("pointercancel", end);

    canvas.addEventListener("dblclick", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      this.fitAll();
    });

    canvas.addEventListener("wheel", (ev) => {
      this.stopAnimation();
      this.onWheel(ev);
    }, { passive: false });
  }

  /** 蓝框（亮色区域）命中测试：点在里面 = 导航，点在外面 = 拖地图 */
  boxHit(px, py) {
    const vp = this._viewport;
    if (!vp) return false;
    const v = this.mapView;
    const x = vp.x * v.scale + v.ox;
    const y = vp.y * v.scale + v.oy;
    const w = vp.width * v.scale;
    const h = vp.height * v.scale;
    return px >= x && py >= y && px <= x + w && py <= y + h;
  }

  /** 把目标世界点夹在画布内容附近，别让蓝框飘到空白里 */
  clampWorld(point) {
    const box = this._sceneBox;
    if (!box || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return point;
    const padX = Math.max(box.width * 0.12, 80);
    const padY = Math.max(box.height * 0.12, 80);
    return {
      x: Math.min(Math.max(point.x, box.x - padX), box.x + box.width + padX),
      y: Math.min(Math.max(point.y, box.y - padY), box.y + box.height + padY),
    };
  }

  navigateToEvent(ev) {
    if (!this._viewReady) return;
    const rect = this.canvas.getBoundingClientRect();
    let px = ev.clientX - rect.left;
    let py = ev.clientY - rect.top;

    // 从哪儿抓就从哪儿开始拖：框中心 = 指针 + 抓取时的偏移
    const start = this._dragStart;
    const grabX = start && Number.isFinite(start.grabX) ? start.grabX : 0;
    const grabY = start && Number.isFinite(start.grabY) ? start.grabY : 0;
    let centerX = px + grabX;
    let centerY = py + grabY;

    // Shift：第一次明显移动时锁死方向，之后不再改判（否则在十字中心附近会抽搐）
    if (ev.shiftKey && start && Number.isFinite(start.centerX)) {
      const movedX = centerX - start.centerX;
      const movedY = centerY - start.centerY;
      if (!this._shiftAxis && Math.max(Math.abs(movedX), Math.abs(movedY)) > 6) {
        this._shiftAxis = Math.abs(movedX) >= Math.abs(movedY) ? "x" : "y";
      }
      if (this._shiftAxis === "x") centerY = start.centerY;
      else if (this._shiftAxis === "y") centerX = start.centerX;
    } else {
      this._shiftAxis = null;
    }

    const world = this.clampWorld(toWorld(this.mapView, centerX, centerY));
    this._optimistic = { x: centerX, y: centerY };
    this._pendingPan = world;
    this.updateBox(this.theme());
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => {
      this._raf = null;
      const target = this._pendingPan;
      this._pendingPan = null;
      if (target) this.plugin.panTo(this.leafView, target.x, target.y);
    });
  }

  /** 滚轮 = 缩放地图；Ctrl/⌘ + 滚轮 = 缩放主画布。 */
  /** 最近 3 秒内是否在用数位板（pen） */
  penActive() {
    return this._pointerType === "pen" && performance.now() - (this._pointerAt || 0) < 3000;
  }

  onWheel(ev) {
    if (this.penActive()) {
      // 数位板：滚轮直接缩放地图，不要求 Ctrl
      const st0 = this._st;
      if (st0 && this._viewReady) {
        ev.preventDefault();
        ev.stopPropagation();
        const rect0 = this.canvas.getBoundingClientRect();
        const next0 = zoomAround(this.mapView, rect0.width / 2, rect0.height / 2, Math.exp(-ev.deltaY * 0.0016));
        this._scale = next0.scale;
        this._ox = next0.ox;
        this._oy = next0.oy;
        this._layerDirty = true;
        this.settings.mapScale = next0.scale;
        this.plugin.saveSettings();
        this.paint();
        return;
      }
    }
    const st = this._st;
    if (!st) return;
    ev.preventDefault();
    ev.stopPropagation();

    if (ev.ctrlKey || ev.metaKey) {
      if (!this._viewReady) return;
      const rect = this.canvas.getBoundingClientRect();
      const world = toWorld(this.mapView, ev.clientX - rect.left, ev.clientY - rect.top);
      const zoom = zoomOf(st);
      const nextZoom = clamp(zoom * Math.exp(-ev.deltaY * 0.0015), 0.1, 30);
      if (Math.abs(nextZoom - zoom) < 1e-4) return;
      this.plugin.zoomAt(this.leafView, world, (world.x + st.scrollX) * zoom, (world.y + st.scrollY) * zoom, nextZoom);
      return;
    }

    if (!this._viewReady) return;
    const rect = this.canvas.getBoundingClientRect();
    // 以导航器中心为锚点缩放（不是鼠标位置）
    const next = zoomAround(this.mapView, rect.width / 2, rect.height / 2, Math.exp(-ev.deltaY * 0.0016));
    this._scale = next.scale;
    this._ox = next.ox;
    this._oy = next.oy;
    this._layerDirty = true;
    this.settings.mapScale = next.scale;
    this.plugin.saveSettings();
    this.paint(); // 先用旧位图缩放顶上，下一轮补清晰图
  }

  /** 把蓝框挪回面板正中（带过渡，不跳）。 */
  recenter(animate = true) {
    if (!this._viewReady) return;
    const size = this.measure();
    const view = this.leafView;
    const api = view && view.excalidrawAPI;
    const st = api && typeof api.getAppState === "function" ? api.getAppState() : null;
    if (st) this._viewport = visibleSceneRect(st, size);
    const vp = this._viewport;
    if (!vp) return;
    const std = this.standard();
    const v = centerOnPoint(
      this.mapView,
      vp.x + vp.width / 2 - std.x / this.mapView.scale,
      vp.y + vp.height / 2 - std.y / this.mapView.scale,
      size.width,
      size.height
    );
    this.animateTo(v.ox, v.oy, animate);
  }

  animateTo(targetX, targetY, animate = true, duration = 240) {
    this.stopAnimation();
    const fromX = this._ox;
    const fromY = this._oy;
    if (!animate || (Math.abs(targetX - fromX) < 0.6 && Math.abs(targetY - fromY) < 0.6)) {
      this._ox = targetX;
      this._oy = targetY;
      this.paint();
      this.scheduleRender();
      return;
    }
    const started = performance.now();

    const step = (now) => {
      const t = Math.min(1, (now - started) / duration);
      const e = 1 - Math.pow(1 - t, 3);
      this._ox = fromX + (targetX - fromX) * e;
      this._oy = fromY + (targetY - fromY) * e;
      this.paint();
      if (t < 1) {
        this._anim = requestAnimationFrame(step);
      } else {
        this._anim = null;
        this.scheduleRender();
      }
    };
    this._anim = requestAnimationFrame(step);
  }

  stopAnimation() {
    if (this._anim) {
      cancelAnimationFrame(this._anim);
      this._anim = null;
    }
  }

  /** 标准位置：蓝框中心相对导航器中心的偏移（默认 0,0）。 */
  standard() {
    return { x: Number(this.settings.standardX) || 0, y: Number(this.settings.standardY) || 0 };
  }

  /** 拖暗色区域：地图跟着指针走；松手后这个相对位置就是新的标准位置。 */
  dragMapTo(ev) {
    if (!this._dragStart) return;
    const dx = ev.clientX - this._dragStart.pointerX;
    const dy = ev.clientY - this._dragStart.pointerY;
    this._ox = this._dragStart.ox + dx;
    this._oy = this._dragStart.oy + dy;
    this.clampMapOffset();
    this.paint();
  }

  /** 地图不能被拖到完全离开内容（否则窗口对着空白）。 */
  clampMapOffset() {
    const box = this._sceneBox;
    if (!box) return;
    const size = this.measure();
    const v = this.mapView;
    const padX = Math.max(box.width * 0.25, 200);
    const padY = Math.max(box.height * 0.25, 200);
    const x1 = box.x - padX;
    const y1 = box.y - padY;
    const x2 = box.x + box.width + padX;
    const y2 = box.y + box.height + padY;

    // 面板可见范围必须还和内容区有交集
    const left = -v.ox / v.scale;
    const top = -v.oy / v.scale;
    const right = left + size.width / v.scale;
    const bottom = top + size.height / v.scale;
    if (right < x1) this._ox = -x1 * v.scale + size.width;
    if (left > x2) this._ox = -x2 * v.scale;
    if (bottom < y1) this._oy = -y1 * v.scale + size.height;
    if (top > y2) this._oy = -y2 * v.scale;
  }

  /** 松手：把当前蓝框相对位置记成标准位置。 */
  commitStandard() {
    const vp = this._viewport;
    if (!vp) return;
    const size = this.measure();
    const v = this.mapView;
    const cx = vp.x * v.scale + v.ox + (vp.width * v.scale) / 2;
    const cy = vp.y * v.scale + v.oy + (vp.height * v.scale) / 2;
    const maxX = size.width * MAX_STANDARD;
    const maxY = size.height * MAX_STANDARD;
    this.settings.standardX = Math.round(Math.max(-maxX, Math.min(cx - size.width / 2, maxX)));
    this.settings.standardY = Math.round(Math.max(-maxY, Math.min(cy - size.height / 2, maxY)));
    this.plugin.saveSettings();
  }

  /** 回正按钮：标准位置复位到中点。 */
  resetStandard() {
    this.settings.standardX = 0;
    this.settings.standardY = 0;
    this.plugin.saveSettings();
    this.recenter(true);
  }

  /** 缩放到整张图。 */
  fitAll() {
    const size = this.measure();
    const box = this._sceneBox || this._viewport;
    if (!box) return;
    const v = viewForBounds(box, size.width, size.height, this.settings.innerPadding);
    this._scale = v.scale;
    this._ox = v.ox;
    this._oy = v.oy;
    this._layerDirty = true;
    this.settings.mapScale = v.scale;
    this.plugin.saveSettings();
    this.paint();
    this.tick(performance.now(), true);
  }

  scheduleRender() {
    this._layerDirty = true;
    if (this._renderTimer) return;
    this._renderTimer = window.setTimeout(() => {
      this._renderTimer = null;
      this.tick(performance.now(), true);
    }, 60);
  }

  /* ------------------------------------------------------------ 面板移动 / 改大小 */

  bindBar() {
    const bar = this.bar;
    bar.addEventListener("pointerdown", (ev) => {
      if (ev.button !== 0) return;
      ev.preventDefault();
      ev.stopPropagation();
      const hostRect = this.host.getBoundingClientRect();
      const panelRect = this.el.getBoundingClientRect();
      this._dragMode = "move";
      this._dragStart = {
        pointerX: ev.clientX,
        pointerY: ev.clientY,
        left: panelRect.left - hostRect.left,
        top: panelRect.top - hostRect.top,
      };
      this.el.classList.add("is-dragging");
      try {
        bar.setPointerCapture(ev.pointerId);
      } catch (err) {
        /* ignore */
      }
    });

    bar.addEventListener("pointermove", (ev) => {
      if (this._dragMode !== "move" || !this._dragStart) return;
      ev.preventDefault();
      const hostRect = this.host.getBoundingClientRect();
      const dx = ev.clientX - this._dragStart.pointerX;
      const dy = ev.clientY - this._dragStart.pointerY;
      const maxLeft = hostRect.width - this.el.offsetWidth;
      const maxTop = hostRect.height - this.el.offsetHeight - this._statusInset;
      const left = clamp(this._dragStart.left + dx, 0, Math.max(maxLeft, 0));
      const top = clamp(this._dragStart.top + dy, 0, Math.max(maxTop, 0));
      this.el.style.left = `${Math.round(left)}px`;
      this.el.style.top = `${Math.round(top)}px`;
      this.el.style.right = "auto";
      this.el.style.bottom = "auto";
    });

    const finish = (ev) => {
      if (this._dragMode !== "move") return;
      this._dragMode = null;
      this.el.classList.remove("is-dragging");
      try {
        bar.releasePointerCapture(ev.pointerId);
      } catch (err) {
        /* ignore */
      }
      this.snapToCorner();
      this.updateHandleCorner();
      this.plugin.saveSettings();
    };
    bar.addEventListener("pointerup", finish);
    bar.addEventListener("pointercancel", finish);
  }

  snapToCorner() {
    const hostRect = this.host.getBoundingClientRect();
    const panelRect = this.el.getBoundingClientRect();
    const left = panelRect.left - hostRect.left;
    const top = panelRect.top - hostRect.top;
    const right = hostRect.width - left - panelRect.width;
    const bottom = hostRect.height - top - panelRect.height - this._statusInset;
    const options = [
      ["br", Math.hypot(right, bottom), right, bottom],
      ["bl", Math.hypot(left, bottom), left, bottom],
      ["tr", Math.hypot(right, top), right, top],
      ["tl", Math.hypot(left, top), left, top],
    ].sort((a, b) => a[1] - b[1]);

    const s = this.settings;
    const [corner, distance] = options[0];
    if (distance <= SNAP_DISTANCE) {
      s.corner = corner;
      s.freeLeft = null;
      s.freeTop = null;
    } else {
      s.freeLeft = Math.max(0, Math.round(left));
      s.freeTop = Math.max(0, Math.round(top));
    }
    this.applyLayout();
  }

  bindZoomBar() {
    const bar = this.zoomBar;
    let start = null;
    bar.addEventListener("pointerdown", (ev) => {
      if (ev.button !== 0) return;
      ev.preventDefault();
      ev.stopPropagation();
      start = { x: ev.clientX, y: ev.clientY, scale: this._scale || 1 };
      try { bar.setPointerCapture(ev.pointerId); } catch (err) { /* ignore */ }
    });
    bar.addEventListener("pointermove", (ev) => {
      if (!start) return;
      ev.preventDefault();
      const dx = ev.clientX - start.x;
      const dy = ev.clientY - start.y;
      // 水平位移决定缩放；离滑条的垂直距离决定灵敏度（越远越精细）
      const damp = 1 + Math.abs(dy) / 30;
      const factor = Math.exp((dx * 0.03) / damp);
      const next = Math.max(0.03, Math.min(1, start.scale * factor));
      this.setMapScaleCentered(next);
    });
    const end = (ev) => {
      if (!start) return;
      start = null;
      try { bar.releasePointerCapture(ev.pointerId); } catch (err) { /* ignore */ }
    };
    bar.addEventListener("pointerup", end);
    bar.addEventListener("pointercancel", end);
  }

  /** 以面板中心为锚点设置地图比例 */
  setMapScaleCentered(scale) {
    if (!this._viewReady) return;
    const rect = this.canvas.getBoundingClientRect();
    const next = zoomAround(this.mapView, rect.width / 2, rect.height / 2, scale / (this._scale || scale));
    this._scale = next.scale;
    this._ox = next.ox;
    this._oy = next.oy;
    this._layerDirty = true;
    this.settings.mapScale = next.scale;
    this.plugin.saveSettings();
    this.paint();
  }

  bindReset() {
    if (!this.resetBtn) return;
    this.resetBtn.addEventListener("pointerdown", (ev) => ev.stopPropagation());
    this.resetBtn.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      this.resetStandard();
    });
  }

  bindHandle() {
    const handle = this.handle;

    handle.addEventListener("pointerdown", (ev) => {
      if (ev.button !== 0) return;
      ev.preventDefault();
      ev.stopPropagation();
      const hostRect = this.host.getBoundingClientRect();
      const r = this.el.getBoundingClientRect();
      this._dragMode = "resize";
      this._resizeStart = {
        pointerX: ev.clientX,
        pointerY: ev.clientY,
        width: r.width,
        height: r.height,
        left: r.left - hostRect.left,
        top: r.top - hostRect.top,
        anchorX: this._handleCorner.includes("l") ? r.right - hostRect.left : r.left - hostRect.left,
        anchorY: this._handleCorner.includes("t") ? r.bottom - hostRect.top : r.top - hostRect.top,
        panelLeft: r.left,
        panelTop: r.top,
      };
      this.el.classList.add("is-dragging");
      try {
        handle.setPointerCapture(ev.pointerId);
      } catch (err) {
        /* ignore */
      }
    });

    handle.addEventListener("pointermove", (ev) => {
      if (this._dragMode !== "resize" || !this._resizeStart) return;
      ev.preventDefault();
      const start = this._resizeStart;
      const dx = ev.clientX - start.pointerX;
      const dy = ev.clientY - start.pointerY;
      const fromRight = this._handleCorner.includes("r");
      const fromBottom = this._handleCorner.includes("b");

      let width = clamp(fromRight ? start.width + dx : start.width - dx, MIN_PANEL_W, 960);
      let height = clamp(fromBottom ? start.height + dy : start.height - dy, MIN_PANEL_H, 760);

      this.el.style.width = `${Math.round(width)}px`;
      this.el.style.height = `${Math.round(height)}px`;
      // 锚点（对角）固定：自由摆放时手动改 left/top；停靠时由 right/bottom 保证
      if (this.settings.freeLeft != null) {
        const left = fromRight ? start.left : start.anchorX - width;
        const top = fromBottom ? start.top : start.anchorY - height;
        this.el.style.left = `${Math.round(Math.max(0, left))}px`;
        this.el.style.top = `${Math.round(Math.max(0, top))}px`;
        this.el.style.right = "auto";
        this.el.style.bottom = "auto";
      }

      // 面板自己的 left/top 变了多少 → 地图反向补偿，内容"焊死"在屏幕上
      const r = this.el.getBoundingClientRect();
      this._ox -= r.left - start.panelLeft;
      this._oy -= r.top - start.panelTop;
      start.panelLeft = r.left;
      start.panelTop = r.top;
      this.paint();
    });

    const finish = (ev) => {
      if (this._dragMode !== "resize") return;
      this._dragMode = null;
      this.el.classList.remove("is-dragging");
      try {
        handle.releasePointerCapture(ev.pointerId);
      } catch (err) {
        /* ignore */
      }
      this.settings.width = this.el.offsetWidth;
      this.settings.height = this.el.offsetHeight;
      if (this.settings.freeLeft != null) {
        this.settings.freeLeft = Math.round(parseFloat(this.el.style.left) || 0);
        this.settings.freeTop = Math.round(parseFloat(this.el.style.top) || 0);
      }
      this.plugin.saveSettings();
      this.updateHandleCorner();
      this.tick(performance.now(), false);
      this.recenter(true);
    };
    handle.addEventListener("pointerup", finish);
    handle.addEventListener("pointercancel", finish);
  }

  /* ------------------------------------------------------------ 绘制 */

  /** 场景画布的真实 CSS 尺寸：侧边栏开合时 appState 里的宽高会滞后，直接量 DOM 最可靠 */
  sceneSize() {
    const view = this.leafView;
    const c = view && view.containerEl
      ? view.containerEl.querySelector("canvas.excalidraw__canvas.static") || view.containerEl.querySelector("canvas.excalidraw__canvas")
      : null;
    if (c && c.clientWidth > 10 && c.clientHeight > 10) {
      return { width: c.clientWidth, height: c.clientHeight };
    }
    return this.measure();
  }

  measure() {
    const cssW = this.el ? this.el.clientWidth : 0;
    const cssH = this.el ? this.el.clientHeight : 0;
    if (cssW > 4 && cssH > 4) return { width: cssW, height: cssH };
    return { width: this.settings.width, height: this.settings.height };
  }

  ensureCanvasSize(width, height) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const key = `${width}x${height}@${dpr}`;
    if (key === this._sizeKey) return dpr;
    this.canvas.width = Math.max(1, Math.round(width * dpr));
    this.canvas.height = Math.max(1, Math.round(height * dpr));
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this._sizeKey = key;
    return dpr;
  }

  theme() {
    const st = this._st;
    const background = (st && st.viewBackgroundColor) || "#ffffff";
    const light = isLightColor(background);
    return {
      background,
      light,
      dim: light ? "rgba(0,0,0,0.12)" : "rgba(0,0,0,0.34)",
      accent: light ? "rgba(47,111,214,0.95)" : "rgba(122,178,255,0.95)",
      emptyTextColor: light ? "rgba(90,96,106,0.75)" : "rgba(190,196,206,0.75)",
    };
  }

  /** 重建离屏地图位图：只覆盖"当前窗口 + 一圈余量"。 */
  renderLayer(now) {
    const size = this.measure();
    const view = this.mapView;
    const panelWorld = panelWorldRect(view, size.width, size.height);
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);

    const scene = this._sceneBox;
    let cover = null;
    if (scene) {
      const full = expandRect(scene, 0.05, 0.05);
      const fullPixels = full.width * view.scale * dpr * (full.height * view.scale * dpr);
      if (fullPixels <= MAX_LAYER_PIXELS * 0.85) cover = full;
    }
    if (!cover) {
      // 整张图太大：只画窗口附近一圈，并按像素上限收
      let margin = COVERAGE_MARGIN;
      cover = expandRect(panelWorld, margin, margin);
      while (
        cover.width * view.scale * dpr * cover.height * view.scale * dpr > MAX_LAYER_PIXELS &&
        margin > 0.02
      ) {
        margin *= 0.6;
        cover = expandRect(panelWorld, margin, margin);
      }
    }
    // 窗口本身必须被覆盖（面板比整张图还大时）
    if (
      cover.x > panelWorld.x ||
      cover.y > panelWorld.y ||
      cover.x + cover.width < panelWorld.x + panelWorld.width ||
      cover.y + cover.height < panelWorld.y + panelWorld.height
    ) {
      const x1 = Math.min(cover.x, panelWorld.x);
      const y1 = Math.min(cover.y, panelWorld.y);
      const x2 = Math.max(cover.x + cover.width, panelWorld.x + panelWorld.width);
      const y2 = Math.max(cover.y + cover.height, panelWorld.y + panelWorld.height);
      cover = { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
    }

    const cssW = Math.max(1, Math.round(cover.width * view.scale));
    const cssH = Math.max(1, Math.round(cover.height * view.scale));
    if (!this._layer) this._layer = document.createElement("canvas");
    if (this._layer.width !== Math.round(cssW * dpr) || this._layer.height !== Math.round(cssH * dpr)) {
      this._layer.width = Math.round(cssW * dpr);
      this._layer.height = Math.round(cssH * dpr);
      this._layerCtx = null;
    }
    if (!this._layerCtx) this._layerCtx = this._layer.getContext("2d");

    const theme = this.theme();
    const layerFit = { scale: view.scale, tx: -cover.x * view.scale, ty: -cover.y * view.scale };
    const selection = this.settings.highlightSelection ? this.selectionSet(this._st) : null;

    drawScene(
      this._layerCtx,
      { items: this._items || [] },
      {
        width: cssW,
        height: cssH,
        dpr,
        fit: layerFit,
        cull: cover,
        selectionIds: selection,
        accent: theme.accent,
        background: theme.background,
        clear: true,
        clip: true,
        padding: 0,
      }
    );

    this._layerCover = cover;
    this._layerScale = view.scale;
    this._layerDirty = false;
    this._layerAt = now;
  }

  /** 合成一帧：背景 + 地图位图 + 更新 DOM 蓝框。 */
  paint() {
    if (!this.ctx || !this._viewReady) return;
    const size = this.measure();
    const dpr = this.ensureCanvasSize(size.width, size.height);
    const view = this.mapView;
    const theme = this.theme();
    const ctx = this.ctx;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.width, size.height);
    ctx.fillStyle = theme.background;
    ctx.fillRect(0, 0, size.width, size.height);

    const cover = this._layerCover;
    if (this._layer && cover && this._layer.width > 0) {
      const dx = cover.x * view.scale + view.ox;
      const dy = cover.y * view.scale + view.oy;
      ctx.drawImage(this._layer, 0, 0, this._layer.width, this._layer.height, dx, dy, cover.width * view.scale, cover.height * view.scale);
    }

    this.updateBox(theme);
    this._painted = true;
    this.updateBadge();
  }

  /** 蓝框 = 当前主画布视口；用 transform 移动，不碰 canvas。 */
  updateBox(theme) {
    if (!this.box) return;
    const vp = this._viewport;
    if (!vp) {
      this.box.style.display = "none";
      if (this.dimLayer) this.dimLayer.style.display = "none";
      return;
    }
    const view = this.mapView;
    const w = Math.max(vp.width * view.scale, 2);
    const h = Math.max(vp.height * view.scale, 2);
    let x = vp.x * view.scale + view.ox;
    let y = vp.y * view.scale + view.oy;
    if (this._optimistic && this._dragMode === "pan") {
      x = this._optimistic.x - w / 2;
      y = this._optimistic.y - h / 2;
    }
    this.box.style.display = "block";
    this.box.style.width = `${w}px`;
    this.box.style.height = `${h}px`;
    this.box.style.transform = `translate(${x}px, ${y}px)`;

    // 颜色只在真的变化时写，避免每帧样式失效
    if (this._dimColor !== theme.dim) {
      this._dimColor = theme.dim;
      this.dimLayer.style.setProperty("--emm-dim", theme.dim);
      this.box.style.borderColor = theme.accent;
    }

    const W = this.el.clientWidth;
    const H = this.el.clientHeight;
    const showDim = Boolean(this.settings.showViewport);
    this.dimLayer.style.display = showDim ? "block" : "none";
    if (showDim) {
      const place = (el, px, py, pw, ph) => {
        el.style.transform = `translate(${px}px, ${py}px)`;
        el.style.width = `${Math.max(pw, 0)}px`;
        el.style.height = `${Math.max(ph, 0)}px`;
      };
      const top = Math.max(0, Math.min(y, H));
      const bottom = Math.max(0, Math.min(y + h, H));
      const left = Math.max(0, Math.min(x, W));
      const right = Math.max(0, Math.min(x + w, W));
      place(this.dimParts[0], 0, 0, W, top);
      place(this.dimParts[1], 0, bottom, W, H - bottom);
      place(this.dimParts[2], 0, top, left, bottom - top);
      place(this.dimParts[3], right, top, W - right, bottom - top);
    }
  }

  selectionSet(st) {
    const raw = st && st.selectedElementIds;
    if (raw === this._selKey) return this._selSet;
    this._selKey = raw;
    const set = new Set();
    for (const id of Object.keys(raw || {})) {
      if (raw[id]) set.add(id);
    }
    this._selSet = set;
    return set;
  }

  updateZoomBar() {
    if (!this.zoomKnob) return;
    const s = this._scale || 1;
    const t = Math.max(0, Math.min(1, (Math.log(s) - Math.log(0.03)) / (Math.log(1) - Math.log(0.03))));
    this.zoomKnob.style.left = (t * 100).toFixed(1) + "%";
  }

  updateBadge() {
    if (!this.badge) return;
    const pct = Math.round((this._scale || 0.5) * 100);
    this.badge.textContent = `${pct}%`;
    this.updateZoomBar();
    const stats = this._stats;
    const zoom = Math.round((this._zoom || 1) * 100);
    this.badge.title = `地图比例 ${pct}% · 画布缩放 ${zoom}%${stats ? ` · ${stats.elements} 个元素` : ""}`;
  }

  /* ------------------------------------------------------------ 轮询 */

  tick(now, force) {
    if (!this.el || !this.el.isConnected) return false;
    if (this.el.clientWidth < 8) return false;

    const view = this.leafView;
    if (!view || (view.getViewType && view.getViewType() !== "excalidraw")) return false;

    const api = view.excalidrawAPI;
    if (!api || typeof api.getSceneElements !== "function") {
      this.renderPlaceholder("等待画布加载…");
      return false;
    }

    const st = api.getAppState();
    if (!st) return false;
    this._placeholder = null;

    const zoom = zoomOf(st);
    const size = this.measure();
    const vp = visibleSceneRect(st, this.sceneSize());
    this._viewport = vp;
    if (this._viewReady) this.updateBox(this.theme());

    const els = api.getSceneElements() || [];
    let sceneChanged = false;
    if (els !== this._els) {
      const sig = sceneSignature(els);
      sceneChanged = sig !== this._sig;
      this._sig = sig;
      this._els = els;
    }

    const viewportChanged =
      force ||
      !this._st ||
      st.scrollX !== this._st.scrollX ||
      st.scrollY !== this._st.scrollY ||
      zoom !== this._zoom ||
      Math.abs(vp.width - this._vw) > 0.01 ||
      Math.abs(vp.height - this._vh) > 0.01 ||
      this._sizeKey !== `${size.width}x${size.height}@${Math.min(window.devicePixelRatio || 1, 2.5)}`;

    if (viewportChanged) this._movedAt = now;
    this._st = st;
    this._zoom = zoom;
    this._vw = vp.width;
    this._vh = vp.height;

    if (!sceneChanged && !viewportChanged && this._painted && !this._layerDirty) return false;

    if (sceneChanged) this._lastSceneAt = now;
    if (sceneChanged || !this._items || force) {
      const diag = this._sceneBox ? Math.hypot(this._sceneBox.width, this._sceneBox.height) : 0;
      const built = buildItems(
        els,
        {
          maxFreedrawPoints: this.settings.maxFreedrawPoints,
          outlineOnly: this.settings.outlineOnly,
          // 场景越大，世界空间里的抽稀步长越大；11% 下大约等于 0.3px，肉眼无损
          simplifyWorld: Math.max(diag * 0.0012, 0.5),
        },
        this._itemCache
      );
      this._items = built.items;
      this._stats = built.stats;
      this._sceneBox = sceneBounds(els);
      this._layerDirty = true;
    }

    this.ensureView(size);

    // 跟着画布走：每隔约 700ms 平滑把蓝框送回标准位置（不实时、不瞬移）
    if (viewportChanged && this._dragMode !== "pan" && !this._anim) {
      const last = this._followAt || 0;
      if (now - last > 700) {
        this._followAt = now;
        const std = this.standard();
        const v = this.mapView;
        const bx = vp.x * v.scale + v.ox + (vp.width * v.scale) / 2;
        const by = vp.y * v.scale + v.oy + (vp.height * v.scale) / 2;
        const targetX = size.width / 2 + std.x;
        const targetY = size.height / 2 + std.y;
        if (Math.abs(bx - targetX) > 2 || Math.abs(by - targetY) > 2) {
          this.animateTo(this._ox + (targetX - bx), this._oy + (targetY - by), true, 380);
        }
      }
    }

    const panelWorld = panelWorldRect(this.mapView, size.width, size.height);
    const coverageOk =
      this._layerCover &&
      this._layerScale === this.mapView.scale &&
      rectContains(this._layerCover, panelWorld, -2);
    // 重建节流：元素多的时候，边写边重建会很吵——停笔一会儿再补，最多滞后 1.8s
    const heavy = (this._items ? this._items.length : 0) > HEAVY_COUNT;
    const interval = heavy ? HEAVY_INTERVAL : COVERAGE_INTERVAL;
    const quiet = now - (this._lastSceneAt || 0);
    const stale = now - this._layerAt;
    const allowed = !heavy || quiet >= HEAVY_QUIET || stale >= HEAVY_MAX_STALE;
    const canRender = force || (allowed && stale >= interval);
    if ((this._layerDirty || !coverageOk) && canRender) {
      this.renderLayer(now);
    }

    this.paint();
    return true;
  }

  renderPlaceholder(text) {
    if (!this.ctx || (this._placeholder === text && this._painted)) return;
    this._placeholder = text;
    this._items = null;
    this._st = null;
    this._layerCover = null;
    if (this.box) this.box.style.display = "none";
    const size = this.measure();
    const dpr = this.ensureCanvasSize(size.width, size.height);
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const style = getComputedStyle(this.el);
    ctx.fillStyle = style.backgroundColor || "#ffffff";
    ctx.fillRect(0, 0, size.width, size.height);
    ctx.fillStyle = style.color || "#888";
    ctx.font = "12px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, size.width / 2, size.height / 2);
    this._painted = false;
    if (this.badge) this.badge.textContent = "—";
  }
}
