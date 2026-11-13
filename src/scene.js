/**
 * 场景 → 小地图图元。
 *
 * 只提取"能看出布局"的最少信息：
 *   - 矩形 / 菱形 / 椭圆 / 图片 / 嵌入物 → 一个色块
 *   - 文本 → 一个色块（宽度就是文本换行后的宽度，用来判断"长度对齐"）
 *   - 线 / 箭头 / 手绘 → 一条折线（点太多时抽样，绝不全量重绘）
 *   - Frame → 虚线外框
 * 旋转角度被忽略（小地图上肉眼无差别，省一次三角函数）。
 */

import { clamp } from "./geometry.js";

/* ------------------------------------------------------------------ 颜色 */

const HEX_RE = /^#([0-9a-f]{3,8})$/i;
const RGB_RE = /^rgba?\(([^)]+)\)$/i;

export function parseColor(color) {
  if (typeof color !== "string") return null;
  const raw = color.trim();
  if (!raw || raw === "transparent" || raw === "#transparent" || raw === "none") return null;
  if (HEX_RE.test(raw)) {
    let hex = raw.slice(1);
    if (hex.length === 3 || hex.length === 4) {
      hex = hex
        .split("")
        .map((ch) => ch + ch)
        .join("");
    }
    if (hex.length !== 6 && hex.length !== 8) return null;
    return {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16),
      a: hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1,
    };
  }
  const m = RGB_RE.exec(raw);
  if (m) {
    const parts = m[1]
      .split(/[\s,/]+/)
      .filter(Boolean)
      .map(Number);
    if (parts.length >= 3 && parts.slice(0, 3).every(Number.isFinite)) {
      return {
        r: parts[0],
        g: parts[1],
        b: parts[2],
        a: Number.isFinite(parts[3]) ? clamp(parts[3], 0, 1) : 1,
      };
    }
  }
  return null;
}

/** 把任意 CSS 颜色降成带透明度的 rgba；解析不了就返回 null（调用方跳过该元素）。 */
export function withAlpha(color, alpha) {
  const rgb = parseColor(color);
  if (!rgb) return null;
  const a = clamp(alpha * rgb.a, 0, 1);
  return `rgba(${Math.round(rgb.r)},${Math.round(rgb.g)},${Math.round(rgb.b)},${Math.round(a * 1000) / 1000})`;
}

/** 背景色偏亮 → true。用于决定小地图遮罩用黑还是白。 */
export function isLightColor(color) {
  const rgb = parseColor(color);
  if (!rgb) return true;
  const toLinear = (v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const lum = 0.2126 * toLinear(rgb.r) + 0.7152 * toLinear(rgb.g) + 0.0722 * toLinear(rgb.b);
  return lum > 0.45;
}

/* ------------------------------------------------------------------ 包围盒 */

export function elementBox(el) {
  const w = Math.abs(Number(el.width) || 0);
  const h = Math.abs(Number(el.height) || 0);
  const x = Number(el.x) || 0;
  const y = Number(el.y) || 0;
  return { x: Math.min(x, x + (Number(el.width) || 0)), y: Math.min(y, y + (Number(el.height) || 0)), width: w, height: h };
}

export function mergeBounds(a, b) {
  if (!a) return b ? { ...b } : null;
  if (!b) return { ...a };
  const x1 = Math.min(a.x, b.x);
  const y1 = Math.min(a.y, b.y);
  const x2 = Math.max(a.x + a.width, b.x + b.width);
  const y2 = Math.max(a.y + a.height, b.y + b.height);
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

export function expandBounds(bounds, pad) {
  if (!bounds) return null;
  return { x: bounds.x - pad, y: bounds.y - pad, width: bounds.width + pad * 2, height: bounds.height + pad * 2 };
}

export function sceneBounds(elements) {
  let out = null;
  if (!elements) return null;
  for (const el of elements) {
    if (!el || el.isDeleted || el.type === "selection") continue;
    out = mergeBounds(out, elementBox(el));
  }
  return out;
}

/* ------------------------------------------------------------------ 图元 */

function isSkipped(el) {
  if (!el || el.isDeleted) return true;
  if (el.type === "selection" || el.type === "magicframe") return true;
  if (opacityOf(el) === 0) return true;
  // 绑定在形状里的文字：形状本身已经占位，再画一遍只是噪点
  return Boolean(el.containerId) && el.type === "text";
}

/** Excalidraw 的 opacity 是 0–100；也兼容直接给 0–1 的情况。 */
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
    // 世界空间的抽稀：相距太近的点直接丢掉（缩放后本来也看不见）
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
    bh: box.height,
  });
  return true;
}

/**
 * @param {Array} elements Excalidraw 元素数组
 * @param {{maxFreedrawPoints?:number, pointBudget?:number, outlineOnly?:boolean}} [opts]
 */
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
    // 点数预算用完 → 退化成外框色块
  }

  const box = elementBox(el);
  if (!(box.width > 0) && !(box.height > 0)) return null;

  // 文本：保留真字形，渲染时按比例决定是画字还是画条
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
          color: withAlpha(el.strokeColor, 0.95 * alpha) || `rgba(30,32,36,${0.9 * alpha})`,
        },
      ],
      points: 0,
      polys: 0,
      dots: 1,
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
        dashed,
      },
    ],
    points: 0,
    polys: 0,
    dots: 1,
  };
}
/**
 * 元素 → 小地图图元。
 *
 * 第三个参数是"按元素缓存"：只给变过的元素重新算，其余复用上次结果。
 * 4600 元素的画布上，写一笔只需要处理那一笔，重建从 ~34 ms 降到 ~2 ms。
 *
 * @param {Array} elements
 * @param {{maxFreedrawPoints?:number, pointBudget?:number, outlineOnly?:boolean}} [opts]
 * @param {{map:Map, optsKey:string}|null} [cache]
 */
export function buildItems(elements, opts = {}, cache = null) {
  const options = {
    maxFreedrawPoints: 48,
    pointBudget: 150000,
    outlineOnly: false,
    simplifyWorld: 0,
    ...opts,
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
  const next = cache ? new Map() : null;

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

/** 按元素缓存容器（面板持有一份即可）。 */
export function createItemCache() {
  return { map: new Map(), optsKey: "" };
}

/** 元素总点数，用来提示"这张图有多重"。 */
export function countPoints(elements) {
  let n = 0;
  if (!elements) return 0;
  for (const el of elements) {
    if (!el || el.isDeleted) continue;
    if (Array.isArray(el.points)) n += el.points.length;
  }
  return n;
}

/**
 * 廉价场景指纹：长度 + 各元素 versionNonce 之和。
 * 有些 Excalidraw 版本每次 getSceneElements() 都返回新数组，
 * 只比引用会每帧都重画；加这层指纹可以把"真的变了"和"只是新数组"区分开。
 */
export function sceneSignature(elements) {
  if (!elements) return 0;
  let hash = elements.length | 0;
  for (let i = 0; i < elements.length; i += 1) {
    const el = elements[i];
    if (!el) continue;
    hash = (hash + (el.versionNonce | 0) + (el.isDeleted ? 1 : 0)) | 0;
  }
  return hash;
}
