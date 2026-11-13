import test from "node:test";
import assert from "node:assert/strict";

import {
  MAX_ZOOM,
  MIN_ZOOM,
  clamp,
  mapPoint,
  sceneToViewport,
  scrollToCenter,
  scrollToPinScenePoint,
  unmapPoint,
  viewportSizeOf,
  viewportToScene,
  visibleSceneRect,
  zoomOf,
} from "../src/geometry.js";

const st = (over = {}) => ({
  scrollX: -100,
  scrollY: -50,
  zoom: { value: 2 },
  width: 800,
  height: 600,
  offsetLeft: 0,
  offsetTop: 0,
  ...over,
});

test("zoomOf 兼容 number 与 { value }，非法值回落到 1", () => {
  assert.equal(zoomOf(st()), 2);
  assert.equal(zoomOf({ zoom: 0.35 }), 0.35);
  assert.equal(zoomOf({ zoom: { value: 0 } }), 1);
  assert.equal(zoomOf({}), 1);
  assert.equal(zoomOf(null), 1);
});

test("viewportSizeOf 优先用 appState，其次用兜底值", () => {
  assert.deepEqual(viewportSizeOf(st(), null), { width: 800, height: 600 });
  assert.deepEqual(viewportSizeOf({ width: 0 }, { width: 320, height: 200 }), { width: 320, height: 200 });
});

test("scene → viewport → scene 往返一致", () => {
  const s = st();
  const v = sceneToViewport(123, -45, s);
  const back = viewportToScene(v.x, v.y, s);
  assert.ok(Math.abs(back.x - 123) < 1e-9);
  assert.ok(Math.abs(back.y + 45) < 1e-9);
});

test("scrollToCenter 之后该点正好在画布中央", () => {
  const s = st({ scrollX: 0, scrollY: 0 });
  const { scrollX, scrollY } = scrollToCenter(500, 300, s);
  const v = sceneToViewport(500, 300, { ...s, scrollX, scrollY });
  assert.ok(Math.abs(v.x - 400) < 1e-9, `x=${v.x}`);
  assert.ok(Math.abs(v.y - 300) < 1e-9, `y=${v.y}`);
});

test("scrollToPinScenePoint 把世界点钉在指定视口位置", () => {
  const s = st();
  const next = scrollToPinScenePoint(10, 20, 150, 90, 0.75, s);
  assert.equal(next.zoom, 0.75);
  const v = sceneToViewport(10, 20, { ...s, scrollX: next.scrollX, scrollY: next.scrollY, zoom: { value: next.zoom } });
  assert.ok(Math.abs(v.x - 150) < 1e-9);
  assert.ok(Math.abs(v.y - 90) < 1e-9);
});

test("scrollToPinScenePoint 会把缩放夹在合法范围", () => {
  const s = st();
  assert.equal(scrollToPinScenePoint(0, 0, 0, 0, 999, s).zoom, MAX_ZOOM);
  assert.equal(scrollToPinScenePoint(0, 0, 0, 0, 0.0001, s).zoom, MIN_ZOOM);
});

test("visibleSceneRect 与视口尺寸/缩放一致", () => {
  const s = st();
  const rect = visibleSceneRect(s);
  assert.deepEqual(rect, { x: 100, y: 50, width: 400, height: 300 });
  const v = sceneToViewport(rect.x, rect.y, s);
  assert.ok(Math.abs(v.x) < 1e-9 && Math.abs(v.y) < 1e-9);
});

test("mapPoint / unmapPoint 互逆", () => {
  const fit = { scale: 0.5, tx: 20, ty: 12 };
  const p = mapPoint(fit, 300, 400);
  const back = unmapPoint(fit, p.x, p.y);
  assert.ok(Math.abs(back.x - 300) < 1e-9);
  assert.ok(Math.abs(back.y - 400) < 1e-9);
});

test("clamp 边界", () => {
  assert.equal(clamp(5, 0, 1), 1);
  assert.equal(clamp(-5, 0, 1), 0);
  assert.equal(clamp(0.5, 0, 1), 0.5);
});
