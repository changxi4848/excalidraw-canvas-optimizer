import test from "node:test";
import assert from "node:assert/strict";

import {
  buildItems,
  createItemCache,
  countPoints,
  elementBox,
  expandBounds,
  isLightColor,
  mergeBounds,
  parseColor,
  sceneBounds,
  sceneSignature,
  withAlpha,
} from "../src/scene.js";

const el = (over = {}) => ({
  id: "e1",
  type: "rectangle",
  x: 0,
  y: 0,
  width: 100,
  height: 60,
  strokeColor: "#1e1e1e",
  backgroundColor: "transparent",
  opacity: 100,
  ...over,
});

test("parseColor 支持 hex / rgb / 透明", () => {
  assert.deepEqual(parseColor("#fff"), { r: 255, g: 255, b: 255, a: 1 });
  assert.deepEqual(parseColor("#1e1e1e"), { r: 30, g: 30, b: 30, a: 1 });
  assert.deepEqual(parseColor("rgba(10,20,30,0.5)"), { r: 10, g: 20, b: 30, a: 0.5 });
  assert.equal(parseColor("transparent"), null);
  assert.equal(parseColor("#transparent"), null);
  assert.equal(parseColor(""), null);
  assert.equal(parseColor(undefined), null);
});

test("withAlpha 叠乘透明度并输出 rgba", () => {
  assert.equal(withAlpha("#000000", 0.5), "rgba(0,0,0,0.5)");
  assert.equal(withAlpha("rgba(255,0,0,0.5)", 0.5), "rgba(255,0,0,0.25)");
  assert.equal(withAlpha("transparent", 0.5), null);
});

test("isLightColor 判断深浅", () => {
  assert.equal(isLightColor("#ffffff"), true);
  assert.equal(isLightColor("#121212"), false);
  assert.equal(isLightColor(undefined), true);
});

test("elementBox 处理负宽高", () => {
  assert.deepEqual(elementBox({ x: 10, y: 20, width: -30, height: 40 }), { x: -20, y: 20, width: 30, height: 40 });
});

test("mergeBounds / expandBounds / sceneBounds", () => {
  const a = { x: 0, y: 0, width: 10, height: 10 };
  const b = { x: 20, y: -5, width: 10, height: 10 };
  assert.deepEqual(mergeBounds(a, b), { x: 0, y: -5, width: 30, height: 15 });
  assert.deepEqual(expandBounds(a, 2), { x: -2, y: -2, width: 14, height: 14 });
  assert.deepEqual(
    sceneBounds([el({ x: 0, y: 0, width: 10, height: 10 }), el({ id: "e2", x: 50, y: 50, width: 10, height: 10 })]),
    { x: 0, y: 0, width: 60, height: 60 }
  );
  assert.equal(sceneBounds([]), null);
  assert.equal(sceneBounds([el({ isDeleted: true })]), null);
});

test("buildItems 跳过已删除元素与绑定文字", () => {
  const items = buildItems([
    el({ id: "keep" }),
    el({ id: "gone", isDeleted: true }),
    el({ id: "label", type: "text", containerId: "keep" }),
  ]).items;
  assert.equal(items.length, 1);
  assert.equal(items[0].id, "keep");
});

test("矩形：背景色原样填充，透明则只有描边", () => {
  const [withBg] = buildItems([el({ backgroundColor: "#a5d8ff" })]).items;
  assert.equal(withBg.fill, "rgba(165,216,255,1)");
  assert.equal(withBg.stroke, "rgba(30,30,30,0.9)");

  const [noBg] = buildItems([el({ backgroundColor: "transparent" })]).items;
  assert.equal(noBg.fill, null);
  assert.equal(noBg.stroke, "rgba(30,30,30,0.9)");
});

test("菱形 / 椭圆保留形状标记", () => {
  const items = buildItems([el({ id: "d", type: "diamond" }), el({ id: "o", type: "ellipse" })]).items;
  assert.equal(items[0].shape, "diamond");
  assert.equal(items[1].shape, "ellipse");
});

test("Frame 画成虚线外框而不是色块", () => {
  const [frame] = buildItems([el({ type: "frame", width: 500, height: 300 })]).items;
  assert.equal(frame.dashed, true);
  assert.equal(frame.fill, null);
});

test("手绘线按 maxFreedrawPoints 抽样，且保留首尾点", () => {
  const points = [];
  for (let i = 0; i < 1000; i += 1) points.push([i, Math.sin(i / 20) * 50]);
  const [poly] = buildItems([el({ type: "freedraw", points, width: 1000, height: 100 })]).items;
  assert.equal(poly.kind, "poly");
  assert.ok(poly.pointCount <= 49, `sample=${poly.pointCount}`);
  assert.equal(poly.pts[0], 0);
  assert.equal(poly.pts[poly.pts.length - 2], 999);
});

test("点预算耗尽后手绘退化成色块，不会无限累加", () => {
  const points = [];
  for (let i = 0; i < 500; i += 1) points.push([i, i]);
  const many = [];
  for (let i = 0; i < 50; i += 1) many.push(el({ id: `f${i}`, type: "freedraw", points, x: i * 10, y: 0 }));
  const { items } = buildItems(many, { pointBudget: 300 });
  const polys = items.filter((it) => it.kind === "poly");
  const boxes = items.filter((it) => it.kind === "box");
  assert.ok(polys.length <= 8, `polys=${polys.length}`);
  assert.ok(boxes.length > 0, "应该退化成色块");
  assert.equal(items.length, many.length);
  // 预算花完之后的元素必须是色块
  assert.ok(items[items.length - 1].kind === "box");
});

test("opacity 按 Excalidraw 的 0–100 解释", () => {
  const [half] = buildItems([el({ backgroundColor: "#000000", opacity: 50 })]).items;
  assert.equal(half.fill, "rgba(0,0,0,0.5)");
});

test("outlineOnly 模式只描边不填充", () => {
  const [item] = buildItems([el({ backgroundColor: "#ffec99" })], { outlineOnly: true }).items;
  assert.equal(item.fill, null);
  assert.ok(item.stroke);
});

test("countPoints 统计总点数", () => {
  assert.equal(countPoints([el({ points: [[0, 0], [1, 1]] }), el({ isDeleted: true, points: [[0, 0]] })]), 2);
});

test("sceneSignature 对内容变化敏感、对新数组不敏感", () => {
  const a = [el({ id: "a", versionNonce: 11 }), el({ id: "b", versionNonce: 22 })];
  const sameContent = a.map((x) => ({ ...x }));
  const moved = [{ ...a[0], x: 999 }, a[1]];
  const rescanned = [a[0], { ...a[1], versionNonce: 33 }];
  assert.equal(sceneSignature(a), sceneSignature(sameContent));
  assert.equal(sceneSignature(a), sceneSignature(moved)); // 移动元素时 versionNonce 会变，这里只验证指纹机制本身
  assert.notEqual(sceneSignature(a), sceneSignature(rescanned));
  assert.notEqual(sceneSignature(a), sceneSignature([a[0]]));
});

test("buildItems 缓存：没变的元素复用对象，变了的重算", () => {
  const cache = createItemCache();
  const a = el({ id: "a", versionNonce: 1 });
  const b = el({ id: "b", versionNonce: 2 });
  const first = buildItems([a, b], {}, cache);

  const second = buildItems([a, b], {}, cache);
  assert.equal(second.items[0], first.items[0], "未变元素应复用同一对象");
  assert.equal(second.items[1], first.items[1]);

  const third = buildItems([a, { ...b, versionNonce: 3 }], {}, cache);
  assert.equal(third.items[0], first.items[0], "a 没变，继续复用");
  assert.notEqual(third.items[1], first.items[1], "b 的 nonce 变了，应重算");

  const fourth = buildItems([a, b], { outlineOnly: true }, cache);
  assert.notEqual(fourth.items[0], first.items[0], "选项变了要清缓存");
});
test("文本元素保留真字形信息（文字/字号/对齐）", () => {
  const [text] = buildItems([
    el({ type: "text", text: "第一行\n第二行", fontSize: 28, textAlign: "center", width: 200, height: 70 }),
  ]).items;
  assert.equal(text.kind, "text");
  assert.equal(text.text, "第一行\n第二行");
  assert.equal(text.fontSize, 28);
  assert.equal(text.align, "center");
  assert.ok(text.color.startsWith("rgba("));
});