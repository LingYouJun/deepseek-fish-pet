/* score.js —— ★离线帧跑分（不抓帧、不注入、不点击 ✓ 只读帧目录 ✓）★
 * 用法：node app\scripts\gametest\score.js --frames=C:\deepseek\gametest\frames [--tolPx=6] [--perClass=999]
 * 做什么：每个 PNG → OCR（PowerShell 管道 ✓）→ locate（text/dup 类）/ icon_scan（icon 类）→ 与 layout.js 真值比对
 * 判定：定位中心落在目标框内（或中心误差 ≤ tolPx）算通过 ✓；否则记 not-found / ambiguous / wrong-target
 * 落盘：C:\deepseek\gametest\score.json + 控制台表格 ✓
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const L = require('./layout');

const APP = path.join(__dirname, '..', '..');
const OUT = 'C:/deepseek/gametest';
const argv = process.argv.slice(2);
const getArg = (k, d) => { const m = argv.find((a) => a.startsWith('--' + k + '=')); return m ? m.split('=')[1] : d; };
const FRAMES = getArg('frames', path.join(OUT, 'frames'));
const TOL = Number(getArg('tolPx', 6));
const PER_CLASS = Number(getArg('perClass', 999));

function sh(c, a) { return spawnSync(c, a, { stdio: 'ignore', windowsHide: true }); }
/* ★OCR 结果优先读"预算好的"JSON✗→✓★：本会话里 Node→PowerShell 的 spawn 不可靠（写不出文件 ✗），
   所以由 PowerShell 侧先批量生成 <ocrDir>/ocr-<帧名>.json ✓，这里只读 ✓（只读文件这条路是通的 ✓）。 */
const OCRDIR = getArg('ocrDir', '');
function ocrOf(png, outJson) {
  const pre = OCRDIR ? path.join(OCRDIR, 'ocr-' + path.basename(png).replace(/\.png$/i, '') + '.json') : null;
  if (pre && fs.existsSync(pre)) { try { return JSON.parse(fs.readFileSync(pre, 'utf8').replace(/^\uFEFF/, '')); } catch (e) { return null; } }
  sh('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
    path.join(__dirname, 'shoot-ocr.ps1'), '-Png', png, '-Out', outJson]);
  if (!fs.existsSync(outJson)) return null;
  try { return JSON.parse(fs.readFileSync(outJson, 'utf8').replace(/^\uFEFF/, '')); } catch (e) { return null; }
}
function inBox(cx, cy, b, tol) {
  return cx >= b.x - tol && cx <= b.x + b.w + tol && cy >= b.y - tol && cy <= b.y + b.h + tol;
}

(async () => {
  const PE = require(path.join(APP, 'src/percept'));
  const OC = require(path.join(APP, 'src/ownclick'));
  const IC = require(path.join(APP, 'src/iconcut'));
  IC.install({ space: () => ({ w: 1920, h: 1080 }), display: () => ({ w: 1920, h: 1080, scaleFactor: 1 }) });
  const files = fs.readdirSync(FRAMES).filter((f) => /\.png$/i.test(f)).sort();
  if (!files.length) { console.log('帧目录里没有 PNG：' + FRAMES); process.exit(1); }

  const rows = [];
  for (const f of files) {
    const png = path.join(FRAMES, f);
    const ocr = ocrOf(png, path.join(OUT, 'ocr-' + f.replace(/\.png$/i, '') + '.json'));
    if (!ocr) { rows.push({ frame: f, err: 'OCR 失败' }); continue; }
    const words = (ocr.lines || []).reduce((n, L2) => n + ((L2.words || []).length), 0);
    PE.install({
      capture: async () => ({ path: png }), ocrJson: async () => ocr,
      act: async () => { throw new Error('离线模式不点击 ✓'); },
      vision: async () => '（离线不调模型）',
      space: () => ({ w: 1920, h: 1080 }), display: () => ({ w: 1920, h: 1080, scaleFactor: 1 }), shotDir: () => OUT,
    });

    /* icon 类：整片区域一次 icon_scan，再按"最近检出项"配对 ✓（纯图形没有文字 ✓ 走几何/图标路线 ✓） */
    let iconItems = [];
    try {
      const r = await IC.scan(png, { mode: 'auto', region: { x0: 40, y0: 600, x1: 1780, y1: 960 }, dir: 'v' });
      if (r.mode === 'blob') {
        const r2 = await IC.scan(png, { mode: 'b', region: { x0: 40, y0: 600, x1: 1780, y1: 960 } });
        iconItems = r2.items || [];
      } else iconItems = r.items || [];
    } catch (e) { iconItems = []; }

    const per = {};
    for (const t of L.buttons) {
      const cls = t.kind === 'edge' || t.kind === 'small' ? 'small+edge' : t.kind;
      per[cls] = per[cls] || { n: 0, hit: 0, notfound: 0, ambiguous: 0, wrong: 0, errs: [] };
      if (per[cls].n >= PER_CLASS) continue;
      per[cls].n++;
      let cx = null, cy = null, verdict = 'notfound';
      if (t.kind === 'icon') {
        const near = iconItems.map((it) => ({ it, d: Math.hypot(it.cx - (t.x + Math.round(t.w / 2)), it.cy - (t.y + Math.round(t.h / 2))) }))
          .sort((a, b) => a.d - b.d)[0];
        if (near && near.d <= Math.max(TOL, Math.round(t.w / 2) + 4)) { cx = near.it.cx; cy = near.it.cy; verdict = 'ok'; }
        else if (near) { cx = near.it.cx; cy = near.it.cy; verdict = 'wrong'; }
      } else {
        const loc = await PE.run('locate', (t.label || '') + '||img=' + png + '|region=' + [t.x, t.y, t.w, t.h].join(','));
        /* ★从 locate 的回执里取中心✗→✓★：它的格式是 ★编号 L1★（中心 893,337）✓
           （第一版我按 act 的「目标「…」中心」去解析 ✗ → 全部 notfound ✗ —— 这是**跑分器自己的 bug** ✗，
            不是 locate 的 ✓；icon 类没走这条解析 ✓ 所以它 93.3% ✓ 正好形成对照 ✓） */
        const m = /（中心 (-?\d+),(-?\d+)）/.exec(loc);
        if (/ambiguous/.test(loc) && !m) verdict = 'ambiguous';
        else if (m) { cx = Number(m[1]); cy = Number(m[2]); verdict = inBox(cx, cy, t, TOL) ? 'ok' : 'wrong'; }
        else verdict = 'notfound';
      }
      if (verdict === 'ok') per[cls].hit++;
      else per[cls][verdict]++;
      if (cx != null && verdict === 'ok') per[cls].errs.push(Math.hypot(cx - (t.x + t.w / 2), cy - (t.y + t.h / 2)));
      rows.push({ frame: f, words, id: t.id, kind: t.kind, cls, label: t.label, verdict, cx, cy, truth: { x: t.x + Math.round(t.w / 2), y: t.y + Math.round(t.h / 2) } });
    }
    console.log('  帧 ' + f + '：OCR 词数 ' + words + '，逐格判定完成（' + L.buttons.length + ' 个目标）');
  }

  /* 汇总 */
  const byCls = {};
  for (const r of rows) {
    if (!r.cls) continue;
    byCls[r.cls] = byCls[r.cls] || { n: 0, hit: 0, notfound: 0, ambiguous: 0, wrong: 0, errs: [] };
    const c = byCls[r.cls];
    c.n++;
    if (r.verdict === 'ok') { c.hit++; if (r.cx != null) c.errs.push(Math.hypot(r.cx - r.truth.x, r.cy - r.truth.y)); }
    else if (r.verdict === 'ambiguous') c.ambiguous++; else if (r.verdict === 'wrong') c.wrong++; else c.notfound++;
  }
  const allErrs = [];
  for (const k of Object.keys(byCls)) allErrs.push.apply(allErrs, byCls[k].errs);
  const stat = (a) => {
    if (!a.length) return { n: 0, mean: 0, p95: 0, max: 0 };
    const s = a.slice().sort((x, y) => x - y);
    return { n: s.length, mean: s.reduce((p, c) => p + c, 0) / s.length, p95: s[Math.min(s.length - 1, Math.floor(s.length * 0.95))], max: s[s.length - 1] };
  };
  const total = { n: 0, hit: 0 };
  console.log('');
  console.log('=== 离线帧跑分（真值 = layout.js ✓ 容差 ' + TOL + 'px）===');
  for (const k of ['text', 'dup', 'icon', 'small+edge']) {
    const c = byCls[k] || { n: 0, hit: 0, notfound: 0, ambiguous: 0, wrong: 0, errs: [] };
    total.n += c.n; total.hit += c.hit;
    const e = stat(c.errs);
    console.log('  ' + k.padEnd(11) + c.hit + '/' + c.n + ' = ' + (c.n ? (c.hit / c.n * 100).toFixed(1) : '0.0') + '%'
      + '　notfound=' + c.notfound + ' ambiguous=' + c.ambiguous + ' wrong=' + c.wrong
      + (e.n ? ('　中心误差 平均 ' + e.mean.toFixed(1) + ' / p95 ' + e.p95.toFixed(1) + ' / 最大 ' + e.max.toFixed(1) + 'px') : ''));
  }
  const ea = stat(allErrs);
  console.log('  ★总通过 ' + total.hit + '/' + total.n + ' = ' + (total.n ? (total.hit / total.n * 100).toFixed(1) : '0.0') + '%★'
    + '　歧义率 ' + (total.n ? ((byCls.text ? byCls.text.ambiguous : 0) + (byCls.dup ? byCls.dup.ambiguous : 0)) / total.n * 100 : 0).toFixed(1) + '%');
  if (ea.n) console.log('  全部命中帧的中心误差：平均 ' + ea.mean.toFixed(1) + 'px / p95 ' + ea.p95.toFixed(1) + 'px / 最大 ' + ea.max.toFixed(1) + 'px（独立真值=layout.js ✓）');
  fs.writeFileSync(path.join(OUT, 'score.json'), JSON.stringify({ at: new Date().toISOString(), frames: files, tol: TOL, total, byCls, errs: ea, rows }, null, 2));
  console.log('  明细已落盘：' + path.join(OUT, 'score.json'));
})().catch((e) => { console.log('❌ 跑分崩了：' + (e && e.stack || e)); process.exit(1); });
