/**
 * 小地图绘制。纯函数，不依赖 DOM / Obsidian，方便单测与无头浏览器验证。
 *
 * 性能要点：
 *   - 图元按"颜色 + 线宽"分桶，一个桶只做一次 beginPath/fill/stroke，
 *     4600 个元素从 4600 次绘制调用降到几十次；
 *   - 场景层和覆盖层分开画：平移主画布时只重画覆盖层（几条矩形），
 *     场景层用缓存的位图直接合成。
 */

import { clamp } from "./geometry.js";

/**
 * 让世界坐标包围盒完整落进 width×height 的等比缩放参数。
 * @returns {{scale:number, tx:number, ty:number}}
 */
export function computeFit(bounds, width, height, padding = 6) {
  const bw = Math.max(Number(bounds && bounds.width) || 0, 1e-6);
  const bh = Math.max(Number(bounds && bounds.height) || 0, 1e-6);
  const availW = Math.max(width - padding * 2, 1);
  const availH = Math.max(height - padding * 2, 1);
  const scale = Math.min(availW / bw, availH / bh);
  const drawW = bw * scale;
  const drawH = bh * scale;
  return {
    scale,
    tx: (width - drawW) / 2 - ((bounds && bounds.x) || 0) * scale,
    ty: (height - drawH) / 2 - ((bounds && bounds.y) || 0) * scale,
  };
}

/**
 * 只画场景（不含视口框/遮罩）。用于离屏缓存的"场景层"。
 * @param {CanvasRenderingContext2D} ctx
 * @param {{items:Array}} model
 * @param {{width:number,height:number,dpr?:number,fit?:object,padding?:number,
 *          selectionIds?:Set,accent?:string,clear?:boolean,clip?:boolean}} opts
 */
const FONT_STACK = '"Segoe UI", "Microsoft YaHei", "PingFang SC", system-ui, sans-serif';

export function drawScene(ctx, model, opts) {
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
  const rects = new Map();
  const shapes = new Map();
  const dashes = new Map();
  const strokes = new Map();
  const polys = new Map();
  const dots = new Map();
  const texts = [];
  const tinyTexts = new Map();
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
      // 真实线宽随比例缩放，细到看不见时保底 0.55px
      const lw = Math.max(0.55, (item.strokeWidth || 2) * s);
      push(polys, `${item.color}|${Math.round(lw * 10) / 10}`, pts);
      if (selected) selectedPolys.push(item);
      drawn += 1;
      continue;
    }

    if (item.kind === "text") {
      const fs = (item.fontSize || 20) * s;
      if (fs < 12) {
        // 太小的字浏览器只会糊成一团，位置/大小都会失真 → 改成"每行一条细线"，
        // 位置和行距仍然是真的，看起来就是缩略图里的文字行。
        push(tinyTexts, item.color, [item.x * s + tx, item.y * s + ty, Math.max(item.w * s, 1), fs, (item.lineHeight || 1.25), item.text]);
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

  // 填充
  for (const [color, list] of rects) {
    ctx.fillStyle = color;
    ctx.beginPath();
    for (let i = 0; i < list.length; i += 1) {
      const r = list[i];
      ctx.rect(r[0], r[1], r[2], r[3]);
    }
    ctx.fill();
  }

  // 菱形 / 椭圆（填充 + 描边各一次）
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

  // Frame 虚线
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

  // 框线
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

  // 折线（手绘 / 线 / 箭头）
  //
  // 缩略图上单条笔画往往只有几个像素，逐点画纯属浪费：
  //   1) 屏幕空间抽稀：两个点相距不到 0.55px 就不落笔；
  //   2) 整条笔画不到 1.5px 的，合并成"点"（一个 path 一次 fill）。
  // 4000 多条手写的场景里，这一步能把绘制量降到原来的 1/5 ~ 1/10。
  const MIN_STEP = 0.55;
  const tinyStrokes = new Map();
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

  // 极小元素的点
  for (const [color, list] of dots) {
    ctx.fillStyle = color;
    ctx.beginPath();
    for (let i = 0; i < list.length; i += 1) {
      const d = list[i];
      ctx.rect(d[0] - 0.25, d[1] - 0.25, 1.75, 1.75);
    }
    ctx.fill();
  }

  // 太小的文字 → 逐行"手写波浪线"（比直线更像字，代价仍然很低）
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

  // 正常大小的文字：画真字形
  if (texts.length) {
    // 和 Excalidraw 一致：每行在行框里垂直居中（middle 基线）
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
      // 夹到元素自己的框里：替代字体的宽度和 Excalidraw 手写体不同，不裁就会"越画越大"
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

  // 选中高亮
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
/** 覆盖层：视口外压暗、视口边框、空画布提示。每帧都画，代价约 1 ms。 */
export function drawOverlay(ctx, model, opts) {
  const width = Math.max(1, Math.round(opts.width));
  const height = Math.max(1, Math.round(opts.height));
  const dpr = opts.dpr || 1;
  const fit = opts.fit || computeFit(model.bounds, width, height, opts.padding == null ? 6 : opts.padding);
  const s = fit.scale;
  const tx = fit.tx;
  const ty = fit.ty;
  const vp = model.viewport;
  const items = model.items || [];

  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.beginPath();
  ctx.rect(0, 0, width, height);
  ctx.clip();

  if (opts.showViewport !== false && vp) {
    const vx = vp.x * s + tx;
    const vy = vp.y * s + ty;
    const vw = Math.max(vp.width * s, 1);
    const vh = Math.max(vp.height * s, 1);

    if (opts.dimColor) {
      ctx.fillStyle = opts.dimColor;
      const top = clamp(vy, 0, height);
      const bottom = clamp(vy + vh, 0, height);
      const left = clamp(vx, 0, width);
      const right = clamp(vx + vw, 0, width);
      const midH = Math.max(bottom - top, 0);
      if (top > 0) ctx.fillRect(0, 0, width, top);
      if (bottom < height) ctx.fillRect(0, bottom, width, height - bottom);
      if (left > 0 && midH > 0) ctx.fillRect(0, top, left, midH);
      if (right < width && midH > 0) ctx.fillRect(right, top, width - right, midH);
    }

    ctx.strokeStyle = opts.accent || "rgba(75,140,255,0.9)";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(vx + 0.75, vy + 0.75, Math.max(vw - 1.5, 1), Math.max(vh - 1.5, 1));
  }

  if (!items.length && opts.emptyText) {
    ctx.fillStyle = opts.emptyTextColor || "rgba(128,132,140,0.9)";
    ctx.font = `12px ${opts.fontFamily || "sans-serif"}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(opts.emptyText, width / 2, height / 2);
  }

  ctx.restore();
}

/** 单画布版本：场景 + 覆盖层一次画完（测试与静态预览用）。 */
export function drawMinimap(ctx, model, opts) {
  const width = Math.max(1, Math.round(opts.width));
  const height = Math.max(1, Math.round(opts.height));
  const dpr = opts.dpr || 1;
  const fit = opts.fit || computeFit(model.bounds, width, height, opts.padding == null ? 6 : opts.padding);

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  if (opts.background) {
    ctx.fillStyle = opts.background;
    ctx.fillRect(0, 0, width, height);
  }

  const scene = drawScene(ctx, model, { ...opts, fit, clear: false, clip: false });
  drawOverlay(ctx, model, { ...opts, fit });
  return { ...fit, width, height, drawn: scene.drawn, groups: scene.groups };
}
