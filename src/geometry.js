/**
 * 坐标系换算。
 *
 * 依据 Excalidraw 官方源码 packages/common/src/utils.ts：
 *   viewport = (scene + scroll) * zoom + offset
 *   scene    = (viewport - offset) / zoom - scroll
 * 其中 appState.zoom 是 { value } 对象，appState.width / height 是画布 CSS 尺寸。
 */

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 30;

export function clamp(value, lo, hi) {
  return value < lo ? lo : value > hi ? hi : value;
}

/** 从 appState 里安全取出缩放值（兼容 number 与 { value } 两种写法）。 */
export function zoomOf(appState) {
  const raw = appState && appState.zoom;
  const value = typeof raw === "number" ? raw : raw && raw.value;
  return Number.isFinite(value) && value > 0 ? value : 1;
}

/** 画布尺寸；appState 没给时用 DOM 兜底值。 */
export function viewportSizeOf(appState, fallback) {
  const width = Number(appState && appState.width);
  const height = Number(appState && appState.height);
  return {
    width: Number.isFinite(width) && width > 1 ? width : (fallback && fallback.width) || 0,
    height: Number.isFinite(height) && height > 1 ? height : (fallback && fallback.height) || 0,
  };
}

export function sceneToViewport(sceneX, sceneY, appState) {
  const zoom = zoomOf(appState);
  const offsetLeft = 0;
  const offsetTop = 0;
  return {
    x: (sceneX + appState.scrollX) * zoom + offsetLeft,
    y: (sceneY + appState.scrollY) * zoom + offsetTop,
  };
}

export function viewportToScene(viewportX, viewportY, appState) {
  const zoom = zoomOf(appState);
  const offsetLeft = 0;
  const offsetTop = 0;
  return {
    x: (viewportX - offsetLeft) / zoom - appState.scrollX,
    y: (viewportY - offsetTop) / zoom - appState.scrollY,
  };
}

/** 当前可见区域对应的世界坐标矩形。 */
export function visibleSceneRect(appState, fallbackSize) {
  const zoom = zoomOf(appState);
  const offsetLeft = 0;
  const offsetTop = 0;
  const size = viewportSizeOf(appState, fallbackSize);
  return {
    x: -offsetLeft / zoom - appState.scrollX,
    y: -offsetTop / zoom - appState.scrollY,
    width: size.width / zoom,
    height: size.height / zoom,
  };
}

/** 让世界坐标点 (sceneX, sceneY) 落在画布正中央，缩放不变。 */
export function scrollToCenter(sceneX, sceneY, appState, fallbackSize) {
  const zoom = zoomOf(appState);
  const size = viewportSizeOf(appState, fallbackSize);
  return {
    scrollX: size.width / (2 * zoom) - sceneX,
    scrollY: size.height / (2 * zoom) - sceneY,
  };
}

/**
 * 把世界坐标点 (sceneX, sceneY) 钉在视口位置 (viewportX, viewportY) 上，
 * 同时把缩放换成 nextZoom。用于小地图里的滚轮缩放。
 */
export function scrollToPinScenePoint(sceneX, sceneY, viewportX, viewportY, nextZoom, appState) {
  const offsetLeft = 0;
  const offsetTop = 0;
  const zoom = clamp(nextZoom, MIN_ZOOM, MAX_ZOOM);
  return {
    zoom,
    scrollX: (viewportX - offsetLeft) / zoom - sceneX,
    scrollY: (viewportY - offsetTop) / zoom - sceneY,
  };
}

/** 小地图上的 (px, py) 反推世界坐标；fit 来自 computeFit。 */
export function unmapPoint(fit, px, py) {
  return { x: (px - fit.tx) / fit.scale, y: (py - fit.ty) / fit.scale };
}

/** 世界坐标 → 小地图像素。 */
export function mapPoint(fit, x, y) {
  return { x: x * fit.scale + fit.tx, y: y * fit.scale + fit.ty };
}
