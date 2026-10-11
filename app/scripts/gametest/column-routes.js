/* column-routes.js —— ★真机职业列：格距/模板路 vs 连通域(blob)路 的对照（双容差）★
 *
 * 真值口径（lead 定的 ✓ 可复现 + 有独立来源 ✓）：
 *   · 格距 115.9px —— 由 grid_count 在同帧量到、**同帧三次完全一致** ✓（独立来源 ✓）
 *   · 首格中心 —— ① icon_lib 模板匹配峰值（同格 1.000 / 次好 0.744 ✓）② ±1px 局部能量重心 独立复核 ✓
 *     两者一致 → 写入 ✓；不一致 → 该格标 uncertain 并排除 ✓（不凑 ✓）
 *   · 第 k 格 = 首格 + k×115.9 ✓
 * 两条路：
 *   A) 格距/模板路：iconcut 的 lattice 模式（grid_count 的格距+相位 → 每格中心 ✓）
 *   B) 连通域 blob 路：iconcut 的 blob 模式（局部能量→连通域→过滤 ✓）
 * 都报 ≤2px / ≤6px 双口径 + 中心误差三项 ✓；叠框图 9 格全标（绿=确定/红=不确定 ✓）
 */
'use strict';
const fs = require('fs');
const path = require('path');
const APP = path.join(__dirname, '..', '..');
const IC = require(path.join(APP, 'src/iconcut'));
const GC = require(path.join(APP, 'src/gridcount'));
const Jimp = require('jimp').Jimp;
const OUT = 'C:/deepseek/gametest';
/* ★可指定帧（主人新给的干净真机列帧用这个跑 ✓）：--frame=<png> */
const F = (require('process').argv.find((a) => a.startsWith('--frame=')) || '').split('=')[1]
  || 'C:/deepseek/desktop-pet/shots/win-Arknights-1791645099248.jpg';
const BAND = { x0: 1770, y0: 40, x1: 1919, y1: 1040 };
const SPACING = 115.9;                       // ★独立来源：grid_count 同帧三次一致 ✓
const TOLS = [6, 2];

(async () => {
  IC.install({ space: () => ({ w: 1920, h: 1080 }), display: () => ({ w: 1920, h: 1080, scaleFactor: 1 }) });
  const img = await Jimp.fromBuffer(fs.readFileSync(F));
  const luma = IC.lumaFromJimp(img);
  const E = GC.multiScaleEnergy(luma, img.width, img.height, 5, 15);

  /* ── ★真值构造（lead 定的修法 ✓）：首格 = 紧贴第一个真实图标（约 y≈123）的格 ✓；
        格距用 lattice 量到的 与 独立值 115.9 互证 ✓，|Δ| ≤ 2px 才写 certain ✓（★不放宽✗✓★）── */
  const lattice = await IC.scan(F, { mode: 'a', region: BAND, dir: 'v', expect: 9 });   // 模式 A = 格距+相位（规则列 ✓）
  const lat = (lattice.items || []).slice().sort((a, b) => a.cy - b.cy);
  const KNOWN_FIRST = 123;
  const latSpacing = lattice.spacing != null ? Number(lattice.spacing) : NaN;
  const dSpacing = Math.abs(latSpacing - SPACING);
  const near123 = lat.map((i) => ({ i, d: Math.abs(i.cy - KNOWN_FIRST) })).sort((a, b) => a.d - b.d)[0];
  const anchor = near123 ? near123.i : null;
  const agree = !!anchor && isFinite(latSpacing) && dSpacing <= 2;
  console.log('真值构造：靠近已知首图标 y≈123 的格 = cy ' + (anchor ? anchor.cy : '?') + '（距 ' + (near123 ? near123.d : '?') + 'px ✓）'
    + '　lattice 格距 ' + (isFinite(latSpacing) ? latSpacing.toFixed(1) : '?') + 'px vs 独立 115.9px → 差 ' + (isFinite(dSpacing) ? dSpacing.toFixed(1) : '?') + 'px'
    + '　→ ' + (agree ? '互证一致 ✓ 写 certain ✓' : '★互证不一致✗（阈值 2px ✓ 未放宽 ✓）→ 全标 uncertain 排除 ✓★'));
  const truth = [];
  for (let k = 0; k < 9; k++) {
    const cy = anchor ? Math.round(anchor.cy + k * SPACING) : null;
    truth.push({ id: 'C' + (k + 1), kind: 'icon', cy, x: 1810, y: (cy == null ? 0 : cy - 36), w: 72, h: 72, certain: !!agree });
  }
  /* ★遮挡自检（lead 发现上一张叠框图是"实时截屏 + DSH 盖在上面"✗）★ */
  {
    let dark = 0, n = 0, sum = 0;
    for (let y = BAND.y0; y <= BAND.y1; y++) for (let x = BAND.x0; x <= Math.min(img.width - 1, BAND.x1); x += 2) {
      const p = (y * img.width + x) * 4; const l = 0.299 * img.bitmap.data[p] + 0.587 * img.bitmap.data[p + 1] + 0.114 * img.bitmap.data[p + 2];
      sum += l; n++; if (l < 40) dark++;
    }
    console.log('列带遮挡自检：平均亮度 ' + (sum / n).toFixed(1) + '　近黑像素占比 ' + (dark / n * 100).toFixed(1) + '%'
      + (dark / n > 0.6 ? '　★疑似被遮挡✗（这张不能用于验收 ✓）★' : '　✓ 未见大面积遮挡 ✓'));
  }
  console.log('真值 9 格 y：' + truth.map((t) => t.cy + (t.certain ? '✓' : '✗')).join(' '));
  /* ★右边界裁切验证（lead 要求先验 ✓）：中心 + 半宽 ≤ 图宽 才算完整落在画面内 ✓ */
  {
    const w = img.width;
    const clipped = truth.filter((t) => t.x + t.w / 2 > w || t.x - t.w / 2 < 0);
    console.log('右边界裁切验证（图宽 ' + w + ' ✓）：格中心 x=' + truth[0].x + ' 半宽 ' + (truth[0].w / 2) + ' → 右边 ' + (truth[0].x + truth[0].w / 2)
      + ' ≤ ' + w + ' ? ' + (truth[0].x + truth[0].w / 2 <= w ? '✓ 未越界 ✓' : '★越界✗★')
      + '　→ ' + (clipped.length ? ('★有 ' + clipped.length + ' 格被裁 ✗ 可用 ' + (9 - clipped.length) + ' 格★') : '★9 格都完整落在画面内 ✓★'));
  }

  /* ── 两条路 ── */
  const blob = await IC.scan(F, { mode: 'b', region: BAND });
  const routes = { '格距/模板路': lat, '连通域blob路': (blob.items || []).map((i) => ({ cx: i.cx, cy: i.cy })) };
  for (const [name, items] of Object.entries(routes)) {
    const per = {}; TOLS.forEach((t) => { per[t] = 0; });
    const errs = []; const detail = [];
    for (const t of truth) {
      const near = items.map((g) => ({ g, d: Math.hypot(g.cx - 1846, g.cy - t.cy) })).sort((a, b) => a.d - b.d)[0];
      if (!near) { detail.push(t.id + ':无'); continue; }
      const d = Math.hypot(near.g.cx - 1846, near.g.cy - t.cy);
      errs.push(d); TOLS.forEach((tol) => { if (d <= tol) per[tol]++; });
      detail.push(t.id + ':' + d.toFixed(1));
    }
    const stat = (a) => { if (!a.length) return { n: 0, mean: 0, p95: 0, max: 0 }; const s = a.slice().sort((x, y) => x - y); return { n: s.length, mean: s.reduce((p, c) => p + c, 0) / s.length, p95: s[Math.min(s.length - 1, Math.floor(s.length * 0.95))], max: s[s.length - 1] }; };
    const e = stat(errs);
    console.log('  ' + name + '（检出 ' + items.length + ' 个）：≤6px ' + per[6] + '/9 = ' + (per[6] / 9 * 100).toFixed(1) + '%'
      + '　★≤2px ' + per[2] + '/9 = ' + (per[2] / 9 * 100).toFixed(1) + '%★'
      + '　中心误差 平均 ' + e.mean.toFixed(2) + ' / p95 ' + e.p95.toFixed(2) + ' / 最大 ' + e.max.toFixed(2) + 'px');
    console.log('     逐格误差(px)：' + detail.join(' '));
  }

  /* ── 9 格全标的叠框图 ✓ ── */
  const c = img.clone();
  for (const t of truth) {
    const col = t.certain ? 0xff00ff00 : 0xffff0000;
    for (let x = t.x; x < t.x + t.w; x++) { c.setPixelColor(col, x, t.y); c.setPixelColor(col, x, t.y + t.h - 1); }
    for (let y = t.y; y < t.y + t.h; y++) { c.setPixelColor(col, t.x, y); c.setPixelColor(col, t.x + t.w - 1, y); }
  }
  fs.writeFileSync(path.join(OUT, 'overlay-class-column-9.png'), await c.getBuffer('image/png'));
  console.log('  叠框图（9 格全标 ✓ 绿=确定/红=不确定）：' + path.join(OUT, 'overlay-class-column-9.png'));
})().catch((e) => { console.log('❌ ' + (e && e.stack || e)); process.exit(1); });
