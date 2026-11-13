import test from "node:test";
import assert from "node:assert/strict";

import { drawScene } from "../src/renderer.js";
import { callsOf, createMockContext } from "./mock-ctx.mjs";

const textItem = (over = {}) => ({
  kind: "text",
  id: "t1",
  x: 5000,
  y: 3000,
  w: 600,
  h: 40,
  text: "测试文字",
  fontSize: 100,
  align: "left",
  lineHeight: 1.25,
  color: "rgba(0,0,0,0.9)",
  ...over,
});

test("文字按世界坐标映射到画布坐标（不是画在原点）", () => {
  const ctx = createMockContext();
  const fit = { scale: 0.13, tx: 20, ty: 30 };
  drawScene(ctx, { items: [textItem()] }, { width: 800, height: 600, dpr: 1, fit });
  const texts = callsOf(ctx, "fillText");
  assert.equal(texts.length, 1);
  const [content, x, y] = texts[0].args;
  assert.equal(content, "测试文字");
  assert.ok(Math.abs(x - (5000 * 0.13 + 20)) < 0.001, `x=${x}`);
  // middle 基线：y + 行高的一半
  const lh = 100 * 0.13 * 1.25;
  assert.ok(Math.abs(y - (3000 * 0.13 + 30 + lh * 0.5)) < 0.001, `y=${y}`);
});

test("文字裁剪框跟着元素走", () => {
  const ctx = createMockContext();
  const fit = { scale: 0.5, tx: 0, ty: 0 };
  drawScene(ctx, { items: [textItem()] }, { width: 4000, height: 3000, dpr: 1, fit });
  const rects = callsOf(ctx, "rect").map((c) => c.args);
  const clipped = rects.some((r) => Math.abs(r[0] - (5000 * 0.5 - 1)) < 0.001 && Math.abs(r[1] - (3000 * 0.5 - 1)) < 0.001);
  assert.ok(clipped, `裁剪框应在元素处，实际 ${JSON.stringify(rects.slice(0, 4))}`);
});

test("字号不够大时不画字形，只画一条波浪行线", () => {
  const ctx = createMockContext();
  drawScene(ctx, { items: [textItem({ fontSize: 20 })] }, { width: 800, height: 600, dpr: 1, fit: { scale: 0.13, tx: 0, ty: 0 } });
  assert.equal(callsOf(ctx, "fillText").length, 0);
  assert.ok(callsOf(ctx, "stroke").length >= 1, "应当画一条行线");
  const move = callsOf(ctx, "moveTo")[0];
  assert.ok(move && Math.abs(move.args[0] - 5000 * 0.13) < 1.5, `line.x=${move && move.args[0]}`);
});

test("多行文字按行距排布", () => {
  const ctx = createMockContext();
  const fit = { scale: 0.2, tx: 0, ty: 0 };
  drawScene(ctx, { items: [textItem({ fontSize: 120, text: "第一行\n第二行" })] }, { width: 2000, height: 1000, dpr: 1, fit });
  const texts = callsOf(ctx, "fillText");
  assert.equal(texts.length, 2);
  const lh = 120 * 0.2 * 1.25;
  assert.ok(Math.abs(texts[1].args[2] - texts[0].args[2] - lh) < 0.001);
});

test("折线（手写笔画）必须按 scale/位移映射，不能按世界坐标 1:1 画", () => {
  const ctx = createMockContext();
  const fit = { scale: 0.1, tx: 15, ty: -5 };
  const poly = { kind: "poly", id: "p", pts: [5000, 3000, 5200, 3100], color: "red", strokeWidth: 2, pointCount: 2, bx: 5000, by: 3000, bw: 200, bh: 100 };
  drawScene(ctx, { items: [poly] }, { width: 800, height: 600, dpr: 1, fit });
  const move = callsOf(ctx, "moveTo")[0].args;
  const line = callsOf(ctx, "lineTo")[0].args;
  assert.ok(Math.abs(move[0] - (5000 * 0.1 + 15)) < 0.001, `moveTo.x=${move[0]}`);
  assert.ok(Math.abs(move[1] - (3000 * 0.1 - 5)) < 0.001, `moveTo.y=${move[1]}`);
  assert.ok(Math.abs(line[0] - (5200 * 0.1 + 15)) < 0.001, `lineTo.x=${line[0]}`);
});