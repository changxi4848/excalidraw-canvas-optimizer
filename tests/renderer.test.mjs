import test from "node:test";
import assert from "node:assert/strict";

import { computeFit, drawMinimap, drawOverlay, drawScene } from "../src/renderer.js";
import { callsOf, createMockContext } from "./mock-ctx.mjs";

const model = (over = {}) => ({
  items: [],
  bounds: { x: 0, y: 0, width: 100, height: 50 },
  viewport: { x: 0, y: 0, width: 50, height: 25 },
  ...over,
});

const box = (id, x, y, w, h, fill, extra = {}) => ({
  kind: "box",
  id,
  shape: "rect",
  x,
  y,
  w,
  h,
  fill,
  stroke: null,
  dashed: false,
  ...extra,
});

test("computeFit 等比缩放并居中，四周留出 padding", () => {
  const fit = computeFit({ x: 0, y: 0, width: 100, height: 50 }, 260, 160, 6);
  assert.ok(Math.abs(fit.scale - 2.48) < 1e-9);
  assert.ok(Math.abs(fit.tx - 6) < 1e-9);
  assert.ok(Math.abs(fit.ty - 18) < 1e-9);

  const corners = [
    [0, 0, 6, 18],
    [100, 50, 254, 142],
  ];
  for (const [x, y, ex, ey] of corners) {
    assert.ok(Math.abs(x * fit.scale + fit.tx - ex) < 1e-9);
    assert.ok(Math.abs(y * fit.scale + fit.ty - ey) < 1e-9);
  }
});

test("computeFit 处理退化包围盒（零宽/零高/空）", () => {
  const zero = computeFit({ x: 0, y: 0, width: 0, height: 0 }, 100, 100, 4);
  assert.ok(Number.isFinite(zero.scale) && zero.scale > 0);
  const none = computeFit(null, 100, 100, 4);
  assert.ok(Number.isFinite(none.scale));
});

test("drawScene 按颜色分桶：同色矩形只做一次 fill", () => {
  const ctx = createMockContext();
  const items = [
    box("a", 0, 0, 20, 10, "rgba(1,1,1,0.5)"),
    box("b", 30, 0, 20, 10, "rgba(1,1,1,0.5)"),
    box("c", 60, 0, 20, 10, "rgba(2,2,2,0.5)"),
  ];
  const result = drawScene(ctx, model({ items }), { width: 260, height: 160, dpr: 1, padding: 6 });
  assert.equal(result.drawn, 3);
  assert.equal(callsOf(ctx, "fill").length, 2, "两个颜色 → 两次 fill");
  assert.ok(callsOf(ctx, "rect").length >= 3, "三个矩形都进了 path");
});

test("drawScene 折线按颜色+线宽合并成一条 path", () => {
  const ctx = createMockContext();
  const poly = (id, color, width) => ({ kind: "poly", id, pts: [0, 0, 10, 10, 20, 0], color, width, pointCount: 3 });
  drawScene(ctx, model({ items: [poly("p1", "red", 1), poly("p2", "red", 1), poly("p3", "blue", 1.15)] }), {
    width: 200,
    height: 120,
    dpr: 1,
  });
  assert.equal(callsOf(ctx, "stroke").length, 2);
  assert.equal(callsOf(ctx, "moveTo").length, 3);
  assert.equal(callsOf(ctx, "lineTo").length, 6);
});

test("drawScene 极小元素画成点，不消失", () => {
  const ctx = createMockContext();
  drawScene(ctx, model({ items: [box("tiny", 0, 0, 0.1, 0.1, "rgba(0,0,0,0.5)")] }), { width: 200, height: 120, dpr: 1 });
  assert.equal(callsOf(ctx, "fill").length, 1);
  const rects = callsOf(ctx, "rect");
  assert.ok(rects.length >= 1);
});

test("drawScene 选中元素额外描一圈", () => {
  const ctx = createMockContext();
  const items = [box("a", 0, 0, 20, 10, "rgba(1,1,1,0.5)"), box("b", 30, 0, 20, 10, "rgba(1,1,1,0.5)")];
  drawScene(ctx, model({ items }), { width: 200, height: 120, dpr: 1, selectionIds: new Set(["a"]), accent: "rgba(0,0,255,1)" });
  const stroke = callsOf(ctx, "stroke")[0];
  assert.equal(stroke.strokeStyle, "rgba(0,0,255,1)");
});

test("drawScene 支持外部传入的 fit（小地图自身缩放）", () => {
  const ctx = createMockContext();
  const fit = { scale: 4, tx: 10, ty: 20 };
  drawScene(ctx, model({ items: [box("a", 0, 0, 10, 10, "rgba(1,1,1,0.5)")] }), { width: 200, height: 120, dpr: 1, fit });
  const mapped = callsOf(ctx, "rect").map((c) => c.args.join(","));
  assert.ok(mapped.includes("10,20,40,40"), `期望 10,20,40,40，实际 ${mapped.join(" / ")}`);
});

test("drawMinimap 合成：清屏 → 背景 → 场景 → 视口框", () => {
  const ctx = createMockContext();
  const result = drawMinimap(ctx, model(), {
    width: 260,
    height: 160,
    dpr: 2,
    padding: 6,
    background: "#ffffff",
    dimColor: "rgba(0,0,0,0.1)",
    accent: "rgba(0,0,255,0.9)",
  });
  assert.deepEqual(callsOf(ctx, "setTransform")[0].args, [2, 0, 0, 2, 0, 0]);
  assert.equal(callsOf(ctx, "clearRect")[0].args[2], 260);
  assert.equal(callsOf(ctx, "fillRect")[0].fillStyle, "#ffffff");
  assert.ok(Math.abs(result.scale - computeFit(model().bounds, 260, 160, 6).scale) < 1e-9);
  const strokes = callsOf(ctx, "strokeRect");
  assert.equal(strokes.length, 1);
  assert.equal(strokes[0].strokeStyle, "rgba(0,0,255,0.9)");
});

test("drawOverlay 压暗视口以外区域时补四块遮罩", () => {
  const ctx = createMockContext();
  drawOverlay(ctx, model(), { width: 260, height: 160, dpr: 1, padding: 6, dimColor: "rgba(0,0,0,0.1)" });
  assert.equal(callsOf(ctx, "fillRect").length, 4);
});

test("drawOverlay 空场景显示占位文字", () => {
  const ctx = createMockContext();
  drawOverlay(ctx, model(), { width: 200, height: 120, dpr: 1, padding: 4, emptyText: "空白画布" });
  const texts = callsOf(ctx, "fillText");
  assert.equal(texts.length, 1);
  assert.equal(texts[0].args[0], "空白画布");
});

test("drawOverlay 只画覆盖层，不碰场景填充", () => {
  const ctx = createMockContext();
  drawOverlay(ctx, model(), { width: 200, height: 120, dpr: 1, padding: 4 });
  assert.equal(callsOf(ctx, "fill").length, 0);
  assert.equal(callsOf(ctx, "clearRect").length, 0);
});
