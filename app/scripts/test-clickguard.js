/* test-clickguard.js —— ★"不许复点"闸门的单元测试（纯逻辑，不碰屏幕）★
 * 跑法：node app/scripts/test-clickguard.js
 *
 * 它冻住的是主人症状③的正解（2026-10-11）：
 *   · 她的 click 一次只发一组 down+up（间隔 45ms）；Windows 双击窗口 500ms / 4px；
 *     实测她两次点击隔 3~6 秒 → **不可能被并成双击**；
 *     "点对一次又点掉一次" = 两次**独立单击**打在同一个 toggle 上（第一下开，第二下关）。
 *   · 所以：同一个目标默认 1 次；复点必须有**新证据**（点完之后重新定位过一次）；
 *     最多 2 次，第 3 次一律拒绝；判据满足（clear）才允许重新开始。
 */
'use strict';
const P = require('../src/prov');
const SD = require('../src/safedrive');

let pass = 0, fail = 0;
function ok(c, label, extra) {
  if (c) { pass++; console.log('  ✅ ' + label + (extra ? '   ' + extra : '')); }
  else { fail++; console.log('  ❌ ' + label + (extra ? '   ' + extra : '')); }
}

console.log('=== clickguard（不许复点）单元测试 ===');

/* 可注入时钟 → 确定性覆盖"新证据"的时间语义 */
let T = 1000000;
const led = P.create({ now: () => T });
const X = 900, Y = 500;

/* §1 第一次点：放行（默认不要求来源证明 —— 游戏助手那种只有画面没有控件的场景还得能点 ✓） */
{
  const g1 = led.gate('click', X, Y);
  ok(g1.ok === true && g1.alreadyClicked === 0, '§1 第一次点同一个目标 → 放行', JSON.stringify({ ok: g1.ok, n: g1.alreadyClicked }));
  led.note('click', X, Y, 'clickSafe');
}

/* §2 ★复点没有新证据 → 拒绝★（时间过去了也不行 —— 关键点：判据是**证据**不是**时间**） */
{
  T += 60000;                                     // 整整一分钟后
  const g2 = led.gate('click', X, Y);
  ok(g2.ok === false && g2.code === 'repeat-needs-fresh-evidence',
    '§2 ★只过了时间、没有新定位 → 还是拒绝（复点要证据，不要时间）★', String(g2.code));
  ok(/重新定位/.test(g2.hint || ''), '§2 拒绝时明确告诉她"要重新定位"', (g2.hint || '').slice(0, 40));
}

/* §3 复点带**新证据**（点完之后重新定位过一次）→ 允许第二次 */
{
  T += 1000;
  led.offer(X, Y, 'find_text', '编辑队列');        // ← 重新定位（新鲜帧）
  const g3 = led.gate('click', X, Y);
  ok(g3.ok === true && g3.alreadyClicked === 1 && g3.freshEvidence === true,
    '§3 ★点完之后重新定位过 → 允许再点一次★', JSON.stringify({ n: g3.alreadyClicked, fresh: g3.freshEvidence }));
  led.note('click', X, Y, 'clickSafe');
}

/* §4 ★第 3 次一律拒绝★（就算又有新证据也不行） */
{
  T += 1000;
  led.offer(X, Y, 'uia_find', '确认');
  const g4 = led.gate('click', X, Y);
  ok(g4.ok === false && g4.code === 'repeat-too-many', '§4 ★同一个目标第 3 次 → 一律拒绝（上限 2）★', String(g4.code));
  ok(/别再点了/.test(g4.hint || ''), '§4 拒绝文案里有"别再点了"', (g4.hint || '').slice(0, 30));
}

/* §5 判据满足（确认状态真的变了）→ 清账 → 同一目标可以重新开始 ✓ */
{
  led.clear(X, Y);
  const g5 = led.gate('click', X, Y);
  ok(g5.ok === true && g5.alreadyClicked === 0, '§5 ★clear（判据满足）之后 → 又能点了★', JSON.stringify({ n: g5.alreadyClicked }));
}

/* §6 别的目标互不影响（邻近半径 24px 之外） */
{
  const g6 = led.gate('click', X + 60, Y);
  ok(g6.ok === true, '§6 隔 60px 的另一个目标 → 不受影响', 'ok=' + g6.ok);
}

/* §7 严格模式（requireOffer）：坐标必须来自确定性工具 —— 裸坐标直接拒绝 */
{
  const led2 = P.create({ now: () => T });
  const g7 = led2.gate('click', 10, 10, { requireOffer: true });
  ok(g7.ok === false && g7.code === 'no-provenance', '§7 严格模式：裸坐标（没人报过）→ 拒绝', String(g7.code));
  led2.offer(10, 10, 'find_owned', '编辑队列');
  const g8 = led2.gate('click', 10, 10, { requireOffer: true });
  ok(g8.ok === true, '§7 严格模式：确定性工具报过之后 → 放行', 'ok=' + g8.ok);
}

/* §8 失败原因的细分数值里要有这两条（回执靠它说人话） */
{
  const t1 = SD.reasonText('repeat-needs-fresh-evidence');
  const t2 = SD.reasonText('repeat-too-many');
  ok(!!t1 && t1.indexOf('其它原因') < 0, '§8 reasonText 有"复点要新证据"的中文', t1);
  ok(!!t2 && t2.indexOf('其它原因') < 0, '§8 reasonText 有"点过 2 次不许再点"的中文', t2);
}

/* §9 共用账本：percept 那条线（locate/act）和裸 click 看的是**同一本账** */
{
  const sharedA = require('../src/prov').instance;
  const sharedB = require('../src/prov').instance;
  ok(sharedA === sharedB, '§9 ★全进程只有一本账（prov.instance 单例）★ —— 不做两套互相打架的闸门');
}

console.log('');
console.log('通过 ' + pass + ' / ' + (pass + fail));
process.exit(fail ? 1 : 0);
