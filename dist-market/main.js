var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

// src/main.js
var main_exports = {};
__export(main_exports, {
  default: () => ExcalidrawMinimapPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian2 = require("obsidian");

// src/geometry.js
var MIN_ZOOM = 0.1;
var MAX_ZOOM = 30;
function clamp(value, lo, hi) {
  return value < lo ? lo : value > hi ? hi : value;
}
function zoomOf(appState) {
  const raw = appState && appState.zoom;
  const value = typeof raw === "number" ? raw : raw && raw.value;
  return Number.isFinite(value) && value > 0 ? value : 1;
}
function viewportSizeOf(appState, fallback) {
  const width = Number(appState && appState.width);
  const height = Number(appState && appState.height);
  return {
    width: Number.isFinite(width) && width > 1 ? width : fallback && fallback.width || 0,
    height: Number.isFinite(height) && height > 1 ? height : fallback && fallback.height || 0
  };
}
function visibleSceneRect(appState, fallbackSize) {
  const zoom = zoomOf(appState);
  const offsetLeft = 0;
  const offsetTop = 0;
  const size = viewportSizeOf(appState, fallbackSize);
  return {
    x: -offsetLeft / zoom - appState.scrollX,
    y: -offsetTop / zoom - appState.scrollY,
    width: size.width / zoom,
    height: size.height / zoom
  };
}
function scrollToPinScenePoint(sceneX, sceneY, viewportX, viewportY, nextZoom, appState) {
  const offsetLeft = 0;
  const offsetTop = 0;
  const zoom = clamp(nextZoom, MIN_ZOOM, MAX_ZOOM);
  return {
    zoom,
    scrollX: (viewportX - offsetLeft) / zoom - sceneX,
    scrollY: (viewportY - offsetTop) / zoom - sceneY
  };
}

// src/scene.js
var HEX_RE = /^#([0-9a-f]{3,8})$/i;
var RGB_RE = /^rgba?\(([^)]+)\)$/i;
function parseColor(color) {
  if (typeof color !== "string") return null;
  const raw = color.trim();
  if (!raw || raw === "transparent" || raw === "#transparent" || raw === "none") return null;
  if (HEX_RE.test(raw)) {
    let hex = raw.slice(1);
    if (hex.length === 3 || hex.length === 4) {
      hex = hex.split("").map((ch) => ch + ch).join("");
    }
    if (hex.length !== 6 && hex.length !== 8) return null;
    return {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16),
      a: hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1
    };
  }
  const m = RGB_RE.exec(raw);
  if (m) {
    const parts = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    if (parts.length >= 3 && parts.slice(0, 3).every(Number.isFinite)) {
      return {
        r: parts[0],
        g: parts[1],
        b: parts[2],
        a: Number.isFinite(parts[3]) ? clamp(parts[3], 0, 1) : 1
      };
    }
  }
  return null;
}
function withAlpha(color, alpha) {
  const rgb = parseColor(color);
  if (!rgb) return null;
  const a = clamp(alpha * rgb.a, 0, 1);
  return `rgba(${Math.round(rgb.r)},${Math.round(rgb.g)},${Math.round(rgb.b)},${Math.round(a * 1e3) / 1e3})`;
}
function isLightColor(color) {
  const rgb = parseColor(color);
  if (!rgb) return true;
  const toLinear = (v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const lum = 0.2126 * toLinear(rgb.r) + 0.7152 * toLinear(rgb.g) + 0.0722 * toLinear(rgb.b);
  return lum > 0.45;
}
function elementBox(el) {
  const w = Math.abs(Number(el.width) || 0);
  const h = Math.abs(Number(el.height) || 0);
  const x = Number(el.x) || 0;
  const y = Number(el.y) || 0;
  return { x: Math.min(x, x + (Number(el.width) || 0)), y: Math.min(y, y + (Number(el.height) || 0)), width: w, height: h };
}
function mergeBounds(a, b) {
  if (!a) return b ? { ...b } : null;
  if (!b) return { ...a };
  const x1 = Math.min(a.x, b.x);
  const y1 = Math.min(a.y, b.y);
  const x2 = Math.max(a.x + a.width, b.x + b.width);
  const y2 = Math.max(a.y + a.height, b.y + b.height);
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}
function sceneBounds(elements) {
  let out = null;
  if (!elements) return null;
  for (const el of elements) {
    if (!el || el.isDeleted || el.type === "selection") continue;
    out = mergeBounds(out, elementBox(el));
  }
  return out;
}
function isSkipped(el) {
  if (!el || el.isDeleted) return true;
  if (el.type === "selection" || el.type === "magicframe") return true;
  if (opacityOf(el) === 0) return true;
  return Boolean(el.containerId) && el.type === "text";
}
function opacityOf(el) {
  const raw = Number(el.opacity);
  if (!Number.isFinite(raw)) return 1;
  return clamp(raw > 1 ? raw / 100 : raw, 0, 1);
}
function pushPoly(items, el, alpha, opts) {
  const points = el.points;
  if (!Array.isArray(points) || points.length < 2) return false;
  const total = points.length;
  const maxPoints = opts.maxFreedrawPoints;
  const step = Math.max(1, Math.ceil(total / Math.max(2, maxPoints)));
  const minDist = Math.max(Number(opts.simplifyWorld) || 0, 0);
  const flat = [];
  let lastX2 = NaN;
  let lastY2 = NaN;
  for (let i = 0; i < total; i += step) {
    const px = el.x + points[i][0];
    const py = el.y + points[i][1];
    if (minDist > 0 && Number.isFinite(lastX2) && Math.abs(px - lastX2) + Math.abs(py - lastY2) < minDist) continue;
    flat.push(px, py);
    lastX2 = px;
    lastY2 = py;
  }
  const lastPoint = points[total - 1];
  const lastX = el.x + lastPoint[0];
  const lastY = el.y + lastPoint[1];
  if (flat[flat.length - 2] !== lastX || flat[flat.length - 1] !== lastY) {
    flat.push(lastX, lastY);
  }
  if (flat.length < 4) return false;
  const color = withAlpha(el.strokeColor, (el.type === "arrow" ? 0.95 : 0.9) * alpha);
  if (!color) return false;
  const box = elementBox(el);
  items.push({
    kind: "poly",
    id: el.id,
    pts: flat,
    color,
    // 世界线宽，渲染时乘 scale
    strokeWidth: Number(el.strokeWidth) || 2,
    pointCount: flat.length >> 1,
    bx: box.x,
    by: box.y,
    bw: box.width,
    bh: box.height
  });
  return true;
}
function elementToItems(el, options, budget) {
  const alpha = opacityOf(el);
  const type = el.type;
  if (type === "line" || type === "arrow" || type === "freedraw") {
    if (budget > 8) {
      const scratch = [];
      if (pushPoly(scratch, el, alpha, options)) {
        return { items: scratch, points: scratch[0].pointCount, polys: 1, dots: 0 };
      }
    }
  }
  const box = elementBox(el);
  if (!(box.width > 0) && !(box.height > 0)) return null;
  if (type === "text") {
    const text = el.text || el.originalText || "";
    if (!text.trim()) return null;
    return {
      items: [
        {
          kind: "text",
          id: el.id,
          x: box.x,
          y: box.y,
          w: box.width,
          h: box.height,
          text,
          fontSize: Number(el.fontSize) || 20,
          align: el.textAlign === "center" || el.textAlign === "right" ? el.textAlign : "left",
          lineHeight: Number(el.lineHeight) > 0 ? Number(el.lineHeight) : 1.25,
          color: withAlpha(el.strokeColor, 0.95 * alpha) || `rgba(30,32,36,${0.9 * alpha})`
        }
      ],
      points: 0,
      polys: 0,
      dots: 1
    };
  }
  let fill = null;
  let stroke = null;
  let dashed = false;
  let shape = "rect";
  if (type === "frame") {
    dashed = true;
    stroke = withAlpha("rgb(127,137,150)", 0.5);
  } else if (type === "image") {
    fill = `rgba(126,131,142,${0.34 * alpha})`;
  } else if (type === "diamond") {
    shape = "diamond";
    fill = withAlpha(el.backgroundColor, alpha);
    stroke = withAlpha(el.strokeColor, 0.9 * alpha);
  } else if (type === "ellipse") {
    shape = "ellipse";
    fill = withAlpha(el.backgroundColor, alpha);
    stroke = withAlpha(el.strokeColor, 0.9 * alpha);
  } else {
    fill = withAlpha(el.backgroundColor, alpha);
    stroke = withAlpha(el.strokeColor, 0.9 * alpha);
  }
  if (options.outlineOnly) {
    stroke = fill || stroke;
    fill = null;
  }
  if (!fill && !stroke) return null;
  return {
    items: [
      {
        kind: "box",
        id: el.id,
        shape,
        x: box.x,
        y: box.y,
        w: box.width,
        h: box.height,
        fill,
        stroke,
        strokeWidth: Number(el.strokeWidth) || 2,
        dashed
      }
    ],
    points: 0,
    polys: 0,
    dots: 1
  };
}
function buildItems(elements, opts = {}, cache = null) {
  const options = {
    maxFreedrawPoints: 48,
    pointBudget: 15e4,
    outlineOnly: false,
    simplifyWorld: 0,
    ...opts
  };
  const optsKey = `${options.maxFreedrawPoints}|${options.pointBudget}|${options.outlineOnly ? 1 : 0}|${Math.round((options.simplifyWorld || 0) * 10)}`;
  let previous = null;
  if (cache) {
    if (cache.optsKey !== optsKey) {
      cache.map.clear();
      cache.optsKey = optsKey;
    }
    previous = cache.map;
  }
  const next = cache ? /* @__PURE__ */ new Map() : null;
  const items = [];
  let budget = options.pointBudget;
  let polyCount = 0;
  let dots = 0;
  if (!elements || !elements.length) {
    if (cache) cache.map = next;
    return { items, stats: { elements: 0, polys: 0, dots } };
  }
  for (const el of elements) {
    if (isSkipped(el)) continue;
    const cacheable = previous && next && typeof el.id === "string" && Number.isFinite(el.versionNonce);
    const cached = cacheable ? previous.get(el.id) : null;
    if (cached && cached.nonce === el.versionNonce) {
      for (let i = 0; i < cached.items.length; i += 1) items.push(cached.items[i]);
      budget -= cached.points;
      polyCount += cached.polys;
      dots += cached.dots;
      next.set(el.id, cached);
      continue;
    }
    const made = elementToItems(el, options, budget);
    if (!made) continue;
    for (let i = 0; i < made.items.length; i += 1) items.push(made.items[i]);
    budget -= made.points;
    polyCount += made.polys;
    dots += made.dots;
    if (cacheable) next.set(el.id, { nonce: el.versionNonce, ...made });
  }
  if (cache) cache.map = next;
  return { items, stats: { elements: elements.length, polys: polyCount, dots } };
}
function createItemCache() {
  return { map: /* @__PURE__ */ new Map(), optsKey: "" };
}
function sceneSignature(elements) {
  if (!elements) return 0;
  let hash = elements.length | 0;
  for (let i = 0; i < elements.length; i += 1) {
    const el = elements[i];
    if (!el) continue;
    hash = hash + (el.versionNonce | 0) + (el.isDeleted ? 1 : 0) | 0;
  }
  return hash;
}

// src/renderer.js
function computeFit(bounds, width, height, padding = 6) {
  const bw = Math.max(Number(bounds && bounds.width) || 0, 1e-6);
  const bh = Math.max(Number(bounds && bounds.height) || 0, 1e-6);
  const availW = Math.max(width - padding * 2, 1);
  const availH = Math.max(height - padding * 2, 1);
  const scale = Math.min(availW / bw, availH / bh);
  const drawW = bw * scale;
  const drawH = bh * scale;
  return {
    scale,
    tx: (width - drawW) / 2 - (bounds && bounds.x || 0) * scale,
    ty: (height - drawH) / 2 - (bounds && bounds.y || 0) * scale
  };
}
var FONT_STACK = '"Segoe UI", "Microsoft YaHei", "PingFang SC", system-ui, sans-serif';
function drawScene(ctx, model, opts) {
  const width = Math.max(1, Math.round(opts.width));
  const height = Math.max(1, Math.round(opts.height));
  const dpr = opts.dpr || 1;
  const fit = opts.fit || computeFit(model.bounds, width, height, opts.padding == null ? 6 : opts.padding);
  const s = fit.scale;
  const tx = fit.tx;
  const ty = fit.ty;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (opts.clear !== false) {
    ctx.clearRect(0, 0, width, height);
    if (opts.background) {
      ctx.fillStyle = opts.background;
      ctx.fillRect(0, 0, width, height);
    }
  }
  ctx.save();
  if (opts.clip !== false) {
    ctx.beginPath();
    ctx.rect(0, 0, width, height);
    ctx.clip();
  }
  const selection = opts.selectionIds || null;
  const cull = opts.cull || null;
  const rects = /* @__PURE__ */ new Map();
  const shapes = /* @__PURE__ */ new Map();
  const dashes = /* @__PURE__ */ new Map();
  const strokes = /* @__PURE__ */ new Map();
  const polys = /* @__PURE__ */ new Map();
  const dots = /* @__PURE__ */ new Map();
  const texts = [];
  const tinyTexts = /* @__PURE__ */ new Map();
  const selectedBoxes = [];
  const selectedPolys = [];
  let drawn = 0;
  const push = (map, key, values) => {
    let list = map.get(key);
    if (!list) {
      list = [];
      map.set(key, list);
    }
    list.push(values);
  };
  const items = model.items || [];
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    if (cull) {
      const ix = item.kind === "poly" ? item.bx : item.x;
      const iy = item.kind === "poly" ? item.by : item.y;
      const iw = item.kind === "poly" ? item.bw : item.w;
      const ih = item.kind === "poly" ? item.bh : item.h;
      if (ix + iw < cull.x || iy + ih < cull.y || ix > cull.x + cull.width || iy > cull.y + cull.height) continue;
    }
    const selected = selection ? selection.has(item.id) : false;
    if (item.kind === "poly") {
      const pts = item.pts;
      if (!pts || pts.length < 4) continue;
      const lw = Math.max(0.55, (item.strokeWidth || 2) * s);
      push(polys, `${item.color}|${Math.round(lw * 10) / 10}`, pts);
      if (selected) selectedPolys.push(item);
      drawn += 1;
      continue;
    }
    if (item.kind === "text") {
      const fs = (item.fontSize || 20) * s;
      if (fs < 12) {
        push(tinyTexts, item.color, [item.x * s + tx, item.y * s + ty, Math.max(item.w * s, 1), fs, item.lineHeight || 1.25, item.text]);
      } else {
        texts.push(item);
      }
      drawn += 1;
      continue;
    }
    const x = item.x * s + tx;
    const y = item.y * s + ty;
    const w = Math.max(item.w * s, 0);
    const h = Math.max(item.h * s, 0);
    const strokeW = Math.max(0.55, (item.strokeWidth || 2) * s);
    if (item.dashed) {
      push(dashes, item.stroke || "rgba(127,137,150,0.55)", [x, y, w, h]);
    } else if (w < 1.4 || h < 1.4) {
      push(dots, item.fill || item.stroke || "rgba(80,84,92,0.5)", [x, y]);
    } else if (item.shape === "rect") {
      if (item.fill) push(rects, item.fill, [x, y, w, h]);
      if (item.stroke) push(strokes, `${item.stroke}|${Math.round(strokeW * 10) / 10}`, [x, y, w, h]);
    } else if (item.fill || item.stroke) {
      push(shapes, `${item.fill || "-"}|${item.stroke || "-"}|${item.shape}|${Math.round(strokeW * 10) / 10}`, [x, y, w, h]);
    }
    if (selected) selectedBoxes.push([x, y, w, h]);
    drawn += 1;
  }
  for (const [color, list] of rects) {
    ctx.fillStyle = color;
    ctx.beginPath();
    for (let i = 0; i < list.length; i += 1) {
      const r = list[i];
      ctx.rect(r[0], r[1], r[2], r[3]);
    }
    ctx.fill();
  }
  for (const [key, list] of shapes) {
    const parts = key.split("|");
    const fill = parts[0] === "-" ? null : parts[0];
    const stroke = parts[1] === "-" ? null : parts[1];
    const shape = parts[2];
    const lw = Number(parts[3]) || 1;
    ctx.beginPath();
    for (let i = 0; i < list.length; i += 1) {
      const [x, y, w, h] = list[i];
      if (shape === "diamond") {
        ctx.moveTo(x + w / 2, y);
        ctx.lineTo(x + w, y + h / 2);
        ctx.lineTo(x + w / 2, y + h);
        ctx.lineTo(x, y + h / 2);
        ctx.closePath();
      } else {
        ctx.moveTo(x + w, y + h / 2);
        ctx.ellipse(x + w / 2, y + h / 2, Math.max(w / 2, 0.1), Math.max(h / 2, 0.1), 0, 0, Math.PI * 2);
      }
    }
    if (fill) {
      ctx.fillStyle = fill;
      ctx.fill();
    }
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = lw;
      ctx.stroke();
    }
  }
  for (const [color, list] of dashes) {
    ctx.save();
    ctx.setLineDash([2, 2.5]);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < list.length; i += 1) {
      const r = list[i];
      ctx.rect(r[0] + 0.5, r[1] + 0.5, Math.max(r[2], 1), Math.max(r[3], 1));
    }
    ctx.stroke();
    ctx.restore();
  }
  for (const [key, list] of strokes) {
    const sep = key.lastIndexOf("|");
    const color = key.slice(0, sep);
    const lw = Number(key.slice(sep + 1)) || 1;
    ctx.strokeStyle = color;
    ctx.lineWidth = lw;
    ctx.beginPath();
    for (let i = 0; i < list.length; i += 1) {
      const r = list[i];
      ctx.rect(r[0], r[1], r[2], r[3]);
    }
    ctx.stroke();
  }
  const MIN_STEP = 0.55;
  const tinyStrokes = /* @__PURE__ */ new Map();
  for (const [key, list] of polys) {
    const sep = key.lastIndexOf("|");
    const color = key.slice(0, sep);
    const lw = Number(key.slice(sep + 1)) || 1;
    ctx.strokeStyle = color;
    ctx.lineWidth = lw;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.beginPath();
    let any = false;
    for (let i = 0; i < list.length; i += 1) {
      const pts = list[i];
      const n = pts.length;
      if (n < 4) continue;
      const x0 = pts[0] * s + tx;
      const y0 = pts[1] * s + ty;
      const xe = pts[n - 2] * s + tx;
      const ye = pts[n - 1] * s + ty;
      if (Math.abs(xe - x0) + Math.abs(ye - y0) < 0.75 && n <= 6) {
        let bucket = tinyStrokes.get(color);
        if (!bucket) {
          bucket = [];
          tinyStrokes.set(color, bucket);
        }
        bucket.push(x0, y0);
        continue;
      }
      ctx.moveTo(x0, y0);
      let lx = x0;
      let ly = y0;
      for (let p = 2; p < n; p += 2) {
        const px = pts[p] * s + tx;
        const py = pts[p + 1] * s + ty;
        if (p < n - 2 && Math.abs(px - lx) + Math.abs(py - ly) < MIN_STEP) continue;
        ctx.lineTo(px, py);
        lx = px;
        ly = py;
      }
      any = true;
    }
    if (any) ctx.stroke();
  }
  for (const [color, pts] of tinyStrokes) {
    ctx.fillStyle = color;
    ctx.beginPath();
    for (let i = 0; i < pts.length; i += 2) ctx.rect(pts[i], pts[i + 1], 1, 1);
    ctx.fill();
  }
  for (const [color, list] of dots) {
    ctx.fillStyle = color;
    ctx.beginPath();
    for (let i = 0; i < list.length; i += 1) {
      const d = list[i];
      ctx.rect(d[0] - 0.25, d[1] - 0.25, 1.75, 1.75);
    }
    ctx.fill();
  }
  for (const [color, list] of tinyTexts) {
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.7;
    ctx.lineWidth = 0.9;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    for (let i = 0; i < list.length; i += 1) {
      const t = list[i];
      const [x, y, w, fs, lh, text] = t;
      const lines = String(text || "").split("\n").length || 1;
      const lineH = fs * lh;
      const amp = Math.max(0.4, Math.min(fs * 0.16, 1.4));
      const step = Math.max(1.2, Math.min(fs * 0.55, 3));
      for (let l = 0; l < lines; l += 1) {
        const by = y + lineH * (l + 0.45);
        ctx.beginPath();
        let px = x;
        let first = true;
        for (; px <= x + w; px += step) {
          const yy = by + Math.sin(px * 0.9 + i * 1.7) * amp;
          if (first) {
            ctx.moveTo(px, yy);
            first = false;
          } else {
            ctx.lineTo(px, yy);
          }
        }
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }
  if (texts.length) {
    ctx.textBaseline = "middle";
    for (let i = 0; i < texts.length; i += 1) {
      const item = texts[i];
      const fs = (item.fontSize || 20) * s;
      const lh = fs * (item.lineHeight || 1.25);
      const x = item.x * s + tx;
      const y = item.y * s + ty;
      const w = item.w * s;
      const h = item.h * s;
      ctx.save();
      ctx.beginPath();
      ctx.rect(x - 1, y - 1, w + 2, h + 2);
      ctx.clip();
      ctx.font = `${fs.toFixed(1)}px ${FONT_STACK}`;
      ctx.fillStyle = item.color;
      ctx.textAlign = item.align === "center" ? "center" : item.align === "right" ? "right" : "left";
      const anchorX = item.align === "center" ? x + w / 2 : item.align === "right" ? x + w : x;
      const lines = String(item.text || "").split("\n");
      for (let l = 0; l < lines.length; l += 1) {
        ctx.fillText(lines[l], anchorX, y + lh * (l + 0.5));
      }
      ctx.restore();
    }
  }
  const accent = opts.accent || "rgba(75,140,255,0.9)";
  if (selectedBoxes.length || selectedPolys.length) {
    ctx.strokeStyle = accent;
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    for (let i = 0; i < selectedBoxes.length; i += 1) {
      const r = selectedBoxes[i];
      ctx.rect(r[0] - 0.75, r[1] - 0.75, r[2] + 1.5, r[3] + 1.5);
    }
    for (let i = 0; i < selectedPolys.length; i += 1) {
      const pts = selectedPolys[i].pts;
      ctx.moveTo(pts[0] * s + tx, pts[1] * s + ty);
      for (let p = 2; p < pts.length; p += 2) ctx.lineTo(pts[p] * s + tx, pts[p + 1] * s + ty);
    }
    ctx.stroke();
  }
  ctx.restore();
  return { fit, drawn, groups: rects.size + shapes.size + dashes.size + strokes.size + polys.size + dots.size };
}

// src/mapview.js
var MIN_MAP_SCALE = 0.01;
var MAX_MAP_SCALE = 8;
function clampScale(scale) {
  if (!Number.isFinite(scale) || scale <= 0) return 1;
  return scale < MIN_MAP_SCALE ? MIN_MAP_SCALE : scale > MAX_MAP_SCALE ? MAX_MAP_SCALE : scale;
}
function toWorld(view, x, y) {
  return { x: (x - view.ox) / view.scale, y: (y - view.oy) / view.scale };
}
function panelWorldRect(view, width, height) {
  return {
    x: -view.ox / view.scale,
    y: -view.oy / view.scale,
    width: width / view.scale,
    height: height / view.scale
  };
}
function zoomAround(view, px, py, factor) {
  const scale = clampScale(view.scale * factor);
  if (Math.abs(scale - view.scale) < 1e-9) return { ...view };
  const world = toWorld(view, px, py);
  return { scale, ox: px - world.x * scale, oy: py - world.y * scale };
}
function fitScale(bounds, width, height, padding = 6) {
  const bw = Math.max(Number(bounds && bounds.width) || 0, 1e-6);
  const bh = Math.max(Number(bounds && bounds.height) || 0, 1e-6);
  const availW = Math.max(width - padding * 2, 1);
  const availH = Math.max(height - padding * 2, 1);
  return clampScale(Math.min(availW / bw, availH / bh));
}
function viewForBounds(bounds, width, height, padding = 6) {
  const scale = fitScale(bounds, width, height, padding);
  const cx = (bounds.x || 0) + (bounds.width || 0) / 2;
  const cy = (bounds.y || 0) + (bounds.height || 0) / 2;
  return { scale, ox: width / 2 - cx * scale, oy: height / 2 - cy * scale };
}
function centerOnPoint(view, wx, wy, width, height) {
  return { scale: view.scale, ox: width / 2 - wx * view.scale, oy: height / 2 - wy * view.scale };
}
function expandRect(rect, factorX, factorY) {
  const dw = Math.abs(rect.width) * factorX;
  const dh = Math.abs(rect.height) * factorY;
  return { x: rect.x - dw, y: rect.y - dh, width: rect.width + dw * 2, height: rect.height + dh * 2 };
}
function rectContains(outer, inner, tolerance = 0.5) {
  return inner.x >= outer.x - tolerance && inner.y >= outer.y - tolerance && inner.x + inner.width <= outer.x + outer.width + tolerance && inner.y + inner.height <= outer.y + outer.height + tolerance;
}

// src/panel.js
var MIN_PANEL_W = 150;
var MIN_PANEL_H = 110;
var SNAP_DISTANCE = 40;
var MAX_STANDARD = 0.4;
var COVERAGE_INTERVAL = 90;
var HEAVY_INTERVAL = 750;
var HEAVY_QUIET = 320;
var HEAVY_MAX_STALE = 1800;
var HEAVY_COUNT = 1200;
var COVERAGE_MARGIN = 0.75;
var MAX_LAYER_PIXELS = 42e5;
var MinimapPanel = class {
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
    this.dimLayer = document.createElement("div");
    this.dimLayer.className = "emm-dim";
    this.dimParts = [0, 1, 2, 3].map(() => {
      const part = document.createElement("div");
      this.dimLayer.appendChild(part);
      return part;
    });
    this.bar = document.createElement("div");
    this.bar.className = "emm-bar";
    this.bar.title = "\u62D6\u52A8\u8FD9\u91CC\u79FB\u52A8\u5C0F\u5730\u56FE";
    const dots = document.createElement("div");
    dots.className = "emm-bar-dots";
    for (let i = 0; i < 3; i += 1) dots.appendChild(document.createElement("i"));
    this.bar.appendChild(dots);
    this.resetBtn = document.createElement("div");
    this.resetBtn.className = "emm-reset";
    this.resetBtn.title = "\u56DE\u6B63\uFF1A\u628A\u6807\u51C6\u4F4D\u7F6E\u590D\u4F4D\u5230\u5BFC\u822A\u5668\u4E2D\u5FC3";
    this.resetBtn.textContent = "\u25CE";
    this.handle = document.createElement("div");
    this.handle.className = "emm-handle";
    this.handle.title = "\u62D6\u52A8\u8FD9\u4E2A\u89D2\u8C03\u6574\u5927\u5C0F\uFF08\u5BF9\u89D2\u56FA\u5B9A\u4E0D\u52A8\uFF09";
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
    else this._viewReady = false;
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
        oy: this._oy
      };
      try {
        canvas.setPointerCapture(ev.pointerId);
      } catch (err) {
      }
      if (this.boxHit(px, py)) {
        this._dragMode = "pan";
        const vp = this._viewport;
        const v = this.mapView;
        if (vp) {
          const centerX = vp.x * v.scale + v.ox + vp.width * v.scale / 2;
          const centerY = vp.y * v.scale + v.oy + vp.height * v.scale / 2;
          this._dragStart.grabX = centerX - px;
          this._dragStart.grabY = centerY - py;
          this._dragStart.centerX = centerX;
          this._dragStart.centerY = centerY;
        }
        this.navigateToEvent(ev);
      } else {
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
      }
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
      y: Math.min(Math.max(point.y, box.y - padY), box.y + box.height + padY)
    };
  }
  navigateToEvent(ev) {
    if (!this._viewReady) return;
    const rect = this.canvas.getBoundingClientRect();
    let px = ev.clientX - rect.left;
    let py = ev.clientY - rect.top;
    const start = this._dragStart;
    const grabX = start && Number.isFinite(start.grabX) ? start.grabX : 0;
    const grabY = start && Number.isFinite(start.grabY) ? start.grabY : 0;
    let centerX = px + grabX;
    let centerY = py + grabY;
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
    return this._pointerType === "pen" && performance.now() - (this._pointerAt || 0) < 3e3;
  }
  onWheel(ev) {
    if (this.penActive()) {
      const st0 = this._st;
      if (st0 && this._viewReady) {
        ev.preventDefault();
        ev.stopPropagation();
        const rect0 = this.canvas.getBoundingClientRect();
        const next0 = zoomAround(this.mapView, rect0.width / 2, rect0.height / 2, Math.exp(-ev.deltaY * 16e-4));
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
      const rect2 = this.canvas.getBoundingClientRect();
      const world = toWorld(this.mapView, ev.clientX - rect2.left, ev.clientY - rect2.top);
      const zoom = zoomOf(st);
      const nextZoom = clamp(zoom * Math.exp(-ev.deltaY * 15e-4), 0.1, 30);
      if (Math.abs(nextZoom - zoom) < 1e-4) return;
      this.plugin.zoomAt(this.leafView, world, (world.x + st.scrollX) * zoom, (world.y + st.scrollY) * zoom, nextZoom);
      return;
    }
    if (!this._viewReady) return;
    const rect = this.canvas.getBoundingClientRect();
    const next = zoomAround(this.mapView, rect.width / 2, rect.height / 2, Math.exp(-ev.deltaY * 16e-4));
    this._scale = next.scale;
    this._ox = next.ox;
    this._oy = next.oy;
    this._layerDirty = true;
    this.settings.mapScale = next.scale;
    this.plugin.saveSettings();
    this.paint();
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
    if (!animate || Math.abs(targetX - fromX) < 0.6 && Math.abs(targetY - fromY) < 0.6) {
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
    const cx = vp.x * v.scale + v.ox + vp.width * v.scale / 2;
    const cy = vp.y * v.scale + v.oy + vp.height * v.scale / 2;
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
        top: panelRect.top - hostRect.top
      };
      this.el.classList.add("is-dragging");
      try {
        bar.setPointerCapture(ev.pointerId);
      } catch (err) {
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
      ["tl", Math.hypot(left, top), left, top]
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
      try {
        bar.setPointerCapture(ev.pointerId);
      } catch (err) {
      }
    });
    bar.addEventListener("pointermove", (ev) => {
      if (!start) return;
      ev.preventDefault();
      const dx = ev.clientX - start.x;
      const dy = ev.clientY - start.y;
      const damp = 1 + Math.abs(dy) / 30;
      const factor = Math.exp(dx * 0.03 / damp);
      const next = Math.max(0.03, Math.min(1, start.scale * factor));
      this.setMapScaleCentered(next);
    });
    const end = (ev) => {
      if (!start) return;
      start = null;
      try {
        bar.releasePointerCapture(ev.pointerId);
      } catch (err) {
      }
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
        panelTop: r.top
      };
      this.el.classList.add("is-dragging");
      try {
        handle.setPointerCapture(ev.pointerId);
      } catch (err) {
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
      if (this.settings.freeLeft != null) {
        const left = fromRight ? start.left : start.anchorX - width;
        const top = fromBottom ? start.top : start.anchorY - height;
        this.el.style.left = `${Math.round(Math.max(0, left))}px`;
        this.el.style.top = `${Math.round(Math.max(0, top))}px`;
        this.el.style.right = "auto";
        this.el.style.bottom = "auto";
      }
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
    const c = view && view.containerEl ? view.containerEl.querySelector("canvas.excalidraw__canvas.static") || view.containerEl.querySelector("canvas.excalidraw__canvas") : null;
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
    const background = st && st.viewBackgroundColor || "#ffffff";
    const light = isLightColor(background);
    return {
      background,
      light,
      dim: light ? "rgba(0,0,0,0.12)" : "rgba(0,0,0,0.34)",
      accent: light ? "rgba(47,111,214,0.95)" : "rgba(122,178,255,0.95)",
      emptyTextColor: light ? "rgba(90,96,106,0.75)" : "rgba(190,196,206,0.75)"
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
      let margin = COVERAGE_MARGIN;
      cover = expandRect(panelWorld, margin, margin);
      while (cover.width * view.scale * dpr * cover.height * view.scale * dpr > MAX_LAYER_PIXELS && margin > 0.02) {
        margin *= 0.6;
        cover = expandRect(panelWorld, margin, margin);
      }
    }
    if (cover.x > panelWorld.x || cover.y > panelWorld.y || cover.x + cover.width < panelWorld.x + panelWorld.width || cover.y + cover.height < panelWorld.y + panelWorld.height) {
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
        padding: 0
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
    const set = /* @__PURE__ */ new Set();
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
    this.badge.title = `\u5730\u56FE\u6BD4\u4F8B ${pct}% \xB7 \u753B\u5E03\u7F29\u653E ${zoom}%${stats ? ` \xB7 ${stats.elements} \u4E2A\u5143\u7D20` : ""}`;
  }
  /* ------------------------------------------------------------ 轮询 */
  tick(now, force) {
    if (!this.el || !this.el.isConnected) return false;
    if (this.el.clientWidth < 8) return false;
    const view = this.leafView;
    if (!view || view.getViewType && view.getViewType() !== "excalidraw") return false;
    const api = view.excalidrawAPI;
    if (!api || typeof api.getSceneElements !== "function") {
      this.renderPlaceholder("\u7B49\u5F85\u753B\u5E03\u52A0\u8F7D\u2026");
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
    const viewportChanged = force || !this._st || st.scrollX !== this._st.scrollX || st.scrollY !== this._st.scrollY || zoom !== this._zoom || Math.abs(vp.width - this._vw) > 0.01 || Math.abs(vp.height - this._vh) > 0.01 || this._sizeKey !== `${size.width}x${size.height}@${Math.min(window.devicePixelRatio || 1, 2.5)}`;
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
          simplifyWorld: Math.max(diag * 12e-4, 0.5)
        },
        this._itemCache
      );
      this._items = built.items;
      this._stats = built.stats;
      this._sceneBox = sceneBounds(els);
      this._layerDirty = true;
    }
    this.ensureView(size);
    if (viewportChanged && this._dragMode !== "pan" && !this._anim) {
      const last = this._followAt || 0;
      if (now - last > 700) {
        this._followAt = now;
        const std = this.standard();
        const v = this.mapView;
        const bx = vp.x * v.scale + v.ox + vp.width * v.scale / 2;
        const by = vp.y * v.scale + v.oy + vp.height * v.scale / 2;
        const targetX = size.width / 2 + std.x;
        const targetY = size.height / 2 + std.y;
        if (Math.abs(bx - targetX) > 2 || Math.abs(by - targetY) > 2) {
          this.animateTo(this._ox + (targetX - bx), this._oy + (targetY - by), true, 380);
        }
      }
    }
    const panelWorld = panelWorldRect(this.mapView, size.width, size.height);
    const coverageOk = this._layerCover && this._layerScale === this.mapView.scale && rectContains(this._layerCover, panelWorld, -2);
    const heavy = (this._items ? this._items.length : 0) > HEAVY_COUNT;
    const interval = heavy ? HEAVY_INTERVAL : COVERAGE_INTERVAL;
    const quiet = now - (this._lastSceneAt || 0);
    const stale = now - this._layerAt;
    const allowed = !heavy || quiet >= HEAVY_QUIET || stale >= HEAVY_MAX_STALE;
    const canRender = force || allowed && stale >= interval;
    if ((this._layerDirty || !coverageOk) && canRender) {
      this.renderLayer(now);
    }
    this.paint();
    return true;
  }
  renderPlaceholder(text) {
    if (!this.ctx || this._placeholder === text && this._painted) return;
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
    if (this.badge) this.badge.textContent = "\u2014";
  }
};

// src/settings.js
var import_obsidian = require("obsidian");
var DEFAULT_SETTINGS = {
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
  suppressHints: true
};
var MinimapSettingTab = class extends import_obsidian.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    const s = this.plugin.settings;
    containerEl.replaceChildren();
    const title = document.createElement("h2");
    title.textContent = "Excali \u753B\u5E03\u4F18\u5316";
    containerEl.appendChild(title);
    const intro = document.createElement("p");
    intro.className = "setting-item-description";
    intro.textContent = "\u4E24\u5757\u529F\u80FD\uFF1A\u2460\u53F3\u4E0B\u89D2\u7684\u5BFC\u822A\u5C0F\u5730\u56FE\u2014\u2014\u4E0D\u7F29\u5C0F\u4E3B\u753B\u5E03\u4E5F\u80FD\u770B\u6E05\u6574\u5F20\u56FE\u7684\u4F4D\u7F6E\u548C\u5BF9\u9F50\uFF1B\u2461\u987A\u6ED1\u7F29\u653E\u2014\u2014\u7F29\u653E\u65F6\u5148\u51BB\u7ED3\u753B\u9762\uFF0C\u505C\u624B\u540E\u518D\u6E32\u67D3\u9AD8\u6E05\uFF0C\u51E0\u5343\u7B14\u753B\u4E5F\u4E0D\u5361\u3002";
    containerEl.appendChild(intro);
    containerEl.createEl("h3", { text: "\u5E38\u7528" });
    new import_obsidian.Setting(containerEl).setName("\u663E\u793A\u5BFC\u822A\u5C0F\u5730\u56FE").setDesc("\u5173\u6389\u540E\u4E0D\u6302\u9762\u677F\u3001\u4E0D\u8F6E\u8BE2\uFF1B\u9700\u8981\u65F6\u53EF\u7528\u5DE6\u4FA7\u680F\u56FE\u6807\u6216\u547D\u4EE4\u5524\u51FA\u3002").addToggle(
      (t) => t.setValue(s.navigatorEnabled !== false).onChange(async (v) => {
        s.navigatorEnabled = v;
        await this.plugin.saveSettingsAndSync();
      })
    );
    new import_obsidian.Setting(containerEl).setName("\u4EA4\u4E92\u6A21\u5F0F").setDesc(
      "\u9F20\u6807\uFF1A\u6EDA\u8F6E\u7F29\u653E\u5C0F\u5730\u56FE\uFF0CCtrl+\u6EDA\u8F6E\u7F29\u653E\u4E3B\u753B\u5E03\u3002\u7B14\uFF08\u6570\u4F4D\u677F\uFF09\uFF1A\u6EDA\u8F6E\u76F4\u63A5\u7F29\u653E\u4E3B\u753B\u5E03\u4E0D\u7528\u6309 Ctrl\uFF0C\u5E76\u63A5\u7BA1\u952E\u76D8\u7126\u70B9\u4E0E\u6EDA\u8F6E\u76EE\u6807\uFF08TourBox \u65CB\u94AE\u53EF\u7528\uFF09\u3002"
    ).addDropdown((d) => {
      d.addOption("mouse", "\u9F20\u6807");
      d.addOption("pen", "\u7B14\uFF08\u6570\u4F4D\u677F\uFF09");
      return d.setValue(s.inputMode || "mouse").onChange(async (v) => {
        await this.plugin.setInputMode(v);
        await this.plugin.saveSettingsAndSync();
      });
    });
    new import_obsidian.Setting(containerEl).setName("\u987A\u6ED1\u7F29\u653E").setDesc("\u7F29\u653E\u65F6\u51BB\u7ED3\u753B\u9762\u3001\u53EA\u79FB\u52A8\u4E00\u5F20\u4F4D\u56FE\uFF0C\u505C\u624B\u540E\u518D\u6E32\u67D3\u9AD8\u6E05\u3002\u5173\u6389\u5C31\u662F Excalidraw \u539F\u751F\u884C\u4E3A\u3002").addToggle(
      (t) => t.setValue(s.smoothEnabled !== false).onChange(async (v) => {
        s.smoothEnabled = v;
        if (this.plugin.smooth) {
          this.plugin.smooth.enabled = v;
          if (!v) this.plugin.smooth.commit();
        }
        await this.plugin.saveSettingsAndSync();
      })
    );
    new import_obsidian.Setting(containerEl).setName("\u5173\u95ED\u753B\u5E03\u63D0\u793A\uFF08Show hint\uFF09").setDesc("Excalidraw \u90A3\u6761\u201C\u8981\u79FB\u52A8\u753B\u5E03\uFF0C\u8BF7\u6309\u4F4F\u2026\u201D\u7684\u63D0\u793A\u6BCF\u6B21\u91CD\u542F\u90FD\u4F1A\u81EA\u5DF1\u56DE\u6765\uFF0C\u8FD9\u91CC\u6BCF\u6B21\u8FDB\u5165\u753B\u5E03\u65F6\u81EA\u52A8\u5173\u6389\u3002").addToggle(
      (t) => t.setValue(s.suppressHints !== false).onChange(async (v) => {
        s.suppressHints = v;
        await this.plugin.saveSettingsAndSync();
      })
    );
    new import_obsidian.Setting(containerEl).setName("\u505C\u624B\u5224\u5B9A").setDesc("\u505C\u624B\u540E\u7B49\u591A\u4E45\u624D\u6E32\u67D3\u9AD8\u6E05\uFF08\u6BEB\u79D2\uFF09\u3002\u8D8A\u5927\u8D8A\u7701 CPU\uFF0C\u4F46\u53D8\u6E05\u6670\u66F4\u6162\uFF1B\u7F29\u5F97\u5F88\u5C0F\u65F6\u63D2\u4EF6\u4F1A\u81EA\u52A8\u518D\u5EF6\u957F\u3002").addSlider(
      (sl) => sl.setLimits(120, 600, 20).setValue(s.smoothSettleMs || 260).setDynamicTooltip().onChange(async (v) => {
        s.smoothSettleMs = v;
        await this.plugin.saveSettingsAndSync();
      })
    );
    const adv = document.createElement("details");
    adv.className = "exo-advanced";
    const sum = document.createElement("summary");
    sum.textContent = "\u9AD8\u7EA7\u9009\u9879";
    adv.appendChild(sum);
    containerEl.appendChild(adv);
    const hint = document.createElement("p");
    hint.className = "setting-item-description";
    hint.textContent = "\u4F4D\u7F6E\u3001\u5927\u5C0F\u3001\u5730\u56FE\u6BD4\u4F8B\u4E0D\u5728\u8FD9\u91CC\u8C03\uFF1A\u76F4\u63A5\u62D6\u9762\u677F\u9876\u90E8\u7684\u4E09\u9897\u70B9\u79FB\u52A8\u3001\u62D6\u53F3\u4E0B\u89D2\u659C\u7EB9\u6539\u5927\u5C0F\u3001\u6EDA\u8F6E\u6216\u7528\u5E95\u90E8\u6A2A\u6761\u6539\u6BD4\u4F8B\u3002";
    adv.appendChild(hint);
    new import_obsidian.Setting(adv).setName("\u81EA\u52A8\u663E\u793A\u5C0F\u5730\u56FE").setDesc("\u6253\u5F00 Excalidraw \u753B\u5E03\u65F6\u81EA\u52A8\u51FA\u73B0\uFF1B\u5173\u6389\u540E\u9700\u624B\u52A8\u5524\u51FA\u3002").addToggle(
      (t) => t.setValue(s.autoShow).onChange(async (v) => {
        s.autoShow = v;
        await this.plugin.saveSettingsAndSync();
      })
    );
    new import_obsidian.Setting(adv).setName("\u538B\u6697\u89C6\u53E3\u4EE5\u5916\u533A\u57DF").setDesc("\u4E00\u773C\u770B\u51FA\u5F53\u524D\u5C4F\u5E55\u770B\u5230\u7684\u662F\u6574\u5F20\u56FE\u7684\u54EA\u4E00\u5757\u3002").addToggle(
      (t) => t.setValue(s.dimOutside).onChange(async (v) => {
        s.dimOutside = v;
        await this.plugin.saveSettingsAndSync();
      })
    );
    new import_obsidian.Setting(adv).setName("\u9AD8\u4EAE\u9009\u4E2D\u7684\u5143\u7D20").setDesc("\u5728\u5C0F\u5730\u56FE\u4E0A\u7ED9\u9009\u4E2D\u7684\u5143\u7D20\u63CF\u4E00\u5708\u84DD\u8FB9\u3002").addToggle(
      (t) => t.setValue(s.highlightSelection).onChange(async (v) => {
        s.highlightSelection = v;
        await this.plugin.saveSettingsAndSync();
      })
    );
    new import_obsidian.Setting(adv).setName("\u53EA\u753B\u8F6E\u5ED3").setDesc("\u4E0D\u586B\u8272\u53EA\u63CF\u8FB9\uFF0C\u5143\u7D20\u7279\u522B\u591A\u3001\u673A\u5668\u5403\u529B\u65F6\u6700\u7701\u3002").addToggle(
      (t) => t.setValue(s.outlineOnly).onChange(async (v) => {
        s.outlineOnly = v;
        await this.plugin.saveSettingsAndSync();
      })
    );
    new import_obsidian.Setting(adv).setName("\u663E\u793A\u7F29\u653E\u767E\u5206\u6BD4").setDesc("\u5C0F\u5730\u56FE\u5DE6\u4E0A\u89D2\u663E\u793A\u5730\u56FE\u6BD4\u4F8B\u3002").addToggle(
      (t) => t.setValue(s.showZoomBadge).onChange(async (v) => {
        s.showZoomBadge = v;
        await this.plugin.saveSettingsAndSync();
      })
    );
    new import_obsidian.Setting(adv).setName("\u9762\u677F\u900F\u660E\u5EA6").setDesc("\u5C0F\u5730\u56FE\u7684\u4E0D\u900F\u660E\u5EA6\uFF0C\u6321\u5230\u5185\u5BB9\u65F6\u53EF\u4EE5\u8C03\u4F4E\u3002").addSlider(
      (sl) => sl.setLimits(0.4, 1, 0.02).setValue(s.opacity).setDynamicTooltip().onChange(async (v) => {
        s.opacity = v;
        await this.plugin.saveSettingsAndSync();
      })
    );
    new import_obsidian.Setting(adv).setName("\u624B\u7ED8\u91C7\u6837\u70B9\u6570").setDesc("\u6BCF\u6761\u624B\u7ED8\u5728\u5C0F\u5730\u56FE\u4E0A\u6700\u591A\u753B\u51E0\u4E2A\u70B9\uFF08\u9ED8\u8BA4 48\uFF09\u3002\u8C03\u5C0F\u66F4\u7701\u3002").addSlider(
      (sl) => sl.setLimits(8, 160, 4).setValue(s.maxFreedrawPoints).setDynamicTooltip().onChange(async (v) => {
        s.maxFreedrawPoints = v;
        await this.plugin.saveSettingsAndSync();
      })
    );
    new import_obsidian.Setting(adv).setName("\u5237\u65B0\u95F4\u9694").setDesc("\u9ED8\u8BA4 250 \u6BEB\u79D2\uFF1B\u4E3B\u753B\u5E03\u79FB\u52A8\u65F6\u4F1A\u81EA\u52A8\u63D0\u5230 60 \u6BEB\u79D2\u8DDF\u968F\u3002").addSlider(
      (sl) => sl.setLimits(60, 600, 10).setValue(s.tickMs).setDynamicTooltip().onChange(async (v) => {
        s.tickMs = v;
        await this.plugin.saveSettingsAndSync();
      })
    );
    new import_obsidian.Setting(adv).setName("\u6062\u590D\u9ED8\u8BA4\u4F4D\u7F6E\u548C\u5927\u5C0F").setDesc("\u653E\u56DE\u53F3\u4E0B\u89D2\u3001\u5C3A\u5BF8\u56DE\u5230 292\xD7210\u3002").addButton(
      (b) => b.setButtonText("\u91CD\u7F6E").onClick(async () => {
        s.corner = "br";
        s.freeLeft = null;
        s.freeTop = null;
        s.width = 292;
        s.height = 210;
        await this.plugin.saveSettingsAndSync();
        this.display();
      })
    );
    containerEl.createEl("h3", { text: "\u5173\u4E8E" });
    new import_obsidian.Setting(containerEl).setName("\u68C0\u6D4B\u66F4\u65B0").setDesc("\u4ECE GitHub \u68C0\u67E5\u662F\u5426\u6709\u65B0\u7248\u672C\uFF08\u5F53\u524D v" + this.plugin.manifest.version + "\uFF09").addButton(
      (b) => b.setButtonText("\u68C0\u6D4B").onClick(async () => {
        const cur = this.plugin.manifest.version;
        const repo = "https://github.com/changxi4848/excalidraw-canvas-optimizer";
        try {
          const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 1e4));
          const req = (0, import_obsidian.requestUrl)({
            url: "https://api.github.com/repos/changxi4848/excalidraw-canvas-optimizer/releases/latest",
            headers: { "User-Agent": "obsidian-excali-canvas-optimizer" },
            throw: false
          });
          const res = await Promise.race([req, timeout]);
          if (!res || res.status >= 400) {
            new import_obsidian.Notice("\u68C0\u6D4B\u5931\u8D25\uFF1AGitHub \u8FD4\u56DE " + (res ? res.status : "\u65E0\u54CD\u5E94") + "\u3002\u53EF\u80FD\u662F\u7F51\u7EDC\u65E0\u6CD5\u8BBF\u95EE GitHub\u3002\n\u53D1\u5E03\u9875\uFF1A" + repo + "/releases", 15e3);
            return;
          }
          const data = res.json || {};
          const tag = String(data.tag_name || "");
          const latest = tag.replace(/^v/i, "");
          if (!latest) {
            new import_obsidian.Notice("GitHub \u4E0A\u8FD8\u6CA1\u6709\u53D1\u5E03\u7248\u672C\n" + repo + "/releases", 1e4);
            return;
          }
          if (latest === cur) new import_obsidian.Notice("\u5DF2\u662F\u6700\u65B0\u7248\u672C v" + cur);
          else new import_obsidian.Notice("\u53D1\u73B0\u65B0\u7248\u672C " + tag + "\uFF08\u5F53\u524D v" + cur + "\uFF09\n" + (data.html_url || repo + "/releases"), 15e3);
        } catch (err) {
          const msg = String(err && err.message ? err.message : err);
          if (msg === "timeout") {
            new import_obsidian.Notice("\u68C0\u6D4B\u8D85\u65F6\uFF1A10 \u79D2\u6CA1\u8FDE\u4E0A GitHub\u3002\u9700\u8981\u4EE3\u7406\u624D\u80FD\u8BBF\u95EE\u3002\n\u53D1\u5E03\u9875\uFF1A" + repo + "/releases", 15e3);
          } else {
            new import_obsidian.Notice("\u68C0\u6D4B\u5931\u8D25\uFF1A" + msg + "\n\u53EF\u80FD\u662F\u7F51\u7EDC\u65E0\u6CD5\u8BBF\u95EE GitHub\u3002\u53D1\u5E03\u9875\uFF1A" + repo + "/releases", 15e3);
          }
        }
      })
    );
    const aboutLines = [
      "Excali \u753B\u5E03\u4F18\u5316  v1.0.1",
      "\u4F5C\u8005\uFF1A\u5362\u957F\u5E0C  https://github.com/changxi4848",
      "\u8BE5\u63D2\u4EF6\u662F Excalidraw \u7684\u7B2C\u4E09\u65B9\u8F85\u52A9\u4F18\u5316\u63D2\u4EF6\uFF0C\u4E2A\u4EBA\u5F00\u53D1\u3001\u968F\u7F18\u7EF4\u62A4\uFF0C\u4EC5\u652F\u6301 Windows \u7AEF\u3002",
      "",
      "\u4E09\u4E2A\u529F\u80FD\uFF1A\u5BFC\u822A\u5C0F\u5730\u56FE + \u7F29\u653E\u62D6\u52A8\u6027\u80FD\u4F18\u5316 + \u6570\u4F4D\u677F\u4F53\u9A8C\u4F18\u5316\u3002",
      "\u5BFC\u822A\u5C0F\u5730\u56FE\uFF1A\u64CD\u4F5C\u5F88\u7B80\u5355\uFF0C\u81EA\u5DF1\u8BD5\u3002",
      "\u7F29\u653E\u62D6\u52A8\u4F18\u5316\uFF1A\u53D6\u6D88\u4E86\u539F\u7248\u7684\u5168\u57DF\u5B9E\u65F6\u5237\u65B0\uFF0C\u6539\u7528\u66F4\u6D41\u7545\u7684\u51BB\u7ED3\u65B9\u6848\u3002",
      "\u6570\u4F4D\u677F\u4F53\u9A8C\u4F18\u5316\uFF1A\u7B14\u6A21\u5F0F\u4E0B\u5207\u6362\u6807\u7B7E\u9875\u65F6\uFF0C\u628A\u9F20\u6807\u5149\u6807\u590D\u4F4D\u5230\u753B\u9762\u4E2D\u5FC3\uFF0C\u8BA9\u7F29\u653E\u5FEB\u6377\u952E\u7684\u4E2D\u5FC3\u6B63\u786E\u3002",
      "",
      "\u5C0F\u5730\u56FE\u624B\u52BF\uFF1A\u70B9\u51FB = \u628A\u4E3B\u753B\u5E03\u79FB\u8FC7\u53BB\uFF1B\u62D6\u4EAE\u8272\u533A = \u79FB\u52A8\u89C6\u53E3\uFF1B\u62D6\u6697\u8272\u533A = \u62D6\u5730\u56FE\u5E76\u8BBE\u5B9A\u6807\u51C6\u4F4D\u7F6E\uFF1B\u6EDA\u8F6E = \u7F29\u653E\u5730\u56FE\uFF1BShift+\u62D6 = \u9501\u8F74\uFF1B\u53CC\u51FB = \u6574\u5F20\u56FE\u3002",
      "\u9762\u677F\u624B\u52BF\uFF1A\u62D6\u4E09\u9897\u70B9 = \u79FB\u52A8\uFF1B\u62D6\u53F3\u4E0B\u89D2 = \u6539\u5927\u5C0F\uFF1B\u25CE = \u56DE\u6B63\uFF1B\u5E95\u90E8\u6A2A\u6761 = \u7F29\u653E\u5730\u56FE\uFF08\u8D8A\u9760\u8FB9\u8D8A\u7CBE\u7EC6\uFF09\u3002",
      "\u4E3B\u753B\u5E03\u7F29\u653E\uFF1ACtrl+\u6EDA\u8F6E / \u89E6\u6478\u677F\u53CC\u6307 / Ctrl\xB1 / Ctrl+0\uFF1B\u62D6\u52A8\uFF1A\u7A7A\u683C+\u62D6\u3001\u4E2D\u952E\u62D6\u3001\u624B\u578B\u5DE5\u5177\u3002"
    ];
    for (const line of aboutLines) {
      const p = document.createElement("p");
      p.className = "setting-item-description";
      p.textContent = line;
      containerEl.appendChild(p);
    }
  }
};

// src/smooth.js
var MIN_ZOOM2 = 0.1;
var MAX_ZOOM2 = 30;
var SETTLE_MS = 260;
var WATCHDOG_MS = 3e3;
var SmoothZoom = class {
  constructor(plugin) {
    this.plugin = plugin;
    this.app = plugin.app;
    this.settings = plugin.settings;
  }
  start() {
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
      name: "\u5207\u6362\u987A\u6ED1\u7F29\u653E\uFF08\u5B9E\u9A8C\uFF09",
      callback: () => {
        this.enabled = !this.enabled;
        if (!this.enabled) this.commit();
        console.log("[smooth-zoom] enabled =", this.enabled);
      }
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
    const leaf = this.app.workspace.getMostRecentLeaf ? this.app.workspace.getMostRecentLeaf() : this.app.workspace.activeLeaf;
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
    let snap = null;
    const cached = this._snapCache;
    let reuse = null;
    const idle = this._idleSnap;
    if (idle && idle.view === view && idle.at > (this._lastCommitAt || 0) && performance.now() - idle.at < 1500) reuse = idle;
    if (reuse) snap = reuse.snap;
    try {
      if (!snap) {
        let q = (st.zoom && st.zoom.value || 1) < 0.35 ? 0.5 : 1;
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
    const zoom = reuse ? reuse.zoom0 : st.zoom && st.zoom.value || 1;
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
      startClientY: ev ? ev.clientY : 0
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
      "z-index:2"
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
    s.hiddenText = Array.from((s.view.containerEl || document).querySelectorAll(".frame-name"));
    for (const el of s.hiddenText) el.classList.add("esz-hidden");
  }
  /** 起手之后异步铺一张整图低清底图，专门用来显示"照片"之外的外围 */
  ensureImages(api) {
    if (!this.imgCache) this.imgCache = /* @__PURE__ */ new Map();
    let files = null;
    try {
      files = api.getFiles ? api.getFiles() : null;
    } catch (err) {
      files = null;
    }
    if (!files) return;
    for (const k of Object.keys(files)) {
      if (this.imgCache.has(k)) continue;
      const url = files[k] && (files[k].dataURL || files[k].dataUrl);
      if (!url) continue;
      const rec = { img: null };
      this.imgCache.set(k, rec);
      const im = new Image();
      im.onload = () => {
        rec.img = im;
      };
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
      if (cur.underlayFor === this.underlayKey(els)) {
        return;
      }
      const b = sceneBounds2(els);
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
      requestAnimationFrame(() => {
        try {
          holder.style.visibility = "";
        } catch (err) {
        }
      });
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
      if (!s) {
        this._easeRaf = null;
        return;
      }
      const tz = s.zoom;
      const tx = s.scrollX;
      const ty = s.scrollY;
      const dz = tz - s.drawZoom;
      const dx = tx - s.drawScrollX;
      const dy = ty - s.drawScrollY;
      const done = Math.abs(dz) < 1e-4 && Math.abs(dx) < 0.02 && Math.abs(dy) < 0.02;
      if (done) {
        s.drawZoom = tz;
        s.drawScrollX = tx;
        s.drawScrollY = ty;
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
    if (ev.target && ev.target.closest && ev.target.closest(".emm-panel")) return;
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
      const gain = ady < 40 ? 0.012 : 18e-4;
      const f = Math.exp(-ev.deltaY * gain);
      const next = Math.min(MAX_ZOOM2, Math.max(MIN_ZOOM2, s.zoom * f));
      if (Math.abs(next - s.zoom) > 1e-9) {
        const wx = (s.ax - offL) / s.zoom - s.scrollX;
        const wy = (s.ay - offT) / s.zoom - s.scrollY;
        s.zoom = next;
        s.scrollX = (s.ax - offL) / next - wx;
        s.scrollY = (s.ay - offT) / next - wy;
      }
    } else {
      const d = ev.deltaMode === 1 ? 16 : 1;
      s.scrollX -= ev.deltaX * d / s.zoom;
      s.scrollY -= ev.deltaY * d / s.zoom;
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
    const b = sceneBounds2(els);
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
    if (!c) {
      c = document.createElement("canvas");
      this._snapCanvas = c;
    }
    let qq = (st.zoom && st.zoom.value || 1) < 0.35 ? 0.5 : 1;
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
    this._idleSnap = { snap: c, view, zoom0: st.zoom && st.zoom.value || 1, scrollX0: st.scrollX, scrollY0: st.scrollY, at: performance.now() };
    try {
      const els = api.getSceneElements() || [];
      const key = this.underlayKey(els);
      if (!this._underlay || this._underlay.key !== key) {
        this.ensureImages(api);
        this.buildUnderlayNow(api);
      }
    } catch (err) {
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
    if (els > 3e3) ms += 140;
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
    const changed = Math.abs(s.zoom - s.zoom0) > 1e-6 || Math.abs(s.scrollX - st.scrollX) > 0.5 || Math.abs(s.scrollY - st.scrollY) > 0.5;
    if (changed) {
      try {
        s.api.updateScene({
          appState: { zoom: { value: s.zoom }, scrollX: s.scrollX, scrollY: s.scrollY },
          captureUpdate: "NEVER"
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
      if (this.underlayTimer) {
        clearTimeout(this.underlayTimer);
        this.underlayTimer = null;
      }
      if (s.clip && s.clip.parentElement) s.clip.parentElement.removeChild(s.clip);
      for (const el of s.hiddenText || []) el.classList.remove("esz-hidden");
      try {
        if (typeof s.api.refresh === "function") s.api.refresh();
      } catch (err) {
      }
    };
    if (immediate) {
      for (const c of s.canvases) c.classList.remove("esz-hidden");
      cleanup();
    } else {
      for (const c of s.canvases) c.classList.remove("esz-hidden");
      requestAnimationFrame(() => requestAnimationFrame(cleanup));
    }
  }
};
function sceneBounds2(els) {
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const el of els) {
    if (!el || el.isDeleted) continue;
    const x = el.x || 0, y = el.y || 0, w = el.width || 0, h = el.height || 0;
    x1 = Math.min(x1, x, x + w);
    y1 = Math.min(y1, y, y + h);
    x2 = Math.max(x2, x, x + w);
    y2 = Math.max(y2, y, y + h);
  }
  if (!Number.isFinite(x1)) return null;
  return { x: x1, y: y1, width: Math.max(x2 - x1, 1), height: Math.max(y2 - y1, 1) };
}
function buildUnderlay(els, cover, scale, paper, images) {
  const cw = Math.max(1, Math.round(cover.width * scale));
  const ch = Math.max(1, Math.round(cover.height * scale));
  const cv = document.createElement("canvas");
  cv.width = cw;
  cv.height = ch;
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
  const font = 'px "Virgil", "Excalifont", "Microsoft YaHei", sans-serif';
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
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
      continue;
    }
    const L = S(x) + tx, T = S(y) + ty, W = Math.max(S(w), 0.8), H = Math.max(S(h), 0.8);
    if (el.type === "image") {
      const rec = images && el.fileId ? images.get(el.fileId) : null;
      if (rec && rec.img) {
        try {
          ctx.drawImage(rec.img, L, T, W, H);
          continue;
        } catch (err) {
        }
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
        ctx.moveTo(L + W / 2, T);
        ctx.lineTo(L + W, T + H / 2);
        ctx.lineTo(L + W / 2, T + H);
        ctx.lineTo(L, T + H / 2);
        ctx.closePath();
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
    if (hasBg) {
      path();
      ctx.fillStyle = bg;
      ctx.fill();
    }
    if (el.strokeColor && el.strokeColor !== "transparent") {
      path();
      ctx.strokeStyle = el.strokeColor;
      ctx.lineWidth = Math.max(0.35, (Number(el.strokeWidth) || 2) * scale);
      ctx.stroke();
    }
  }
  return cv;
}

// stub:focus-stub
var FocusHelper = class {
  constructor() {
    __publicField(this, "helperProc", null);
  }
  async start() {
  }
  async stop() {
  }
};

// src/main.js
var EXCALIDRAW_VIEW = "excalidraw";
var ExcalidrawMinimapPlugin = class extends import_obsidian2.Plugin {
  async onload() {
    const saved = await this.loadData();
    this.settings = Object.assign({}, DEFAULT_SETTINGS, saved || {});
    if (!saved) {
      try {
        const raw = await this.app.vault.adapter.read(".obsidian/plugins/excalidraw-minimap/data.json");
        const legacy = JSON.parse(raw);
        this.settings = Object.assign({}, DEFAULT_SETTINGS, legacy, { navigatorEnabled: true });
      } catch (err) {
      }
    }
    this.panels = /* @__PURE__ */ new Map();
    this.pending = /* @__PURE__ */ new Map();
    this.leafState = /* @__PURE__ */ new Map();
    this.panMethod = "updateScene";
    this._verify = null;
    this._raf = null;
    this._saveTimer = null;
    this._syncTimer = null;
    this._failures = /* @__PURE__ */ new Map();
    this._moduleErrors = {};
    this.smooth = new SmoothZoom(this);
    this.focus = new FocusHelper(this);
    if (this.settings.inputMode === "pen") {
      try {
        await this.focus.start();
      } catch (err) {
        this._moduleErrors.focus = String(err && (err.message || err));
        console.warn("[optimizer] \u7B14\u6A21\u5F0F\u52A9\u624B\u542F\u7528\u5931\u8D25", err);
      }
    }
    this.smooth.enabled = this.settings.smoothEnabled !== false;
    try {
      this.smooth.start();
    } catch (err) {
      this._moduleErrors.smooth = String(err && (err.message || err));
      console.error("[optimizer] \u987A\u6ED1\u7F29\u653E\u542F\u7528\u5931\u8D25", err);
    }
    this.addRibbonIcon("map", "\u5207\u6362 Excalidraw \u5C0F\u5730\u56FE", () => this.toggleActive());
    this.addCommand({
      id: "toggle-minimap",
      name: "\u5207\u6362\u5F53\u524D\u753B\u5E03\u7684\u5C0F\u5730\u56FE",
      callback: () => this.toggleActive()
    });
    this.addCommand({
      id: "fit-minimap-bounds",
      name: "\u5C0F\u5730\u56FE\uFF1A\u628A\u89C6\u53E3\u62C9\u56DE\u5168\u90E8\u5185\u5BB9",
      callback: () => this.fitViewport()
    });
    this.addSettingTab(new MinimapSettingTab(this.app, this));
    this.registerEvent(this.app.workspace.on("layout-change", () => this.scheduleSync()));
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => {
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
    return { errors: this._moduleErrors || {}, failures: Array.from((this._failures || /* @__PURE__ */ new Map()).entries()) };
  }
  onunload() {
    if (this._pendingTimer) {
      clearInterval(this._pendingTimer);
      this._pendingTimer = null;
    }
    this.pending.clear();
    if (this.focus) {
      try {
        this.focus.stop();
      } catch (err) {
      }
    }
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
    }
  }
  async setInputMode(mode) {
    this.settings.inputMode = mode;
    await this.saveData(this.settings);
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
        if (!alive || now - at > 15e3) this.pending.delete(leaf);
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
      if (n === 1 || n === 5) console.warn("[optimizer] " + name + " \u5931\u8D25 " + n + " \u6B21", err);
      if (n === 5) {
        this._moduleErrors[name] = String(err && (err.message || err));
        if (name === "smooth" && this.smooth) this.smooth.enabled = false;
        if (name === "navigator") this.settings.navigatorEnabled = false;
        new import_obsidian2.Notice("Excali \u753B\u5E03\u4F18\u5316\uFF1A" + name + " \u8FDE\u7EED\u51FA\u9519\uFF0C\u5DF2\u81EA\u52A8\u505C\u7528");
      }
      return fallback;
    }
  }
  sync() {
    for (const p of this.panels.values()) {
      p._st = null;
      p._vw = 0;
      p._vh = 0;
      p._painted = false;
      p._layerDirty = true;
      p._followAt = performance.now();
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
      const stale = !live.has(leaf) || !view || panel.leaf.view !== view || !view.containerEl || !view.containerEl.isConnected || !panel.el || !panel.el.isConnected || panel._container !== view.containerEl;
      if (stale) {
        panel.unmount();
        this.panels.delete(leaf);
      }
    }
    for (const leaf of leaves) {
      if (!this.shouldShow(leaf)) {
        const panel2 = this.panels.get(leaf);
        if (panel2) {
          panel2.unmount();
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
    const leaf = this.activeLeaf();
    const view = leaf && leaf.view;
    if (!view || !view.getViewType || view.getViewType() !== EXCALIDRAW_VIEW) {
      new import_obsidian2.Notice("\u8BF7\u5148\u6253\u5F00\u4E00\u5F20 Excalidraw \u753B\u5E03");
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
    }
    if (document.hidden) return;
    for (const panel of this.panels.values()) {
      try {
        panel.tick(performance.now());
      } catch (err) {
        console.error("[excalidraw-minimap] \u7ED8\u5236\u5931\u8D25", err);
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
        console.warn("[excalidraw-minimap] setViewport \u5931\u8D25\uFF0C\u9000\u56DE updateScene", err);
        this.panMethod = "updateScene";
      }
    }
    const appState = {};
    if (Number.isFinite(patch.scrollX)) appState.scrollX = patch.scrollX;
    if (Number.isFinite(patch.scrollY)) appState.scrollY = patch.scrollY;
    if (Number.isFinite(patch.zoom)) appState.zoom = { value: clamp(patch.zoom, 0.1, 30) };
    try {
      api.updateScene({ appState, captureUpdate: "NEVER" });
      return true;
    } catch (err) {
      console.error("[excalidraw-minimap] updateScene \u5931\u8D25", err);
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
        console.info("[excalidraw-minimap] updateScene \u672A\u6539\u53D8\u89C6\u53E3\uFF0C\u6539\u7528 setViewport");
        this.panMethod = "setViewport";
      }
    }
    check.confirmed = true;
    this._verify = null;
  }
};
module.exports = module.exports.default || module.exports;
