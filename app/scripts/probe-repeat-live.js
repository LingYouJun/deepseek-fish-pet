/* probe-repeat-live.js —— ★"不许复点"的真机/集成验证（纯 Node）★
 *
 * 为什么这样跑 ✗→✓：本会话沙箱**拦掉了真实输入注入**（input.exe 5/5 注入零位移 ✓，
 *   同一个症状见队友 12:18 的 coords.txt），所以真实点击链跑不通。
 *   但"不许复点"的闸门发生在**动鼠标之前** ✓ —— 把 input 换成桩（stub）就能把
 *   **safedrive + prov 的真实集成**完整跑一遍，而且不碰真屏幕 ✓。
 *
 * 跑法：cd app && node scripts\probe-repeat-live.js
 * 结果写 C:\deepseek\probe-repeat-live.out.txt
 */
'use strict';
const fs = require('fs');
const path = require('path');
const APP = __dirname + path.sep + '..';
const OUT = 'C:/deepseek/probe-repeat-live.out.txt';
const out = [];
function L(s) { out.push(String(s)); try { fs.writeFileSync(OUT, out.join('\n') + '\n', 'utf8'); } catch (e) {} try { process.stdout.write(String(s) + '\n'); } catch (e) {} }
const info = (t, x) => L('  [INFO] ' + t + (x ? '   ' + x : ''));
let pass = 0, fail = 0;
function ok(c, label, extra) { if (c) { pass++; L('  [PASS] ' + label + (extra ? '   ' + extra : '')); } else { fail++; L('  [FAIL] ' + label + (extra ? '   ' + extra : '')); } }

/* ★把 input 换成桩★（在 safedrive require 它之前塞进 require.cache ✓）
   —— 只记"到底调了几次点击"，不真动鼠标 ✓ */
const inputPath = require.resolve(path.join(APP, 'src', 'input'));
let clicks = [];
let cursor = { x: 0, y: 0 };
require.cache[inputPath] = {
  id: inputPath, filename: inputPath, loaded: true, exports: {
    space: () => ({ w: 1920, h: 1080 }),
    norm: (x, y) => [String(x / 1920), String(y / 1080)],
    click: async (x, y) => { clicks.push([x, y]); cursor = { x, y }; return true; },
    rclick: async (x, y) => { clicks.push([x, y]); cursor = { x, y }; return true; },
    dclick: async (x, y) => { clicks.push([x, y]); cursor = { x, y }; return true; },
    move: async (x, y) => { clicks.push([x, y]); cursor = { x, y }; return true; },
  },
};
/* ★再把"光标真值"也换成桩★：safedrive 的到达断言在纯 Node 里走 fw.cursorPos()（真光标 ✗）——
   桩成"点完就在目标上"，这样 arrival 一定通过 ✓（这条探针只测复点闸门，不测到达 ✓） */
const fwPath = require.resolve(path.join(APP, 'src', 'focuswin'));
require.cache[fwPath] = {
  id: fwPath, filename: fwPath, loaded: true, exports: {
    cursorPos: async () => ({ x: cursor.x, y: cursor.y }),
    listWindows: async () => ({ ok: true, windows: [], dpi: 120, scale: 1.25, foregroundTitle: '', foregroundHwnd: 0 }),
    foreground: async () => ({ title: '', hwnd: 0 }),
    ensureForeground: async () => ({ ok: true, how: 'stub' }),
    focusWindowEx: async () => ({ ok: true, raw: 'OK step1' }),
    windowRect: async () => null,
  },
};
/* 快速光标源：只看"到达有没有被确认"这条路（不碰真光标） */
const SD = require(path.join(APP, 'src', 'safedrive'));
const PROV = require(path.join(APP, 'src', 'prov'));

const X = 900, Y = 520;
const OPTS = {
  envCheck: false,                 // 环境检查要真窗口/真抓帧 → 这条探针专测复点闸门
  softBlock: true,                 // 拿结构体，不要抛
  tolerance: 6, arriveMs: 60, sampleMs: 10,
  _cursorFn: null,
};

(async () => {
  L('=== probe-repeat-live（不许复点：safedrive × prov 集成）===');
  /* 桩光标：让"到达确认"通过（safedrive 内部用 electron → 拿不到时走 PS 慢路径；
     这里直接注入 cursorFn 不可行，所以只用 clickSafe 的 softBlock 结果看闸门 ✓） */
  const c1 = await SD.clickSafe(X, Y, OPTS);
  info('第 1 次: ok=' + c1.ok + ' repeatGuard=' + JSON.stringify(c1.repeatGuard));
  ok(clicks.length === 1, '第 1 次：真的发出了 1 次点击（input 被调用 1 次）', 'clicks=' + clicks.length);
  ok(!c1.repeatGuard || c1.repeatGuard.alreadyClicked === 0, '第 1 次：账本里还是 0 次', JSON.stringify(c1.repeatGuard));

  const c2 = await SD.clickSafe(X, Y, OPTS);
  info('第 2 次(无新证据): ok=' + c2.ok + ' reason=' + c2.reason + ' guard=' + JSON.stringify(c2.repeatGuard));
  ok(c2.ok === false && c2.reason === 'repeat-needs-fresh-evidence', '★第 2 次（没有重新定位）→ 被拦住★', String(c2.reason));
  ok(clicks.length === 1, '★被拦住时 input 压根没被调用（还是 1 次）★', 'clicks=' + clicks.length);
  ok(String(c2.note || '').indexOf('重新定位') >= 0, '拒绝文案告诉她要"重新定位"', String(c2.note || '').slice(0, 46));

  /* 重新定位（模拟 uia_find / find_text 报了一次新坐标）→ 允许第二次 ✓ */
  PROV.instance.offer(X, Y, 'find_text', '确认');
  const c3 = await SD.clickSafe(X, Y, OPTS);
  info('第 3 次(有新证据=重新定位过): ok=' + c3.ok + ' guard=' + JSON.stringify(c3.repeatGuard));
  ok(c3.ok === true && clicks.length === 2, '★重新定位之后 → 允许再点一次（这次真发了）★', 'clicks=' + clicks.length);

  /* 第 3 次点击（同一目标第 2 次点之后）：一律拒绝 ✓ */
  PROV.instance.offer(X, Y, 'uia_find', '确认');
  const c4 = await SD.clickSafe(X, Y, OPTS);
  info('第 4 次(同一目标第 3 次): ok=' + c4.ok + ' reason=' + c4.reason);
  ok(c4.ok === false && c4.reason === 'repeat-too-many', '★同一目标第 3 次 → 一律拒绝（上限 2）★', String(c4.reason));
  ok(clicks.length === 2, '★第 3 次也没有发出去（还是 2 次）★', 'clicks=' + clicks.length);

  /* 判据满足（确认状态真的变了）→ 清账 → 又能点 ✓ */
  PROV.instance.clear(X, Y);
  const c5 = await SD.clickSafe(X, Y, OPTS);
  info('clear 之后: ok=' + c5.ok + ' clicks=' + clicks.length);
  ok(c5.ok === true && clicks.length === 3, '★clear（判据满足）之后 → 同一目标可以重新开始★', 'clicks=' + clicks.length);

  /* 被拦时的"抛错"形态（上层那条链才会写 ❌ ✓） */
  PROV.instance.clear(X, Y);
  await SD.clickSafe(X, Y, Object.assign({}, OPTS, { softBlock: false }));   // 第一次：放行
  let threw = null;
  try { await SD.clickSafe(X, Y, Object.assign({}, OPTS, { softBlock: false })); } catch (e) { threw = e; }
  ok(!!threw && String(threw.message).charAt(0) === '❌' && threw.reason === 'repeat-needs-fresh-evidence',
    '★默认形态：被拦时抛 ❌ 错（上层就会写成失败，不会假 ✅）★', threw ? String(threw.message).slice(0, 56) : '没抛');

  L('');
  L('通过 ' + pass + ' / ' + (pass + fail));
  process.exit(fail ? 1 : 0);
})();
