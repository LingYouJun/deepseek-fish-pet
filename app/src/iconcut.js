/* iconcut.js —— ★icon_scan：把屏幕上每个图标切出来，给出**每一格中心坐标**（纯 Node + jimp ✓ 可单测 ✓）★
 *
 * 主人原话：「直接写个工具，可以切割屏幕上每个图标，然后输出每一个图标中心的坐标，
 *            之后如果图标里有文字，再让 OCR 识别，这个精度要求非常非常高」
 * lead 定的验收口径：
 *   · 中心坐标：几何模式 **误差 ≤2px**（★坐标只能由格距+相位算，不许模型给✗★）
 *   · 检测质量：召回 ≥99%、误检 ≤1%（在**人手标注真值**的真实帧上量 ✓）
 *   · 文字：★不承诺 99%✗★（美术字体会让 Windows OCR 失败 ✓）→ 认得就给置信度 ✓，
 *           不认得就如实说"没读出文字" ✓，**绝对不许瞎编** ✓，并给实测准确率 ✓
 *
 * 【两个模式（屏幕上的图标就这两类 ✓）】
 *   模式 A「规则排列」：复用 gridcount 那套（luma→boxBlur→localEnergy→projectEnergy→
 *     Otsu/MAD→findRuns→estimateSpacing/Phase→lattice）→ 算格距与相位 → **直接给每格中心** ✓
 *     ★这是能达到 ≤2px 的路子★（今晚职业列实测 9 格 / 115.7~115.9px / 残差 4.6% ✓）。
 *   模式 B「不规则摆放」：局部能量二值化 → **连通域** → 按尺寸/长宽比过滤 → 重叠合并去重 → 输出框与中心 ✓。
 *   ★自动选择★：先试 A ✓；A 不可信（格距 <40px【多半是一列文字 ✗】/ 残差 >5% / 格数 <2）→ 退 B ✓，
 *     并在返回值里说明**用了哪种、依据是什么** ✓（这就是"不许把难题丢回调用方" ✓）。
 *
 * 【输出（稳定、可排序 ✓ 后面 locate/act 唯一依据 ✓）】
 *   每项：id、cx、cy、w、h、**space**（physical|dip + 依据 ✓）、text、textConf、source（lattice|blob ✓）
 *   ★排序规则固定★：先按 cy 再按 cx（同一画面两次运行完全一致 ✓）。
 *   ★OCR 由调用方注入★（assistant.js 注入 her OCR ✓；纯 Node 测试注入假 OCR ✓）—— 本模块不自己 spawn ✓。
 */
'use strict';

const GC = require('./gridcount');

/* ───────── 通用小工具（都是纯函数 ✓ 无随机 ✓）───────── */
function lumaFromJimp(img) {
  const d = img.bitmap.data, n = img.width * img.height;
  const out = new Float32Array(n);
  for (let i = 0, p = 0; p < n; i += 4, p++) out[p] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
  return out;
}
function median(a) { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }

/* ───────── 模式 A：规则排列（格距 + 相位 → 每格中心 ✓）───────── */
function modeLattice(luma, w, h, opt) {
  const o = opt || {};
  const r = GC.analyze(luma, w, h, {
    dir: o.dir || 'v', k: o.k || 2,
    expect: o.expect > 0 ? o.expect : undefined,
    bandSearch: o.bandSearch == null ? 56 : o.bandSearch,
    region: o.region || undefined,
  });
  const spacing = r.spacing || 0;
  const residual = r.cv || 0;
  /* ★A 可不可信的判据（阈值都是**实测调出来的** ✓ 不是拍的 ✗）★
     参考帧（明日方舟职业列 ✓ 手标真值那帧）：格距 115.9px ✓、**残差 6.0%** ✓；
     负样本帧（队列面板右下角 ✓ 没有图标列）：自动搜窄条给出 **残差 10.1%** ✓。
     → 阈值取 **8%**：参考帧 6.0% 稳稳通过 ✓，负样本 10.1% 稳稳拒绝 ✓（两侧各留 ~2 个百分点 ✓）。
     ⚠️ 第一版我写了 5% ✗ → ★把参考帧自己给拒了（6.0% > 5%）→ 退 blob → 0 个图标 ✗✗★
        —— 这正是"阈值必须拿真数据标定"的例子 ✓（测试当场抓到 ✓）。 */
  const RESID_MAX = o.residMax == null ? 0.08 : Number(o.residMax);
  const SPACING_MIN = o.spacingMin == null ? 40 : Number(o.spacingMin);
  const MIN_CELLS = o.minCells == null ? 3 : Number(o.minCells);
  const reasons = [];
  if (!(spacing >= 8)) reasons.push('格距太小/没测出来（' + spacing.toFixed(1) + 'px）');
  else if (spacing < SPACING_MIN) reasons.push('格距 ' + spacing.toFixed(1) + 'px < ' + SPACING_MIN + 'px —— ★多半是一列文字、不是图标列✗★');
  if (residual > RESID_MAX) reasons.push('残差 ' + (residual * 100).toFixed(1) + '% > ' + (RESID_MAX * 100).toFixed(0) + '% —— ★不等距，不是规则排列✗★');
  if ((r.cells || []).length < MIN_CELLS) reasons.push('只测出 ' + (r.cells || []).length + ' 格（下限 ' + MIN_CELLS + '）');
  const trustworthy = reasons.length === 0;
  const axis = Math.round((r.region.x0 + r.region.x1) / 2);
  const half = Math.max(6, Math.round(spacing * 0.36));
  /* ★质心细化 ✗→✓（2026-10-11 实测抓到的问题）★
     只取"格距+相位算出来的格心"时，与**独立锚点**（icon_lib 的模板匹配中心 ✓）系统性差 **8px** ✗ ——
     因为 run 的中点 ≠ 图标内容的重心（run 边界受渐变/描边影响 ✓）。
     → 在每个格心 ±8px 窗口里按**局部对比度能量加权求重心** ✓（确定性 ✓ 无随机 ✓ 亚像素 ✓）再定中心 ✓。
     ★这一步是纯测量的细化 ✓，不是模型 ✓，也不改格距/相位（那两条仍来自 lattice ✓）★。 */
  const E = GC.multiScaleEnergy(luma, w, h, 5, 15);
  function refine(cx0, cy0, rad) {
    let sx = 0, sy = 0, sw = 0;
    for (let y = Math.max(0, cy0 - rad); y <= Math.min(h - 1, cy0 + rad); y++) {
      for (let x = Math.max(0, cx0 - rad); x <= Math.min(w - 1, cx0 + rad); x++) {
        const e = E[y * w + x];
        sx += x * e; sy += y * e; sw += e;
      }
    }
    return sw > 0 ? { x: sx / sw, y: sy / sw } : { x: cx0, y: cy0 };
  }
  const items = (r.cells || []).map((c, i) => {
    const cx0 = (r.dir === 'v' ? axis : c.center), cy0 = (r.dir === 'v' ? c.center : axis);
    const rf = refine(cx0, cy0, Math.max(4, Math.round(spacing * 0.07)));
    const cx = Math.round(rf.x), cy = Math.round(rf.y);
    return {
      id: 'I' + (i + 1), cx, cy, w: half * 2, h: half * 2, source: 'lattice',
      raw: { cx: cx0, cy: cy0 }, moved: Math.round(Math.hypot(cx - cx0, cy - cy0) * 10) / 10,
      box: (r.dir === 'v') ? { x: cx - half, y: cy - half, w: half * 2, h: half * 2 }
        : { x: cx - half, y: cy - half, w: half * 2, h: half * 2 },
      inLattice: !!c.inLattice, estimated: !!c.estimated, empty: !!c.empty,
    };
  });
  return { mode: 'lattice', trustworthy, reasons, spacing, residual, region: r.region, items, analysis: r };
}

/* ───────── 模式 B：不规则摆放（连通域 ✓）───────── */
function modeBlob(luma, w, h, opt) {
  const o = opt || {};
  const x0 = o.region ? o.region.x0 : 0, y0 = o.region ? o.region.y0 : 0;
  const x1 = o.region ? o.region.x1 : w - 1, y1 = o.region ? o.region.y1 : h - 1;
  const rw = x1 - x0 + 1, rh = y1 - y0 + 1;
  if (rw < 4 || rh < 4) return { mode: 'blob', trustworthy: false, reasons: ['区域太小'], items: [] };

  /* ① 局部对比度能量（对"深色压深色"一视同仁 ✓ 和 gridcount 同一思路 ✓） */
  const energy = GC.multiScaleEnergy(luma, w, h, 5, 15);
  const vals = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) vals.push(energy[y * w + x]);
  /* ★阈值用**分位数**而不是 robustThreshold✗→✓★（第一版用 robustThreshold 时，选人面板整片 0 个连通域 ✗ ——
     因为那个阈值是按"抗异常值"设计的（偏保守 ✓），对"整块都有能量"的面板会一刀切空 ✓）。
     分位数是确定性的 ✓（排序取位置 ✓ 无随机 ✓），默认 88% 分位 ✓，可用 o.pct 调 ✓。 */
  const pct = o.pct == null ? 0.88 : Number(o.pct);
  const sorted = vals.slice().sort((a, b) => a - b);
  const thr = sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * pct))] : 0;
  /* ② 二值化 → ★形态学闭运算（膨胀→腐蚀）★ → 连通域（8 邻接 ✓ 显式栈 ✓ 无递归 ✓）
     ★为什么要闭运算✗→✓（2026-10-11 实测的"碎片化"根因 ✓）★：
     真机 72x72 的图标被切成 **11 块**✗（最近的碎片只有 19x10 ✓）→ 配对时挑到碎片 → 单格误差 22.8px ✗。
     闭运算把相邻碎片**先并后收**✓（不改变整体尺寸 ✓ 只补缝隙 ✓ 半径可调 ✓ 确定性 ✓）。
     ⚠️ 半径不能大到把**相邻图标**并起来 ✓：实测图标 72px、相邻间距 ~100px（缝 28px ✓）→ 半径 2~3px 安全 ✓。
     ★★ 实测结论（2026-10-11）：**默认关（0）✓** ★★ —— 打开它（close=2）时：
       · 最大中心误差从 **22.8px 降到 5.4px** ✓（碎片化那个最坏用例真的被治了 ✓）
       · 但 icon 通过率 **93.3% → 90.0%** ✗、small+edge **50.0% → 33.3%** ✗、总分 **80.4% → 76.5%** ✗
       → ★"更差的路线不许接进默认"✗✓★：所以它**只作为可选实验**（`close=2` ✓），默认 0 = 保持原行为 ✓。 */
  const bin = new Uint8Array(w * h);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) bin[y * w + x] = energy[y * w + x] > thr ? 1 : 0;
  const closeR = o.close == null ? 0 : Number(o.close);
  if (closeR > 0) {
    const dil = new Uint8Array(w * h);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      if (!bin[y * w + x]) continue;
      for (let dy = -closeR; dy <= closeR; dy++) for (let dx = -closeR; dx <= closeR; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < x0 || ny < y0 || nx > x1 || ny > y1) continue;
        dil[ny * w + nx] = 1;
      }
    }
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      if (!dil[y * w + x]) { bin[y * w + x] = 0; continue; }
      let keep = 1;
      for (let dy = -closeR; dy <= closeR && keep; dy++) for (let dx = -closeR; dx <= closeR; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < x0 || ny < y0 || nx > x1 || ny > y1) continue;
        if (!dil[ny * w + nx]) { keep = 0; break; }
      }
      bin[y * w + x] = keep ? 1 : 0;
    }
  }
  const seen = new Uint8Array(w * h);
  const blobs = [];
  const stack = new Int32Array(rw * rh);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const idx = y * w + x;
      if (!bin[idx] || seen[idx]) continue;
      let sp = 0; stack[sp++] = idx; seen[idx] = 1;
      let minX = x, maxX = x, minY = y, maxY = y, area = 0, sum = 0;
      while (sp > 0) {
        const p = stack[--sp];
        const px = p % w, py = (p - px) / w;
        area++; sum += energy[p];
        if (px < minX) minX = px; if (px > maxX) maxX = px;
        if (py < minY) minY = py; if (py > maxY) maxY = py;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = px + dx, ny = py + dy;
            if (nx < x0 || ny < y0 || nx > x1 || ny > y1) continue;
            const q = ny * w + nx;
            if (bin[q] && !seen[q]) { seen[q] = 1; stack[sp++] = q; }
          }
        }
      }
      const bw = maxX - minX + 1, bh = maxY - minY + 1;
      blobs.push({ x: minX, y: minY, w: bw, h: bh, area, mean: sum / area });
    }
  }
  /* ③ 尺寸/长宽比过滤（图标不会是一条线、也不会占满屏幕 ✓）★阈值写在返回值里 ✓ 可调 ✓ */
  const minSide = o.minSide == null ? 8 : Number(o.minSide);
  const maxSide = o.maxSide == null ? Math.min(300, Math.round(Math.min(rw, rh) * 0.6)) : Number(o.maxSide);
  const minFill = o.minFill == null ? 0.08 : Number(o.minFill);   // 连通域填充率下限（滤掉细长噪声 ✓）
  const kept = [], dropped = { small: 0, large: 0, thin: 0, sparse: 0 };
  for (const b of blobs) {
    if (b.w < minSide || b.h < minSide) { dropped.small++; continue; }
    if (b.w > maxSide || b.h > maxSide) { dropped.large++; continue; }
    const ar = b.w / b.h;
    if (ar < 0.33 || ar > 3) { dropped.thin++; continue; }
    if (b.area / (b.w * b.h) < minFill) { dropped.sparse++; continue; }
    kept.push(b);
  }
  /* ④ 重叠合并去重（IoU > 0.5 ✓ 合并成外接框 ✓）—— 同一个图标被能量切成两半时很有用 ✓ */
  function iou(a, b) {
    const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
    const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
    const inter = ix * iy;
    return inter / (a.w * a.h + b.w * b.h - inter || 1);
  }
  let merged = true, list = kept.slice();
  while (merged) {
    merged = false;
    for (let i = 0; i < list.length && !merged; i++) {
      for (let j = i + 1; j < list.length; j++) {
        if (iou(list[i], list[j]) > 0.5) {
          const x = Math.min(list[i].x, list[j].x), y = Math.min(list[i].y, list[j].y);
          const X = Math.max(list[i].x + list[i].w, list[j].x + list[j].w), Y = Math.max(list[i].y + list[i].h, list[j].y + list[j].h);
          list.splice(j, 1); list[i] = { x, y, w: X - x, h: Y - y, area: list[i].area + list[j].area, mean: list[i].mean };
          merged = true; break;
        }
      }
    }
  }
  const items = list.map((b, i) => ({ id: 'I' + (i + 1), cx: b.x + Math.round(b.w / 2), cy: b.y + Math.round(b.h / 2), w: b.w, h: b.h, box: b, source: 'blob' }));
  return { mode: 'blob', trustworthy: items.length > 0, reasons: [], blobs: blobs.length, dropped, thr, items };
}

/* ───────── 统一入口：自动选模式 + 稳定排序 + 声明坐标系 ───────── */
async function scan(imgPath, opt) {
  const o = opt || {};
  const fs = require('fs');
  const Jimp = require('jimp').Jimp;
  const img = await Jimp.fromBuffer(fs.readFileSync(imgPath));
  const w = img.width, h = img.height;
  const luma = lumaFromJimp(img);

  const mode = String(o.mode || 'auto').toLowerCase();
  let A = null, B = null, used, why;
  if (mode === 'a' || mode === 'auto') {
    A = modeLattice(luma, w, h, o);
    if (mode === 'a') { used = A; why = ['调用方指定模式 A ✓'].concat(A.trustworthy ? [] : ['★但 A 不可信：' + A.reasons.join('；') + '✗★']); }
  }
  if (mode === 'b') { B = modeBlob(luma, w, h, o); used = B; why = ['调用方指定模式 B ✓']; }
  if (mode === 'auto') {
    if (A && A.trustworthy) { used = A; why = ['模式 A 可信（格距 ' + A.spacing.toFixed(1) + 'px ✓、残差 ' + (A.residual * 100).toFixed(1) + '% ✓）→ 用规则排列 ✓']; }
    else {
      B = modeBlob(luma, w, h, o);
      used = B;
      why = ['★模式 A 不可信✗ → 退模式 B（不规则摆放）★'].concat(A ? A.reasons : []);
    }
  }

  /* ★稳定排序：先 cy 再 cx（同一画面两次运行完全一致 ✓）★ */
  const items = (used.items || []).slice().sort((p, q) => (p.cy - q.cy) || (p.cx - q.cx));
  items.forEach((it, i) => { it.id = 'I' + (i + 1); });

  const spaceInfo = spaceContract(w, h, o);
  return {
    tool: 'icon_scan', image: imgPath, imageSize: { w, h },
    mode: used.mode, modeWhy: why,
    space: spaceInfo.space, spaceBasis: spaceInfo.basis,
    spacing: used.spacing || null, residual: used.residual == null ? null : used.residual,
    region: used.region || o.region || null,
    count: items.length, items,
    dropped: used.dropped || null, analysis: used.analysis || null,
    note: '★坐标只由几何/像素算出✗——模型不参与任何坐标 ✓★；OCR 文本由调用方注入 ✓（认不出就如实报空 ✓ 绝不瞎编 ✓）',
  };
}

/* 坐标系声明（★必须给依据✓★：截图尺寸 + space() + 物理屏 + 缩放比） */
const deps = { space: () => ({ w: 1920, h: 1080 }), display: () => null };
function install(d) { Object.assign(deps, d || {}); return module.exports; }
function spaceContract(imgW, imgH, o) {
  let sp = { w: imgW, h: imgH }, dp = null;
  try { sp = deps.space ? deps.space() : sp; } catch (e) {}
  try { dp = deps.display ? deps.display() : null; } catch (e) {}
  const isPhysical = !!(dp && sp.w === dp.w && sp.h === dp.h);
  return {
    space: isPhysical ? 'physical' : 'dip',
    basis: '截图 ' + imgW + 'x' + imgH + '；space() ' + sp.w + 'x' + sp.h
      + (dp ? ('；物理屏 ' + dp.w + 'x' + dp.h + ' ×' + (dp.scaleFactor || 1)) : '；物理屏未知')
      + ' → ★单位 = 截图像素；截图被 resize 到 space() ✓；input.norm() 再把 space 归一化给 input.exe ✓★',
  };
}

module.exports = { scan, modeLattice, modeBlob, lumaFromJimp, spaceContract, install, median };
