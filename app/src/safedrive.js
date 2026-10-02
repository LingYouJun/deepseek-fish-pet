/* safedrive.js —— 安全驱动层：把"动作"包上【前提断言 + 效果断言】
 *
 * ============================ 为什么需要 ============================
 * 2026-10-02 实测：这个系统里所有"动作类"工具都【报成功但不校验】——
 *   · focus_window 报 OK 而前台一个字没变（已由 focuswin v2 修好）
 *   · key|ctrl+f 报 true，实际发给了别的窗口
 *   · type|数据目录 报 true，实际打进了别的窗口的输入框
 *   · click 报"已点击"，实际可能落在别的窗口/空地方
 * 后果：模型（和她）做错了却无从知道，于是"换坐标再试一次"无限循环。
 *
 * 这一层的职责：**在动作前后把"事实"钉死**，任何一条不成立就【不动作】并显式报错。
 *
 * ============================ 三条断言 ============================
 *   ① 前台断言：动作之前，目标窗口必须真的在前台（回读 GetForegroundWindow，不信任何返回值）
 *   ② 位置断言：点击坐标必须落在目标窗口矩形内（防"点到别的窗口上"）
 *   ③ 效果断言：动作之后可选地做【局部 ROI 帧比对】，确认界面真的变了
 *
 * ============================ 为什么不用模型做验证 ============================
 * 视觉模型今天谎报过两次（"两个槽位都已进驻" ← 实际都是空的）。像素比对是确定性的。
 */
'use strict';

const fw = require('./focuswin');

/* ---------------- 断言：前台 ---------------- */
async function assertForeground(expectTitle) {
  const fg = await fw.foreground();
  const a = String(expectTitle || '').replace(/[\u200b-\u200f\ufeff]/g, '').trim();
  const b = String(fg.title || '').replace(/[\u200b-\u200f\ufeff]/g, '').trim();
  const ok = !!a && !!b && (b.indexOf(a) >= 0 || a.indexOf(b) >= 0 || b.slice(0, 10) === a.slice(0, 10));
  return { ok, expected: expectTitle, actual: fg.title, hwnd: fg.hwnd };
}

/* ---------------- 断言：坐标在窗口内 ---------------- */
function pointInRect(x, y, rect, margin) {
  if (!rect) return { ok: false, reason: 'no-rect' };
  const m = margin == null ? 2 : margin;
  const ok = x >= rect.x + m && x <= rect.x + rect.w - m && y >= rect.y + m && y <= rect.y + rect.h - m;
  return { ok, rect, point: { x, y } };
}

/* ---------------- 组合：确保前台（必要时自己置前并校验）---------------- */
async function ensureForeground(title, opts) {
  const o = opts || {};
  const first = await assertForeground(title);
  if (first.ok) return { ok: true, how: 'already', foreground: first.actual };
  if (o.noFocus) return { ok: false, reason: 'foreground-mismatch', expected: title, actual: first.actual };
  const r = await fw.focusWindowEx(title);
  if (!r.ok) return { ok: false, reason: 'focus-failed', raw: r.raw, foreground: r.foreground || first.actual };
  const again = await assertForeground(title);
  return again.ok
    ? { ok: true, how: 'focused(' + (r.step || '') + ')', foreground: again.actual }
    : { ok: false, reason: 'focus-claimed-ok-but-foreground-mismatch', expected: title, actual: again.actual };
}

/* ---------------- 输入闸门：键盘类动作执行前的把关 ----------------
 * 输入只会进【前台窗口】。所以：
 *   · 她之前 focus_window 成功过（lastFocus 有值）→ 断言前台仍然是它，不是就【拒绝输入】并报明实情
 *   · 她从没 focus 过（lastFocus 为 null）→ 不拦，但**必须把"这次会发给谁"告诉她**
 *     （总比一个光秃秃的 true 强：2026-10-02 实测 key|ctrl+f 报 true 而实际发给了别的窗口）
 * 返回 {ok, message?, warn?, foreground}
 */
async function assertForegroundOrReport(expectTitle) {
  const fg = await fw.foreground();
  const actual = (fg && fg.title) || '(未知)';
  if (!expectTitle) {
    return {
      ok: true, foreground: actual,
      warn: '⚠️ 你这次**没有先 focus_window** —— 键盘输入只会发给【前台窗口】，'
        + '而当前前台是「' + actual + '」。如果那不是你要操作的程序，先 ACTION: focus_window|<它的标题片段>。',
    };
  }
  const chk = await assertForeground(expectTitle);
  if (chk.ok) return { ok: true, foreground: actual };
  return {
    ok: false, foreground: actual, expected: expectTitle,
    message: '❌ **拒绝输入**：键盘输入只会发给前台窗口，而现在的前台是「' + actual + '」，'
      + '不是你要操作的「' + expectTitle + '」。字/按键会打进那个程序里，所以我不做。\n'
      + '请先：ACTION: focus_window|' + expectTitle
      + '（如果它报 FAIL，说明我抢不过当前前台的权限 —— 那就请主人把它点到前面，再继续。）',
  };
}

/* ---------------- 带断言的动作 ---------------- */
/* input 是懒加载的：这样纯逻辑测试（不碰键鼠）也能 require 本模块 */
function getInput() { return require('./input'); }

async function clickSafe(x, y, opts) {
  const o = opts || {};
  const out = { action: 'click', point: { x, y } };
  /* ① 前台 */
  if (o.expectForeground) {
    const f = await ensureForeground(o.expectForeground, o);
    out.foreground = f;
    if (!f.ok) return Object.assign(out, { ok: false, blocked: true, reason: f.reason });
  }
  /* ② 位置 */
  if (o.windowRect) {
    const p = pointInRect(x, y, o.windowRect, o.margin);
    out.inWindow = p;
    if (!p.ok) return Object.assign(out, { ok: false, blocked: true, reason: 'point-outside-target-window' });
  }
  /* ③ 动作 */
  out.result = await getInput().click(x, y);
  out.ok = true;
  return out;
}

async function moveSafe(x, y, opts) {
  const o = opts || {};
  const out = { action: 'move', point: { x, y } };
  if (o.expectForeground) {
    const f = await ensureForeground(o.expectForeground, o);
    out.foreground = f;
    if (!f.ok) return Object.assign(out, { ok: false, blocked: true, reason: f.reason });
  }
  if (o.windowRect) {
    const p = pointInRect(x, y, o.windowRect, o.margin);
    out.inWindow = p;
    if (!p.ok) return Object.assign(out, { ok: false, blocked: true, reason: 'point-outside-target-window' });
  }
  out.result = await getInput().move(x, y);
  out.ok = true;
  return out;
}

/* 键盘类动作：【必须】有前台断言 —— 没有它就会打到别的窗口上（今天的两次事故）。
 * 如果不传 expectForeground，就退而求其次：把"当前前台是谁"记下来并返回，
 * 让调用方知道它到底发给了谁（总比一个光秃秃的 true 强）。 */
async function keySafe(name, opts) {
  const o = opts || {};
  const out = { action: 'key', key: name };
  const before = await fw.foreground();
  out.foregroundBefore = before.title;
  if (o.expectForeground) {
    const f = await ensureForeground(o.expectForeground, o);
    out.foreground = f;
    if (!f.ok) return Object.assign(out, { ok: false, blocked: true, reason: f.reason });
  } else if (o.warnNoTarget) {
    out.warning = '没指定 expectForeground —— 这个按键会发给『' + before.title + '』，请确认那是你要的窗口';
  }
  out.result = await getInput().key(name);
  out.ok = true;
  return out;
}

async function typeSafe(text, opts) {
  const o = opts || {};
  const out = { action: 'type', text: String(text).slice(0, 40) };
  const before = await fw.foreground();
  out.foregroundBefore = before.title;
  if (o.expectForeground) {
    const f = await ensureForeground(o.expectForeground, o);
    out.foreground = f;
    if (!f.ok) return Object.assign(out, { ok: false, blocked: true, reason: f.reason });
  } else if (o.warnNoTarget) {
    out.warning = '没指定 expectForeground —— 这些字会打进『' + before.title + '』，请确认那是你要的窗口';
  }
  out.result = await getInput().type(text);
  out.ok = true;
  return out;
}

/* ---------------- 效果断言：局部 ROI 帧比对 ---------------- */
/* 全屏比对噪声大（调研明确点出），所以支持只比一个区域。
 * beforeFrame / afterFrame 是 { dataUrl } 或 nativeImage；这里只做"裁区域→比对"，
 * 取图和 nativeImage 的活交给调用方（保持本模块可纯 Node 测）。 */
function diffRegion(FD, beforeBmp, afterBmp, w, h, rect, opts) {
  if (!rect) return FD.diffBgra(beforeBmp, afterBmp, w, h, opts);
  const x0 = Math.max(0, Math.min(w - 1, rect.x));
  const y0 = Math.max(0, Math.min(h - 1, rect.y));
  const x1 = Math.max(x0 + 1, Math.min(w, rect.x + rect.w));
  const y1 = Math.max(y0 + 1, Math.min(h, rect.y + rect.h));
  const rw = x1 - x0, rh = y1 - y0;
  const a = Buffer.alloc(rw * rh * 4), b = Buffer.alloc(rw * rh * 4);
  for (let y = 0; y < rh; y++) {
    const src = ((y0 + y) * w + x0) * 4;
    const dst = (y * rw) * 4;
    beforeBmp.copy(a, dst, src, src + rw * 4);
    afterBmp.copy(b, dst, src, src + rw * 4);
  }
  const r = FD.diffBgra(a, b, rw, rh, opts);
  return Object.assign(r, { region: { x: x0, y: y0, w: rw, h: rh } });
}

/* ---------------- 一站式：找窗口 → 置前 → 校验 → （可选）点位 ---------------- */
async function target(title, opts) {
  const o = opts || {};
  const list = await fw.listWindows();
  const want = String(title || '');
  const win = list.windows
    .filter((w) => w.title.indexOf(want) >= 0)
    .sort((a, b) => b.w * b.h - a.w * a.h)[0];
  if (!win) return { ok: false, reason: 'window-not-found', candidates: list.windows.map((w) => w.title).slice(0, 20) };
  const f = await ensureForeground(want, o);
  /* ★ 聚焦之后必须【重新读矩形】★
     实测：最小化的窗口 GetWindowRect 返回 -32000,-32000（Windows 把最小化窗口扔到屏幕外），
     恢复之后才是真坐标。第一版直接用了聚焦前的 rect，于是返回了 -32000 —— 照它点击必然全错。
     （这正是"拿着一个看起来像数据的旧值就用了"，和今天批评的那些假成功同一类错误。） */
  let fresh = win;
  if (f.ok) {
    const again = await fw.listWindows();
    const w2 = again.windows.filter((w) => w.title.indexOf(want) >= 0).sort((a, b) => b.w * b.h - a.w * a.h)[0];
    if (w2 && !w2.iconic && w2.w > 200) fresh = w2;
    else if (w2) fresh = w2;   // 至少用新值（哪怕它仍是最小化 —— 调用方能用 iconic 判断）
  }
  return {
    ok: f.ok && !fresh.iconic, window: fresh, foreground: f,
    rect: { x: fresh.x, y: fresh.y, w: fresh.w, h: fresh.h },
    stale: fresh === win,
    dpi: list.dpi, scale: list.scale,
  };
}

module.exports = {
  assertForeground, assertForegroundOrReport, pointInRect, ensureForeground, diffRegion, target,
  clickSafe, moveSafe, keySafe, typeSafe,
  _internals: { pointInRect },
};
