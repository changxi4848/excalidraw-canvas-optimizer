import test from "node:test";
import assert from "node:assert/strict";

import {
  MAX_MAP_SCALE,
  MIN_MAP_SCALE,
  centerOnPoint,
  clampScale,
  createView,
  expandRect,
  fitScale,
  offsetForPoint,
  panelWorldRect,
  rectContains,
  toScreen,
  toWorld,
  viewForBounds,
  zoomAround,
  boxToPanel,
} from "../src/mapview.js";

test("clampScale 夹在合法范围，非法值回落 1", () => {
  assert.equal(clampScale(0.5), 0.5);
  assert.equal(clampScale(1e-9), MIN_MAP_SCALE);
  assert.equal(clampScale(99), MAX_MAP_SCALE);
  assert.equal(clampScale(0), 1);
  assert.equal(clampScale(NaN), 1);
});

test("createView 保留偏移并夹住比例", () => {
  const v = createView(0.5, 12, -8);
  assert.deepEqual(v, { scale: 0.5, ox: 12, oy: -8 });
  assert.ok(createView(1000).scale <= MAX_MAP_SCALE);
});

test("屏幕坐标 ↔ 世界坐标互逆", () => {
  const v = createView(0.37, 41, -17);
  const s = toScreen(v, 1234, -567);
  const w = toWorld(v, s.x, s.y);
  assert.ok(Math.abs(w.x - 1234) < 1e-9);
  assert.ok(Math.abs(w.y + 567) < 1e-9);
});

test("面板可见范围 = 面板像素换算（scale=0.5 时是 2 倍）", () => {
  const v = createView(0.5, 0, 0);
  const rect = panelWorldRect(v, 300, 200);
  assert.equal(Math.abs(rect.x), 0);
  assert.equal(Math.abs(rect.y), 0);
  assert.deepEqual([rect.width, rect.height], [600, 400]);
});

test("boxToPanel 把世界矩形换算成面板像素", () => {
  const v = createView(0.5, 10, 20);
  assert.deepEqual(boxToPanel(v, { x: 100, y: 100, width: 40, height: 20 }), {
    x: 60,
    y: 70,
    width: 20,
    height: 10,
  });
});

test("滚轮缩放时鼠标下的世界点保持不动", () => {
  const v = createView(0.5, 10, 20);
  const before = toWorld(v, 120, 80);
  const next = zoomAround(v, 120, 80, 1.8);
  const after = toWorld(next, 120, 80);
  assert.ok(Math.abs(next.scale - 0.9) < 1e-9);
  assert.ok(Math.abs(before.x - after.x) < 1e-6, `${before.x} vs ${after.x}`);
  assert.ok(Math.abs(before.y - after.y) < 1e-6);
});

test("offsetForPoint 把世界点摆到指定面板像素", () => {
  const v = createView(0.25);
  const o = offsetForPoint(v, 400, 200, 100, 50);
  assert.deepEqual(o, { ox: 100 - 100, oy: 50 - 50 });
});

test("centerOnPoint 后该点落在面板正中", () => {
  const v = centerOnPoint(createView(0.5), 1000, 500, 300, 200);
  const s = toScreen(v, 1000, 500);
  assert.ok(Math.abs(s.x - 150) < 1e-9);
  assert.ok(Math.abs(s.y - 100) < 1e-9);
});

test("viewForBounds：整张图装进面板且居中", () => {
  const bounds = { x: 100, y: 50, width: 400, height: 200 };
  const v = viewForBounds(bounds, 260, 168, 6);
  const center = toScreen(v, 300, 150);
  assert.ok(Math.abs(center.x - 130) < 1e-9);
  assert.ok(Math.abs(center.y - 84) < 1e-9);
  // 四条边都在面板内
  const tl = toScreen(v, 100, 50);
  const br = toScreen(v, 500, 250);
  assert.ok(tl.x >= 5.9 && tl.y >= 5.9);
  assert.ok(br.x <= 254.1 && br.y <= 162.1);
});

test("fitScale 在 292×210 里算出的比例能整除短边", () => {
  const s = fitScale({ x: 0, y: 0, width: 1000, height: 1000 }, 292, 210, 6);
  assert.ok(Math.abs(s - 198 / 1000) < 1e-9);
  assert.ok(s > 0.1);
});

test("expandRect / rectContains", () => {
  const r = expandRect({ x: 0, y: 0, width: 100, height: 50 }, 0.5, 0.5);
  assert.deepEqual(r, { x: -50, y: -25, width: 200, height: 100 });
  assert.equal(rectContains(r, { x: 0, y: 0, width: 100, height: 50 }), true);
  assert.equal(rectContains(r, { x: 0, y: 0, width: 300, height: 50 }), false);
});
