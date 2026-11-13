/**
 * 极简 CanvasRenderingContext2D 假实现，只记录调用，用来验证绘制逻辑不炸、画了该画的东西。
 */
export function createMockContext() {
  const calls = [];
  const state = { transform: [1, 0, 0, 1, 0, 0], fillStyle: "#000", strokeStyle: "#000", lineWidth: 1 };
  const record = (name) => (...args) => {
    calls.push({ name, args, fillStyle: state.fillStyle, strokeStyle: state.strokeStyle });
  };

  const ctx = {
    calls,
    get fillStyle() {
      return state.fillStyle;
    },
    set fillStyle(v) {
      state.fillStyle = v;
    },
    get strokeStyle() {
      return state.strokeStyle;
    },
    set strokeStyle(v) {
      state.strokeStyle = v;
    },
    get lineWidth() {
      return state.lineWidth;
    },
    set lineWidth(v) {
      state.lineWidth = v;
    },
    lineJoin: "miter",
    lineCap: "butt",
    font: "10px sans-serif",
    textAlign: "start",
    textBaseline: "alphabetic",
    setTransform: (...args) => {
      state.transform = args;
      calls.push({ name: "setTransform", args });
    },
    clearRect: record("clearRect"),
    fillRect: record("fillRect"),
    strokeRect: record("strokeRect"),
    strokeText: record("strokeText"),
    fillText: record("fillText"),
    beginPath: record("beginPath"),
    closePath: record("closePath"),
    rect: record("rect"),
    clip: record("clip"),
    moveTo: record("moveTo"),
    lineTo: record("lineTo"),
    ellipse: record("ellipse"),
    fill: record("fill"),
    stroke: record("stroke"),
    save: record("save"),
    restore: record("restore"),
    setLineDash: record("setLineDash"),
  };
  return ctx;
}

/** 取出某个方法的所有调用参数 */
export function callsOf(ctx, name) {
  return ctx.calls.filter((c) => c.name === name);
}
