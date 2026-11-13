/**
 * 地图视图：世界坐标 ↔ 面板像素 的映射，以及"取景框/覆盖范围"的计算。
 *
 * 关键约定：
 *   - 视图参数 {scale, ox, oy} 里的 ox/oy 是**相对面板左上角**的偏移；
 *   - scale 是绝对口径：scale = 1 表示 1 世界单位 = 1 CSS 像素，也就是画布上的 100%；
 *   - 面板只是世界图上的一个窗口，改窗口大小不动 scale/ox/oy。
 *
 * 全部是纯函数，方便单测。
 */

export const MIN_MAP_SCALE = 0.01;
export const MAX_MAP_SCALE = 8;

export function clampScale(scale) {
  if (!Number.isFinite(scale) || scale <= 0) return 1;
  return scale < MIN_MAP_SCALE ? MIN_MAP_SCALE : scale > MAX_MAP_SCALE ? MAX_MAP_SCALE : scale;
}

export function createView(scale, ox = 0, oy = 0) {
  return { scale: clampScale(scale), ox, oy };
}

export function toScreen(view, wx, wy) {
  return { x: wx * view.scale + view.ox, y: wy * view.scale + view.oy };
}

export function toWorld(view, x, y) {
  return { x: (x - view.ox) / view.scale, y: (y - view.oy) / view.scale };
}

/** 面板可见范围对应的世界矩形（面板像素 → 世界）。 */
export function panelWorldRect(view, width, height) {
  return {
    x: -view.ox / view.scale,
    y: -view.oy / view.scale,
    width: width / view.scale,
    height: height / view.scale,
  };
}

/** 世界矩形 → 面板像素矩形。 */
export function boxToPanel(view, box) {
  return {
    x: box.x * view.scale + view.ox,
    y: box.y * view.scale + view.oy,
    width: box.width * view.scale,
    height: box.height * view.scale,
  };
}

/** 把世界点 (wx,wy) 放到面板像素 (px,py) 上，返回新的 ox/oy。 */
export function offsetForPoint(view, wx, wy, px, py) {
  return { ox: px - wx * view.scale, oy: py - wy * view.scale };
}

/** 以面板像素 (px,py) 为锚点缩放 factor 倍（滚轮缩放地图）。 */
export function zoomAround(view, px, py, factor) {
  const scale = clampScale(view.scale * factor);
  if (Math.abs(scale - view.scale) < 1e-9) return { ...view };
  const world = toWorld(view, px, py);
  return { scale, ox: px - world.x * scale, oy: py - world.y * scale };
}

/** 让世界矩形正好装进 width×height（留 padding），返回 scale。 */
export function fitScale(bounds, width, height, padding = 6) {
  const bw = Math.max(Number(bounds && bounds.width) || 0, 1e-6);
  const bh = Math.max(Number(bounds && bounds.height) || 0, 1e-6);
  const availW = Math.max(width - padding * 2, 1);
  const availH = Math.max(height - padding * 2, 1);
  return clampScale(Math.min(availW / bw, availH / bh));
}

/** 让世界矩形居中显示在面板里，返回新的 {scale, ox, oy}。 */
export function viewForBounds(bounds, width, height, padding = 6) {
  const scale = fitScale(bounds, width, height, padding);
  const cx = (bounds.x || 0) + (bounds.width || 0) / 2;
  const cy = (bounds.y || 0) + (bounds.height || 0) / 2;
  return { scale, ox: width / 2 - cx * scale, oy: height / 2 - cy * scale };
}

/** 让某个世界点落在面板正中间（保持 scale）。 */
export function centerOnPoint(view, wx, wy, width, height) {
  return { scale: view.scale, ox: width / 2 - wx * view.scale, oy: height / 2 - wy * view.scale };
}

/** 把世界矩形按比例外扩（用于多渲染一圈，拖动时不至于立刻露白）。 */
export function expandRect(rect, factorX, factorY) {
  const dw = Math.abs(rect.width) * factorX;
  const dh = Math.abs(rect.height) * factorY;
  return { x: rect.x - dw, y: rect.y - dh, width: rect.width + dw * 2, height: rect.height + dh * 2 };
}

export function rectContains(outer, inner, tolerance = 0.5) {
  return (
    inner.x >= outer.x - tolerance &&
    inner.y >= outer.y - tolerance &&
    inner.x + inner.width <= outer.x + outer.width + tolerance &&
    inner.y + inner.height <= outer.y + outer.height + tolerance
  );
}

export function intersects(a, b) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}
