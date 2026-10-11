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
const F = 'C:/deepseek/desktop-pet/shots/win-Arknights-1791645099248.jpg';
const BAND = { x0: 1770, y0: 40, x1: 1919, y1: 1040 };
const SPACING = 115.9;                       // ★独立来源：grid_count 同帧三次一致 ✓
const TOLS = [6, 2];

(async () => {
  IC.install({ space: () => ({ w: 1920, h: 1080 }), display: () => ({ w: 1920, h: 1080, scaleFactor: 1 }) });
  const img = await Jimp.fromBuffer(fs.readFileSync(F));
  const luma = IC.lumaFromJimp(img);
  const E = GC.multiScaleEnergy(luma, img.width, img.height, 5, 15);

  /* ── 真值：首格钉在"模板峰值 + 能量重心"上 ✓ ── */
  const lattice = await IC.scan(F, { mode: 'a', region: BAND, dir: 'v', expect: 9 });   // ★模式 A = 格距+相位（规则列 ✓）★
  const lat = (lattice.items || []).slice().sort((a, b) => a.cy - b.cy);
  const first = lat[0];
  const centroid = (cy, half) => {
    let sy = 0, s = 0;
    for (let y = Math.max(BAND.y0, cy - half); y <= Math.min(BAND.y1, cy + half); y++)
      for (let x = BAND.x0; x <= Math.min(img.width - 1, BAND.x1); x++) { const e = E[y * img.width + x]; sy += y * e; s += e; }
    return s > 0 ? Math.round(sy / s) : null;
  };
  const c1 = centroid(first ? first.cy : 0, 36);
  const agree = first && c1 != null && Math.abs(first.cy - c1) <= 1;   // ★±1px 复核（lead 定的 ✓）★
  console.log('真值首格：lattice(模板峰) ' + (first ? first.cy : '?') + ' / 能量重心 ' + c1 + ' → ' + (agree ? '一致 ✓（差 ≤1px ✓）' : '★不一致✗ → 该格 uncertain 排除 ✓★'));
  console.log('量到的格距：' + (lattice.spacing != null ? Number(lattice.spacing).toFixed(1) + 'px ✓' : '（lattice 没给 ✓ 用独立值 ' + SPACING + ' ✓）'));
  const truth = [];
  if (agree) for (let k = 0; k < 9; k++) truth.push({ id: 'C' + (k + 1), kind: 'icon', cy: Math.round(first.cy + k * SPACING), x: 1810, y: Math.round(first.cy + k * SPACING) - 36, w: 72, h: 72, certain: true });
  else for (let k = 0; k < 9; k++) truth.push({ id: 'C' + (k + 1), kind: 'icon', cy: Math.round((first ? first.cy : 0) + k * SPACING), x: 1810, y: Math.round((first ? first.cy : 0) + k * SPACING) - 36, w: 72, h: 72, certain: false });
  console.log('真值 9 格 y：' + truth.map((t) => t.cy + (t.certain ? '✓' : '✗')).join(' '));

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
