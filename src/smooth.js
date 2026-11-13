
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 30;
/** 停手后多久提交（毫秒） */
const SETTLE_MS = 260;
/** 保险：冻结超过这么久无条件恢复 */
const WATCHDOG_MS = 3000;

/**
 * Excalidraw 顺滑缩放（抓图版）
 *
 * 手势期间不向 Excalidraw 写 appState —— 它就不重画。
 * 冻结瞬间把当前画面**原样拷成一张图**，手势中只对这张图做 CSS transform（合成器处理，≈0 成本），
 * 停手后再一次性提交 zoom/scroll，让它渲染一帧高清。
 *
 * 所以：起手瞬间 100% 原生；过程中是"被拉伸的照片"；停手恢复原生。
 */
export class SmoothZoom {
  constructor(plugin) {
    this.plugin = plugin;
    this.app = plugin.app;
    this.settings = plugin.settings;
  }

  start() {
    // 空闲时每 400ms 备份一帧，手势一来就能直接复用，不用现场抓帧
    this._idleSnap = null;
    this._underlay = null;
    this._idleTimer = setInterval(() => this.captureIdle(), 500);
    this.plugin.register(() => clearInterval(this._idleTimer));
    this.session = null;
    this.timer = null;
    this.watchdog = null;
    this.enabled = true;
    this.spaceDown = false;
    this.dragging = null;

    this.plugin.registerDomEvent(window, "wheel", (ev) => this.onWheel(ev), { capture: true, passive: false });
    this.plugin.registerDomEvent(window, "keydown", (ev) => {
      if (ev.code === "Space" && !this.spaceDown && !ev.repeat) {
        this.spaceDown = true;
        this.freezeForPan();
      }
    });
    this.plugin.registerDomEvent(window, "keyup", (ev) => {
      if (ev.code === "Space") {
        this.spaceDown = false;
        if (this.session && this.session.mode === "pan" && !this.dragging) this.commit();
      }
    });
    this.plugin.registerDomEvent(window, "keydown", (ev) => this.onZoomKey(ev), { capture: true });
    this.plugin.registerDomEvent(window, "keyup", (ev) => {
      if (ev.code === "Space") this.spaceDown = false;
    });
    this.plugin.registerDomEvent(window, "pointerdown", (ev) => this.onPointerDown(ev), { capture: true });
    this.plugin.registerDomEvent(window, "pointermove", (ev) => this.onPointerMove(ev), { capture: true });
    this.plugin.registerDomEvent(window, "pointerup", (ev) => this.onPointerUp(ev), { capture: true });
    this.plugin.registerEvent(this.app.workspace.on("active-leaf-change", () => this.commit()));
    this.plugin.registerEvent(this.app.workspace.on("layout-change", () => this.commit()));

    this.plugin.addCommand({
      id: "toggle-smooth-zoom",
      name: "切换顺滑缩放（实验）",
      callback: () => {
        this.enabled = !this.enabled;
        if (!this.enabled) this.commit();
        console.log("[smooth-zoom] enabled =", this.enabled);
      },
    });
    const style = document.createElement("style");
    style.id = "esz-style";
    style.textContent = ".esz-hidden{visibility:hidden !important;}";
    document.head.appendChild(style);
    this.plugin.register(() => style.remove());
    console.log("[excalidraw-optimizer] smooth zoom ready");
  }

  stop() {
    this.commit(true);
  }

  view() {
    const leaf = this.app.workspace.getMostRecentLeaf
      ? this.app.workspace.getMostRecentLeaf()
      : this.app.workspace.activeLeaf;
    const v = leaf && leaf.view;
    if (!v || !v.getViewType || v.getViewType() !== "excalidraw") return null;
    return v;
  }

  /** 场景画布：静态层 + 交互层 */
  sceneCanvases(view) {
    const list = Array.from(view.containerEl.querySelectorAll("canvas.excalidraw__canvas"));
    if (!list.length) return null;
    const base = list.find((c) => c.classList.contains("static")) || list[0];
    return { base, all: list };
  }

  /* ------------------------------------------------------------ 冻结 */

  begin(view, api, mode, ev) {
    const st = api.getAppState();
    const cvs = this.sceneCanvases(view);
    if (!cvs) return false;
    const base = cvs.base;
    const rect = base.getBoundingClientRect();
    if (rect.width < 20 || rect.height < 20) return false;

    // 连续手势之间（<700ms）复用上一帧快照，避免反复抓帧/隐藏画布
    let snap = null;
    const cached = this._snapCache;
    let reuse = null;
    const idle = this._idleSnap;
    if (idle && idle.view === view && idle.at > (this._lastCommitAt || 0) && performance.now() - idle.at < 1500) reuse = idle;
    if (reuse) snap = reuse.snap;
    try {
      if (!snap) {
      let q = ((st.zoom && st.zoom.value) || 1) < 0.35 ? 0.5 : 1;
      const capMax = 1600;
      const longest = Math.max(base.width, base.height) * q;
      if (longest > capMax) q = q * (capMax / longest);
      snap = document.createElement("canvas");
      snap.width = Math.max(1, Math.round(base.width * q));
      snap.height = Math.max(1, Math.round(base.height * q));
      snap.getContext("2d").drawImage(base, 0, 0, snap.width, snap.height);
      }
    } catch (err) {
      return false;
    }

    // 安全阀：把快照缩到 4×4 再采样，避免在大画布上 getImageData（GPU 回读很贵）
    try {
      const probe = document.createElement("canvas");
      probe.width = 4;
      probe.height = 4;
      const pg = probe.getContext("2d");
      pg.drawImage(snap, 0, 0, 4, 4);
      const data = pg.getImageData(0, 0, 4, 4).data;
      let nonEmpty = 0;
      for (let i = 3; i < data.length; i += 4) if (data[i] > 8) nonEmpty += 1;
      if (nonEmpty === 0) return false;
    } catch (err) {
      return false;
    }
    const zoom = reuse ? reuse.zoom0 : (st.zoom && st.zoom.value) || 1;
    const baseScrollX = reuse ? reuse.scrollX0 : st.scrollX;
    const baseScrollY = reuse ? reuse.scrollY0 : st.scrollY;
    this.session = {
      view,
      api,
      mode,
      base,
      canvases: cvs.all,
      rect,
      snap,
      zoom0: zoom,
      scrollX0: baseScrollX,
      scrollY0: baseScrollY,
      offL: Number(st.offsetLeft) || 0,
      offT: Number(st.offsetTop) || 0,
      zoom,
      elementCount: (st.__els || api.getSceneElements() || []).length,
      scrollX: baseScrollX,
      scrollY: baseScrollY,
      ax: ev ? ev.clientX - rect.left : rect.width / 2,
      ay: ev ? ev.clientY - rect.top : rect.height / 2,
      startClientX: ev ? ev.clientX : 0,
      startClientY: ev ? ev.clientY : 0,
    };

    this.mountOverlay();
    this.applyTransform();
    this.armWatchdog();
    return true;
  }

  /** 覆盖层：和画布同尺寸、裁剪到画布范围、压在 UI 之下 */
  mountOverlay() {
    const s = this.session;
    if (!s || s.overlay) return;
    const host = s.base.parentElement || document.body;
    const hostRect = host.getBoundingClientRect();

    const clip = document.createElement("div");
    clip.style.cssText = [
      "position:absolute",
      `left:${Math.round(s.rect.left - hostRect.left)}px`,
      `top:${Math.round(s.rect.top - hostRect.top)}px`,
      `width:${Math.round(s.rect.width)}px`,
      `height:${Math.round(s.rect.height)}px`,
      "overflow:hidden",
      "pointer-events:none",
      "z-index:2",
    ].join(";");

    const snap = s.snap;
    snap.style.cssText = "position:absolute;left:0;top:0;width:100%;height:100%;will-change:transform;backface-visibility:hidden;";
    snap.style.transformOrigin = "0 0";

    clip.appendChild(snap);
    host.appendChild(clip);
    s.clip = clip;
    s.overlay = snap;
    clip.style.pointerEvents = "auto";
    clip.style.cursor = s.mode === "zoom" ? "not-allowed" : "grab";
    requestAnimationFrame(() => {
      if (!s.clip) return;
      const h = s.base.parentElement || document.body;
      const hr = h.getBoundingClientRect();
      const br = s.base.getBoundingClientRect();
      s.clip.style.left = Math.round(br.left - hr.left) + "px";
      s.clip.style.top = Math.round(br.top - hr.top) + "px";
      s.clip.style.width = Math.round(br.width) + "px";
      s.clip.style.height = Math.round(br.height) + "px";
    });
    this.scheduleUnderlay();

    for (const c of s.canvases) c.classList.add("esz-hidden");
    // frame 名字是 DOM 元素（div.frame-name），层级在我们之上，一起藏
    s.hiddenText = Array.from((s.view.containerEl || document).querySelectorAll(".frame-name"));
    for (const el of s.hiddenText) el.classList.add("esz-hidden");
  }


  /** 起手之后异步铺一张整图低清底图，专门用来显示"照片"之外的外围 */
  ensureImages(api) {
    if (!this.imgCache) this.imgCache = new Map();
    let files = null;
    try { files = api.getFiles ? api.getFiles() : null; } catch (err) { files = null; }
    if (!files) return;
    for (const k of Object.keys(files)) {
      if (this.imgCache.has(k)) continue;
      const url = files[k] && (files[k].dataURL || files[k].dataUrl);
      if (!url) continue;
      const rec = { img: null };
      this.imgCache.set(k, rec);
      const im = new Image();
      im.onload = () => { rec.img = im; };
      im.src = url;
    }
  }

  scheduleUnderlay() {
    const s = this.session;
    if (!s) return;
    if (this.underlayTimer) clearTimeout(this.underlayTimer);
    this.underlayTimer = setTimeout(() => {
      this.underlayTimer = null;
      const cur = this.session;
      if (!cur || cur !== s) return;
      const els = cur.api.getSceneElements() || [];
      this.ensureImages(cur.api);
      if (cur.underlayFor === this.underlayKey(els)) { return; }
      const b = sceneBounds(els);
      if (!b) return;
      const maxPx = 1500;
      const scale = Math.min(maxPx / b.width, maxPx / b.height, s.zoom0);
      let cv = null;
      try {
        cv = buildUnderlay(els, b, scale, cur.api.getAppState().viewBackgroundColor || "#ffffff", this.imgCache);
      } catch (err) {
        console.warn("[smooth-zoom] underlay failed", err);
        return;
      }
      cur.underlayFor = els.length + ":" + cur.zoom0;
      cur.underlay = { cv, cover: b, scale };
      const holder = document.createElement("canvas");
      holder.width = cv.width;
      holder.height = cv.height;
      holder.getContext("2d").drawImage(cv, 0, 0);
      holder.style.cssText = "position:absolute;left:0;top:0;transform-origin:0 0;visibility:hidden;";
      holder.style.width = cv.width + "px";
      holder.style.height = cv.height + "px";
      if (cur.clip && cur.overlay) cur.clip.insertBefore(holder, cur.overlay);
      requestAnimationFrame(() => { try { holder.style.visibility = ""; } catch (err) { /* ignore */ } });
      cur.underlayEl = holder;
      this.positionUnderlay();
    }, 40);
  }

  positionUnderlay() {
    const s = this.session;
    if (!s || !s.underlayEl || !s.underlay) return;
    const u = s.underlay;
    const k = s.zoom / u.scale;
    const e = (u.cover.x + s.scrollX) * s.zoom;
    const f = (u.cover.y + s.scrollY) * s.zoom;
    s.underlayEl.style.transform = "matrix(" + k + ",0,0," + k + "," + e + "," + f + ")";
  }

  /** 缩放平滑：每帧把显示值向目标值靠拢，松手前不提交 */
  startZoomEase() {
    if (this._easeRaf) return;
    const step = () => {
      const s = this.session;
      if (!s) { this._easeRaf = null; return; }
      const tz = s.zoom;
      const tx = s.scrollX;
      const ty = s.scrollY;
      const dz = tz - s.drawZoom;
      const dx = tx - s.drawScrollX;
      const dy = ty - s.drawScrollY;
      const done = Math.abs(dz) < 1e-4 && Math.abs(dx) < 0.02 && Math.abs(dy) < 0.02;
      if (done) {
        s.drawZoom = tz; s.drawScrollX = tx; s.drawScrollY = ty;
        this.applyTransform();
        this._easeRaf = null;
        return;
      }
      s.drawZoom += dz * 0.35;
      s.drawScrollX += dx * 0.35;
      s.drawScrollY += dy * 0.35;
      this.applyTransform();
      this._easeRaf = requestAnimationFrame(step);
    };
    this._easeRaf = requestAnimationFrame(step);
  }

  applyTransform() {
    const s = this.session;
    if (!s || !s.overlay) return;
    const k = s.zoom / s.zoom0;
    const e = (s.scrollX - s.scrollX0) * s.zoom;
    const f = (s.scrollY - s.scrollY0) * s.zoom;
    s.overlay.style.transform = `matrix3d(${k},0,0,0,0,${k},0,0,0,0,1,0,${e},${f},0,1)`;
    this.positionUnderlay();
  }

  armWatchdog() {
    if (this.watchdog) clearTimeout(this.watchdog);
    this.watchdog = setTimeout(() => this.commit(), WATCHDOG_MS);
  }

  /* ------------------------------------------------------------ 交互 */

  onWheel(ev) {
    if (!this.enabled) return;
    if (ev.target && ev.target.closest && ev.target.closest(".emm-panel")) return; // 导航窗自己处理
    const view = this.view();
    if (!view || !view.containerEl.contains(ev.target)) return;
    const api = view.excalidrawAPI;
    if (!api) return;


    const zoomGesture = ev.ctrlKey || ev.metaKey;
    if (!this.session && !this.begin(view, api, zoomGesture ? "zoom" : "pan", ev)) return;
    const s = this.session;
    if (!s) return;

    ev.preventDefault();
    ev.stopPropagation();

    const st = api.getAppState();
    const offL = s.offL;
    const offT = s.offT;

    if (zoomGesture) {
      const ady = Math.abs(ev.deltaY);
      const gain = ady < 40 ? 0.012 : 0.0018;
      const f = Math.exp(-ev.deltaY * gain);
      const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, s.zoom * f));
      if (Math.abs(next - s.zoom) > 1e-9) {
        const wx = (s.ax - offL) / s.zoom - s.scrollX;
        const wy = (s.ay - offT) / s.zoom - s.scrollY;
        s.zoom = next;
        s.scrollX = (s.ax - offL) / next - wx;
        s.scrollY = (s.ay - offT) / next - wy;
      }
    } else {
      const d = ev.deltaMode === 1 ? 16 : 1;
      s.scrollX -= (ev.deltaX * d) / s.zoom;
      s.scrollY -= (ev.deltaY * d) / s.zoom;
    }

    this.applyTransform();
    this.armWatchdog();
    this.schedule();
  }

  /** Ctrl/⌘ +/-/0：Excalidraw 的缩放快捷键，也走冻结，避免全量重绘卡一下 */
  onZoomKey(ev) {
    if (!this.enabled) return;
    if (!(ev.ctrlKey || ev.metaKey)) return;
    const k = ev.key;
    if (k !== "=" && k !== "+" && k !== "-" && k !== "0") return;
    const view = this.view();
    if (!view || !view.containerEl.contains(ev.target)) return;
    const api = view.excalidrawAPI;
    if (!api) return;
    if (!this.session && !this.begin(view, api, "zoom", null)) return;
    const s = this.session;
    if (!s) return;
    ev.preventDefault();
    ev.stopPropagation();
    const st = api.getAppState();
    const offL = Number(st.offsetLeft) || 0;
    const offT = Number(st.offsetTop) || 0;
    const ax = s.rect.width / 2;
    const ay = s.rect.height / 2;
    const wx = (ax - offL) / s.zoom - s.scrollX;
    const wy = (ay - offT) / s.zoom - s.scrollY;
    let next = s.zoom;
    if (k === "0") next = 1;
    else if (k === "-") next = s.zoom / 1.15;
    else next = s.zoom * 1.15;
    next = Math.min(30, Math.max(0.1, next));
    s.zoom = next;
    s.scrollX = (ax - offL) / next - wx;
    s.scrollY = (ay - offT) / next - wy;
    this.applyTransform();
    this.armWatchdog();
    this.schedule();
  }

  /** 空格按下就冻结：用户必然是先按空格再拖 */
  /** 底图签名：元素数量 + 版本号和，内容变了才需要重建 */
  underlayKey(els) {
    let sum = 0;
    for (let i = 0; i < els.length; i += 1) sum = (sum + (els[i].versionNonce || 0)) % 2147483647;
    return els.length + ":" + sum;
  }

  buildUnderlayNow(api) {
    const els = api.getSceneElements() || [];
    const b = sceneBounds(els);
    if (!b) return null;
    const maxPx = 1500;
    const scale = Math.min(maxPx / b.width, maxPx / b.height, 1);
    const cv = buildUnderlay(els, b, scale, api.getAppState().viewBackgroundColor || "#ffffff", this.imgCache);
    this._underlay = { cv, cover: b, scale, key: this.underlayKey(els) };
    return this._underlay;
  }

  captureIdle() {
    if (this.session || !this.enabled) return;
    if (document.hidden) return;
    try {
      const leaf = this.plugin.app.workspace.activeLeaf;
      const v = leaf && leaf.view;
      if (!v || !v.getViewType || v.getViewType() !== "excalidraw") return;
    } catch (err) {
      return;
    }
    if (this._lastCommitAt && performance.now() - this._lastCommitAt < 250) return;
    const view = this.view();
    if (!view) return;
    const api = view.excalidrawAPI;
    if (!api) return;
    const cvs = this.sceneCanvases(view);
    if (!cvs) return;
    const base = cvs.base;
    if (!base.width) return;
    const st = api.getAppState();
    let c = this._snapCanvas;
    if (!c) { c = document.createElement("canvas"); this._snapCanvas = c; }
    let qq = ((st.zoom && st.zoom.value) || 1) < 0.35 ? 0.5 : 1;
    const capMax2 = 1600;
    const longest2 = Math.max(base.width, base.height) * qq;
    if (longest2 > capMax2) qq = qq * (capMax2 / longest2);
    const ww = Math.max(1, Math.round(base.width * qq));
    const hh = Math.max(1, Math.round(base.height * qq));
    if (c.width !== ww || c.height !== hh) {
      c.width = ww;
      c.height = hh;
    }
    try {
      c.getContext("2d").drawImage(base, 0, 0, c.width, c.height);
    } catch (err) {
      return;
    }
    this._idleSnap = { snap: c, view, zoom0: (st.zoom && st.zoom.value) || 1, scrollX0: st.scrollX, scrollY0: st.scrollY, at: performance.now() };
    // 同时把底图预备好，手势一来直接用
    try {
      const els = api.getSceneElements() || [];
      const key = this.underlayKey(els);
      if (!this._underlay || this._underlay.key !== key) {
        this.ensureImages(api);
        this.buildUnderlayNow(api);
      }
    } catch (err) {
      /* ignore */
    }
  }

  freezeForPan() {
    if (!this.enabled) return false;
    const view = this.view();
    if (!view) return false;
    const api = view.excalidrawAPI;
    if (!api) return false;
    if (this.session) {
      const s0 = this.session;
      if (s0.mode === "pan") return true;
      s0.mode = "pan";
      s0.zoom0 = s0.zoom;
      s0.scrollX0 = s0.scrollX;
      s0.scrollY0 = s0.scrollY;
      return true;
    }
    return this.begin(view, api, "pan", null);
  }

  onPointerDown(ev) {
    if (!this.enabled) return;
    // 空格已经预冻结的情况下，按下只记录起点
    if (this.session && this.session.mode === "pan" && this.spaceDown) {
      ev.preventDefault();
      ev.stopPropagation();
      const s0 = this.session;
      s0.startClientX = ev.clientX;
      s0.startClientY = ev.clientY;
      s0.scrollX0 = s0.scrollX;
      s0.scrollY0 = s0.scrollY;
      this.dragging = { id: ev.pointerId };
      return;
    }
    if (this.session) {
      if (this.session.mode === "pan") return;
      // 缩放结算中：禁止拖动，光标显示 not-allowed
      ev.preventDefault();
      ev.stopPropagation();
      return;
    }
    const view = this.view();
    if (!view || !view.containerEl.contains(ev.target)) return;
    const api = view.excalidrawAPI;
    if (!api) return;
    const tool = (api.getAppState().activeTool || {}).type;
    const pan = ev.button === 1 || this.spaceDown || tool === "hand";
    if (!pan) return;
    ev.preventDefault();
    ev.stopPropagation();
    this.dragging = { id: ev.pointerId };
    if (!this.session && !this.freezeForPan()) {
      this.retryPan = { view, api, x0: ev.clientX, y0: ev.clientY };
      return;
    }
    const s = this.session;
    if (s) {
      s.startClientX = ev.clientX;
      s.startClientY = ev.clientY;
      s.scrollX0 = s.scrollX;
      s.scrollY0 = s.scrollY;
    }
    ev.preventDefault();
    ev.stopPropagation();
    this.dragging = { id: ev.pointerId };
  }

  onPointerMove(ev) {
    if (this.retryPan && !this.session) {
      const r = this.retryPan;
      if (this.begin(r.view, r.api, "pan", { clientX: r.x0, clientY: r.y0 })) {
        this.dragging = { id: ev.pointerId };
      }
      this.retryPan = null;
    }
    const s = this.session;
    if (!s || s.mode !== "pan" || !this.dragging || this.dragging.id !== ev.pointerId) return;
    ev.preventDefault();
    ev.stopPropagation();
    if (s.clip) s.clip.style.cursor = "grabbing";
    s.scrollX = s.scrollX0 + (ev.clientX - s.startClientX) / s.zoom0;
    s.scrollY = s.scrollY0 + (ev.clientY - s.startClientY) / s.zoom0;
    this.applyTransform();
  }

  onPointerUp(ev) {
    if (!this.dragging || this.dragging.id !== ev.pointerId) return;
    this.dragging = null;
    if (this.session && this.session.mode === "pan") {
      ev.preventDefault();
      ev.stopPropagation();
      this.commit();
    }
  }

  /* ------------------------------------------------------------ 提交 */

  settleMs() {
    const s = this.session;
    if (!s) return SETTLE_MS;
    let ms = SETTLE_MS;
    const els = s.elementCount || 0;
    if (s.zoom < 0.45) ms += 180;
    if (s.zoom < 0.25) ms += 180;
    if (els > 3000) ms += 140;
    return ms;
  }

  schedule() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.commit(), this.settleMs());
  }

  commit(immediate) {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.watchdog) {
      clearTimeout(this.watchdog);
      this.watchdog = null;
    }
    const s = this.session;
    if (!s) return;
    this.session = null;

    const st = s.api.getAppState();
    const changed =
      Math.abs(s.zoom - s.zoom0) > 1e-6 ||
      Math.abs(s.scrollX - st.scrollX) > 0.5 ||
      Math.abs(s.scrollY - st.scrollY) > 0.5;

    if (changed) {
      try {
        s.api.updateScene({
          appState: { zoom: { value: s.zoom }, scrollX: s.scrollX, scrollY: s.scrollY },
          captureUpdate: "NEVER",
        });
      } catch (err) {
        console.warn("[smooth-zoom] commit failed", err);
      }
    }

    this._lastCommitAt = performance.now();
    this._idleSnap = null;
    clearTimeout(this._refreshTimer);
    this._refreshTimer = setTimeout(() => this.captureIdle(), 320);
    const cleanup = () => {
      if (this.underlayTimer) { clearTimeout(this.underlayTimer); this.underlayTimer = null; }
      if (s.clip && s.clip.parentElement) s.clip.parentElement.removeChild(s.clip);
      for (const el of s.hiddenText || []) el.classList.remove("esz-hidden");
      try {
        if (typeof s.api.refresh === "function") s.api.refresh();
      } catch (err) {
        /* ignore */
      }
    };
    if (immediate) {
      for (const c of s.canvases) c.classList.remove("esz-hidden");
      cleanup();
    } else {
      // 先放出真实画布让它画一帧，照片继续盖在上面；两帧后再撤照片
      for (const c of s.canvases) c.classList.remove("esz-hidden");
      requestAnimationFrame(() => requestAnimationFrame(cleanup));
    }
  }
};

/* ---------------- 外围低清底图 ---------------- */

function sceneBounds(els) {
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const el of els) {
    if (!el || el.isDeleted) continue;
    const x = el.x || 0, y = el.y || 0, w = el.width || 0, h = el.height || 0;
    x1 = Math.min(x1, x, x + w); y1 = Math.min(y1, y, y + h);
    x2 = Math.max(x2, x, x + w); y2 = Math.max(y2, y, y + h);
  }
  if (!Number.isFinite(x1)) return null;
  return { x: x1, y: y1, width: Math.max(x2 - x1, 1), height: Math.max(y2 - y1, 1) };
}

function buildUnderlay(els, cover, scale, paper, images) {
  const cw = Math.max(1, Math.round(cover.width * scale));
  const ch = Math.max(1, Math.round(cover.height * scale));
  const cv = document.createElement("canvas");
  cv.width = cw; cv.height = ch;
  const ctx = cv.getContext("2d");
  ctx.fillStyle = paper || "#ffffff";
  ctx.fillRect(0, 0, cw, ch);
  const tx = -cover.x * scale, ty = -cover.y * scale;
  const S = (v) => v * scale;

  ctx.save();
  ctx.setLineDash([Math.max(3, 6 * scale), Math.max(2, 4 * scale)]);
  ctx.strokeStyle = "rgba(127,137,150,0.85)";
  ctx.lineWidth = Math.max(0.6, 1.2 * scale);
  for (const el of els) {
    if (!el || el.isDeleted || el.type !== "frame") continue;
    ctx.strokeRect(S(el.x || 0) + tx, S(el.y || 0) + ty, Math.max(S(el.width || 0), 1), Math.max(S(el.height || 0), 1));
  }
  ctx.restore();

  const font = "px \"Virgil\", \"Excalifont\", \"Microsoft YaHei\", sans-serif";

  for (const el of els) {
    if (!el || el.isDeleted || el.type === "frame") continue;
    const x = el.x || 0, y = el.y || 0, w = el.width || 0, h = el.height || 0;
    if (x + w < cover.x || y + h < cover.y || x > cover.x + cover.width || y > cover.y + cover.height) continue;

    if (el.type === "freedraw" || el.type === "line" || el.type === "arrow") {
      const pts = el.points;
      if (!Array.isArray(pts) || pts.length < 2) continue;
      const step = Math.max(1, Math.ceil(pts.length / 40));
      ctx.strokeStyle = el.strokeColor || "#1e1e1e";
      ctx.lineWidth = Math.max(0.35, (Number(el.strokeWidth) || 2) * scale);
      ctx.lineJoin = "round";
      ctx.beginPath();
      for (let i = 0; i < pts.length; i += step) {
        const px = S(x + pts[i][0]) + tx;
        const py = S(y + pts[i][1]) + ty;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.stroke();
      continue;
    }

    const L = S(x) + tx, T = S(y) + ty, W = Math.max(S(w), 0.8), H = Math.max(S(h), 0.8);

    if (el.type === "image") {
      const rec = images && el.fileId ? images.get(el.fileId) : null;
      if (rec && rec.img) {
        try { ctx.drawImage(rec.img, L, T, W, H); continue; } catch (err) { /* fallback */ }
      }
      ctx.fillStyle = "rgba(138,143,152,0.4)";
      ctx.fillRect(L, T, W, H);
      continue;
    }

    if (el.type === "text") {
      const size = S(Number(el.fontSize) || 20);
      const tl = String(el.text || "").split("\n");
      if (size < 4) {
        ctx.fillStyle = el.strokeColor || "#1e1e1e";
        ctx.globalAlpha = 0.5;
        for (let i = 0; i < tl.length; i += 1) ctx.fillRect(L, T + size * 1.25 * (i + 0.5), W, 0.8);
        ctx.globalAlpha = 1;
        continue;
      }
      const lh = size * (Number(el.lineHeight) > 0 ? Number(el.lineHeight) : 1.25);
      ctx.font = size.toFixed(1) + font;
      ctx.fillStyle = el.strokeColor || "#1e1e1e";
      ctx.textBaseline = "middle";
      ctx.textAlign = el.textAlign === "center" ? "center" : el.textAlign === "right" ? "right" : "left";
      const ax = el.textAlign === "center" ? L + W / 2 : el.textAlign === "right" ? L + W : L;
      for (let i = 0; i < tl.length; i += 1) ctx.fillText(tl[i], ax, T + lh * (i + 0.5));
      continue;
    }

    const bg = el.backgroundColor;
    const hasBg = bg && bg !== "transparent" && bg !== "#transparent";
    const path = () => {
      ctx.beginPath();
      if (el.type === "ellipse") {
        ctx.ellipse(L + W / 2, T + H / 2, Math.max(W / 2, 0.3), Math.max(H / 2, 0.3), 0, 0, Math.PI * 2);
      } else if (el.type === "diamond") {
        ctx.moveTo(L + W / 2, T); ctx.lineTo(L + W, T + H / 2); ctx.lineTo(L + W / 2, T + H); ctx.lineTo(L, T + H / 2); ctx.closePath();
      } else {
        const r = Math.min(S(14), Math.min(W, H) * 0.22);
        if (r > 0.8) {
          ctx.moveTo(L + r, T);
          ctx.arcTo(L + W, T, L + W, T + H, r);
          ctx.arcTo(L + W, T + H, L, T + H, r);
          ctx.arcTo(L, T + H, L, T, r);
          ctx.arcTo(L, T, L + W, T, r);
          ctx.closePath();
        } else {
          ctx.rect(L, T, W, H);
        }
      }
    };
    if (hasBg) { path(); ctx.fillStyle = bg; ctx.fill(); }
    if (el.strokeColor && el.strokeColor !== "transparent") {
      path();
      ctx.strokeStyle = el.strokeColor;
      ctx.lineWidth = Math.max(0.35, (Number(el.strokeWidth) || 2) * scale);
      ctx.stroke();
    }
  }
  return cv;
}
