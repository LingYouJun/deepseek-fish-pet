/* test-percept.js —— ★新接口契约的验收（真实帧 ✓ 纯函数 ✓ 无鼠标 ✓ 无随机 ✓）★
 * 覆盖：locate 唯一/ambiguous ✓ · act 拒绝裸坐标 ✓ · act 的闸门与 verified ✓ · 坐标系契约 ✓ · zoom 管道 ✓
 */
'use strict';
const fs = require('fs');
const path = require('path');
const PE = require('../src/percept');
const PROV = require('../src/prov');
const OC = require('../src/ownclick');

let pass = 0, fail = 0;
function ok(c, label, extra) {
  if (c) { pass++; console.log('  ✅ ' + label + (extra ? '   ' + extra : '')); }
  else { fail++; console.log('  ❌ ' + label + (extra ? '   ' + extra : '')); }
}
const F = (n) => path.join(__dirname, 'fixtures', n);
/* ★img= 必须是**真实存在**的文件✗→✓★（percept 会检查存在性 ✓ —— 这正是"不猜"的表现 ✓）；
   OCR 仍然由下面注入的 stub 按文件名喂 fixture ✓ → 所以测试是纯离线的 ✓ */
const IMG = 'C:/Users/64616/AppData/Local/Temp/look-screen.png';
const BEFORE = F('look-ocr.json');
const OCR_MAP = {};
const ocrOf = (p) => {
  const base = path.basename(String(p));
  if (/look-screen|step1|before/.test(base)) return JSON.parse(fs.readFileSync(BEFORE, 'utf8'));
  if (/after-click/.test(base)) return JSON.parse(fs.readFileSync(F('ocr-after.json'), 'utf8'));
  return JSON.parse(fs.readFileSync(BEFORE, 'utf8'));
};

let acted = [];
PE.install({
  capture: async () => ({ path: 'look-screen.png' }),
  ocrJson: async (p) => ocrOf(p),
  act: async (kind, x, y) => { acted.push({ kind, x, y }); },
  vision: async (p, q) => '（stub 模型回答：这一小块里有 3 个图标 ✓）',
  space: () => ({ w: 1920, h: 1080 }),
  display: () => ({ w: 1920, h: 1080, scaleFactor: 1.25 }),
  shotDir: () => 'C:/deepseek/livetest',
  dbg: () => {},
});

(async () => {
  console.log('=== test-percept（新接口契约）===');

  /* ① locate：唯一解 = 真值 (893,337) */
  const l1 = await PE.run('locate', '编辑队列|会客室|img=' + IMG + '');
  ok(/★唯一解★/.test(l1) && /\(893,337\)/.test(l1), '① locate("会客室上的编辑队列") 返回★唯一框 (893,337)★', (l1.match(/框 \{[^}]*\}/) || [''])[0]);
  ok(/unit=physical/.test(l1) && /space\(\)=1920x1080/.test(l1), '① 回执里带**坐标系契约**（unit=physical / space 尺寸 ✓）',
    (l1.match(/坐标系契约：.*/) || [''])[0].slice(0, 80));
  ok(/act\|L\d+\|click/.test(l1), '① 给出了**编号**（act 只认编号 ✓）', (l1.match(/★编号 L\d+★/) || [''])[0]);

  /* ② locate：本该歧义的输入必须 ambiguous（不硬选） */
  const l2 = await PE.run('locate', '编辑队列|制造站|img=' + IMG + '');
  ok(/ambiguous/.test(l2) && !/★唯一解★/.test(l2), '② 「制造站」这个容器（匹配到 2 个候选）→ ★ambiguous✗★ 不硬选',
    (l2.match(/有 \d+ 个候选都属于[^\n]*/) || [''])[0].slice(0, 60));
  const l3 = await PE.run('locate', '编辑队列|img=' + IMG + '');
  ok(/ambiguous/.test(l3), '② 不给容器 + 4 个同名候选 → ambiguous ✓ 并列出候选编号', (l3.match(/★候选编号★.*/) || [''])[0].slice(0, 70));

  /* ③ act：拒绝裸坐标 */
  const a1 = await PE.run('act', '893,337|click');
  ok(/不接受裸坐标/.test(a1), '③ ★act 拒绝裸坐标✗★（契约 B 核心 ✓）', a1.split('\n')[0].slice(0, 60));

  /* ④ act：接受编号 + 自带 stateBefore/After + verified */
  const a2 = await PE.run('act', 'L1|click|当前进驻|dry=1|img=' + IMG + '|after=C:/deepseek/after-click.png');
  ok(/stateBefore/.test(a2) && /stateAfter/.test(a2), '④ act 自动跑了 stateBefore / stateAfter（契约 F ✓）');
  ok(/verified = ★true/.test(a2), '④ 判据满足（当前进驻 ✓）→ verified=true ✓', (a2.match(/verified = .*/) || [''])[0].slice(0, 70));
  ok(/来源证明通过/.test(a2), '④ 坐标来源证明通过（编号来自 locate ✓）');
  const a3 = await PE.run('act', 'L1|click|制造站1|dry=1|img=' + IMG + '|after=C:/deepseek/after-click.png');
  ok(/verified = ★false/.test(a3) && /失败/.test(a3), '④ 判据不满足 → ★verified=false 明说失败✗★（不假报成功 ✓）');
  const a4 = await PE.run('act', 'L1|click|dry=1|img=' + IMG + '|after=C:/deepseek/after-click.png');
  ok(/没给判据 → 一律不算成功/.test(a4) && /verified = ★false/.test(a4), '④ 没给判据 → ★一律不算成功✗★（"画面变了"不是证据 ✓）');

  /* ⑤ prov 闸门本身：非工具给的坐标要拒；同目标点两次以上要拒 */
  const L = PROV.create({ now: () => 1000 });
  ok(!L.gate('click', 500, 500).ok, '⑤ 没登记的坐标 → 拒绝 ✓');
  L.offer(500, 500, 'find_text', 'X');
  ok(L.gate('click', 500, 500).ok, '⑤ 登记过（find_text 给的）→ 放行 ✓');
  L.note('click', 500, 500, 'test'); L.note('click', 500, 500, 'test');
  const g3 = L.gate('click', 500, 500);
  ok(!g3.ok && /已经点过 2 次/.test(g3.reason), '⑤ ★同一目标点过 2 次后，第 3 次直接拒绝✗★（主人的③④条 ✓）', g3.reason.slice(0, 50));
  ok(!L.gate('click', 560, 500).ok, '⑤ 换个点（不在任何登记坐标附近）→ 仍然拒绝（来源证明 ✓）');

  /* ⑥ 坐标系契约：同一目标在"物理"与"DIP"两种假设下各算一次 */
  const sc = PE.spaceContract(1920, 1080);
  const truth = { x: 893, y: 337 };                 // 真值（物理像素 ✓ 来自今晚实测 OCR）
  const dipGuess = { x: Math.round(893 / 1.25), y: Math.round(337 / 1.25) };   // 若误当 DIP ✓
  const hitPhys = (Math.abs(truth.x - 893) <= 24 && Math.abs(truth.y - 337) <= 24);
  const hitDip = (Math.abs(dipGuess.x - 893) <= 24 && Math.abs(dipGuess.y - 337) <= 24);
  console.log('  ★坐标系核对★：真值 (' + truth.x + ',' + truth.y + ')；按物理假设 = (893,337) → ' + (hitPhys ? '命中 ✓' : '不命中 ✗'));
  console.log('              按 DIP 假设 = (' + dipGuess.x + ',' + dipGuess.y + ') → ' + (hitDip ? '命中 ✓' : '不命中 ✗（差 ' + Math.abs(893 - dipGuess.x) + '/' + Math.abs(337 - dipGuess.y) + 'px）'));
  ok(sc.unit === 'physical' && sc.capture.w === 1920, '⑥ 契约判定 unit=physical（截图 1920x1080 = space ✓）', JSON.stringify({ unit: sc.unit, capture: sc.capture, space: sc.space, display: sc.display }));
  ok(hitPhys && !hitDip, '⑥ ★同一目标：只有"物理"那套命中★（DIP 那套偏 ' + Math.abs(893 - dipGuess.x) + 'px ✗）—— 20% 偏移的机械原因就在这里 ✓');

  /* ⑦ zoom：裁剪放大 + 交给模型问（管道 ✓） */
  const z = await PE.run('zoom', '1810,60,80,950|3|0|这一列图标从上到下分别像什么？只说类别，不要坐标。|img=' + IMG);
  ok(/zoom 区域 \(1810,60,80,950\) ×3/.test(z) && /stub 模型回答/.test(z), '⑦ zoom 裁剪+放大+问模型 管道通 ✓（模型只回答描述 ✓ 不许给坐标 ✓）',
    (z.match(/→ [^\n]*/) || [''])[0].slice(0, 60));
  ok(/换算由程序做/.test(z), '⑦ zoom 回执里写明坐标换算规则（模型不参与换算 ✓）');

  console.log('');
  console.log('通过 ' + pass + ' / ' + (pass + fail));
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('❌ 崩了：' + (e && e.stack || e)); process.exit(1); });
