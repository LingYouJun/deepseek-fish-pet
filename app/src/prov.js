/* prov.js —— ★坐标"来源证明"闸门：坐标只能来自确定性工具，模型不许自己写✗★
 * （2026-10-11 主人的第 5 条：「视觉模型太差太差了，为什么每次坐标都是错的」）
 *
 * 【原理（为什么这比"换模型"对 ✗）】
 *   模型看图 = 切 patch + 把 1920 缩到 ~768 ✓ —— 空间精度天生不够 ✓：
 *   几十像素的误差，对四五十像素的图标就是致命的 ✓。所以正解不是让模型"估得更准"✗，
 *   而是★把模型的坐标出口彻底堵死✗→✓★：模型只许回答**编号 / 名称 / 是·否** ✓，
 *   坐标一律来自确定性工具（OCR 包围盒 / 模板匹配 / 像素量距 / 几何聚类 ✓）。
 *
 * 【本模块做什么】一个小账本：
 *   · 确定性工具（find_text / find_template / grid_count / icon_lib / find_owned / click_checked /
 *     uia_find / screen_look 的 OCR 结果 ✓）把"我刚给出的坐标 + 用途"记进账本 ✓；
 *   · 点击类工具（click / clickz / rclickz / dclickz / move / movez / drag ✓）在真的动鼠标前，
 *     先问账本：★这个坐标是刚（默认 120 秒内）由某个确定性工具给出的吗✗？★
 *     · 是 → 放行 ✓（并且记一次"这个坐标已经被点过"）
 *     · 不是 → ★拒绝执行✗★，并告诉它"要点击请先用 find_text/find_owned/click_checked 拿坐标" ✓
 *   · 同一个坐标**点了两次还没成功** → 第三次直接拒绝 ✓（主人的第 ③④ 条："点对一次又点掉一次 / 原地徘徊" ✓）。
 *
 * ★为什么"事后校验"不行✗★：先让模型给坐标、点错了再发现 → 那一次点击**已经发出去了** ✓
 *   （游戏里可能已经改了状态 ✓）—— 主人明确说那是"二次浪费" ✓。所以必须在**动鼠标之前**拦 ✓。
 *
 * 纯函数 + 可注入 now ✓ 可单测 ✓ 不依赖屏幕 ✓。
 */
'use strict';

const TTL_MS = 120000;        // 工具给的坐标 120 秒内算"刚给的" ✓
const NEAR_PX = 24;           // 同一点击目标的判定半径 ✓（OCR 框中心 vs 点击点的小误差 ✓）
const MAX_SAME = 2;           // ★同一目标最多允许点 2 次✗→★第 3 次拒绝 ✓★

function create(opt) {
  const o = opt || {};
  const now = o.now || (() => Date.now());
  const ttl = o.ttlMs == null ? TTL_MS : o.ttlMs;
  const nearPx = o.nearPx == null ? NEAR_PX : o.nearPx;
  const maxSame = o.maxSame == null ? MAX_SAME : o.maxSame;
  let offers = [];    // [{x,y,from,at,label}]
  let clicks = [];    // [{x,y,at,from}]
  let bypasses = [];  // ★逃生门放行记录★（谁/什么时候/什么用途 —— 事后审计用 ✓）

  function prune() {
    const t = now();
    offers = offers.filter((v) => t - v.at <= ttl);
    clicks = clicks.filter((v) => t - v.at <= ttl * 5);
    return t;
  }

  /* 确定性工具报坐标时调用 ✓（labelled ✓ 便于回执里说清"坐标是谁给的"✓）
   * extra（2026-10-11 加）：额外审计字段（例如流程重放的 source:'replay' / recordedAt / stepId / how ✓）。
   * ★canonical 字段不可被 extra 覆盖★（x/y/at/from/label 最后写 ✓） */
  function offer(x, y, from, label, extra) {
    const t = prune();
    if (!Number.isFinite(Number(x)) || !Number.isFinite(Number(y))) return null;
    const rec = Object.assign({}, extra || {});
    rec.x = Number(x); rec.y = Number(y); rec.at = t;
    rec.from = String(from || '?'); rec.label = String(label || '');
    offers.push(rec);
    if (offers.length > 200) offers = offers.slice(-200);
    return rec;
  }

  function findOffer(x, y) {
    prune();
    const X = Number(x), Y = Number(y);
    let best = null, bestD = Infinity;
    for (const v of offers) {
      const d = Math.hypot(v.x - X, v.y - Y);
      /* ★同样近时取**更新**的那一条★（2026-10-11 修）：
         "复点必须有新证据"看的是 offer 的时间 ✓ —— 若一直取最早那条，
         重新定位之后仍然被判成"没有新证据"✗（真机/探针都复现过 ✓）。 */
      if (d <= nearPx && (d < bestD - 0.001 || (Math.abs(d - bestD) <= 0.001 && best && v.at > best.at))) { bestD = d; best = v; }
    }
    return best ? { offer: best, dist: bestD } : null;
  }

  function sameTargetCount(x, y) {
    prune();
    const X = Number(x), Y = Number(y);
    return clicks.filter((c) => Math.hypot(c.x - X, c.y - Y) <= nearPx).length;
  }

  /* 这个目标上一次是什么时候点的（用来判"复点有没有**新证据**"） */
  function lastClickAt(x, y) {
    prune();
    const X = Number(x), Y = Number(y);
    let t = null;
    for (const c of clicks) if (Math.hypot(c.x - X, c.y - Y) <= nearPx && (t == null || c.at > t)) t = c.at;
    return t;
  }

  /* ★动鼠标之前的闸门★ → {ok:true, offer} / {ok:false, code, reason, hint}
   *
   * ★★ 2026-10-11 加的一条（主人症状③的正解）★★
   *   实测：click 一次只发一组 down+up（间隔 45ms），Windows 认双击的窗口是 **500ms / 4px**，
   *   而她两次点击之间实测隔 **3~6 秒** → ★不可能被并成双击★。
   *   "点对一次又点掉一次" = **两次独立的单击打在同一个 toggle 上**（第一下开/选中，第二下关/取消）。
   *   所以：★复点必须有**新证据**★ —— 这个坐标要在**上一次点它之后**被某个确定性工具
   *   **重新报过一次**（= 新鲜帧重新定位、重新自证 ✓）；证不过就拒绝 ✗。
   *   · n===0（第一次）：★默认要求来源证明★（`requireOffer` 默认开 —— 这条线的契约是
   *     "模型自己写的坐标一律不执行" ✓，percept 的单测就是按这个冻住的 ✓）
   *     ★逃生门（2026-10-11 主人的要求）★：`{requireOffer:false, why:'<用途>'}` ——
   *     `why` **必填**（空 → 拒绝 `bypass-without-why` ✓）；放行时**留痕**（返回 bypass + 写日志 ✓）；
   *     只给探针/开发/诊断用，★不写进她读得到的工具表★（否则模型会学会绕 ✗）。
   *   · n>=1：必须有**比上一次点击更新的** offer，否则 code='repeat-needs-fresh-evidence'
   *   · n>=maxSame(2)：一律拒绝，code='repeat-too-many'（第 3 次）
   *   · {allowStaleOffer:true} 只给单测/诊断用，生产别传 ✓ */
  function gate(action, x, y, opt) {
    prune();
    const o = opt || {};
    const wantOffer = o.requireOffer !== false;
    /* ★逃生门必须说清用途★（说不清就直接拒 —— 免得它变成事实上的常规通道 ✗） */
    const why = String(o.why == null ? '' : o.why).trim();
    if (!wantOffer && !why) {
      return {
        ok: false, code: 'bypass-without-why',
        reason: '★放行"没有定位来源的坐标"必须写清用途 ✗★（`{requireOffer:false, why:"…"}`）—— 收到的是空 why ✓',
        hint: '★这是给探针/开发/诊断用的逃生门✗★，不是常规通道：真要放行就把用途写清楚（会被记进日志 ✓）。',
      };
    }
    const hit = findOffer(x, y);
    const n = sameTargetCount(x, y);
    if (n >= 1) {
      if (n >= maxSame) {
        return {
          ok: false, code: 'repeat-too-many',
          reason: '★这个目标已经点过 ' + n + ' 次了（上限 ' + maxSame + '）✗★ —— 坐标来自「'
            + (hit ? hit.offer.from : '（已经不在账本里了）') + '」✓',
          hint: '★别再点了✗★（主人的原话：点对一次又点一次取消了 ✓）。请先 panel_state / screen_diff 看当前状态，'
            + '把情况如实报给主人 ✓；★不要换个坐标再打一发✗★（换坐标打在同一个 toggle 上，后果一样 ✓）。',
        };
      }
      if (!o.allowStaleOffer) {
        const last = lastClickAt(x, y);
        const fresh = !!(hit && last != null && hit.offer.at > last);
        if (!hit || !fresh) {
          return {
            ok: false, code: 'repeat-needs-fresh-evidence',
            reason: '★这个目标（' + Math.round(Number(x)) + ',' + Math.round(Number(y))
              + ' 附近 ' + nearPx + 'px）已经点过 ' + n + ' 次了，而**没有新的证据**✗★：'
              + (hit
                ? '账本里只有**点击之前**就报过的那次定位（来自「' + hit.offer.from + '」），点完之后没有再量过 ✓'
                : '最近 ' + Math.round(ttl / 1000) + ' 秒内没有任何确定性工具报过这个点 ✓'),
            hint: '★复点必须先**重新定位**★：用 locate / find_text / uia_find / find_owned 拿一次**新的**坐标'
              + '（== 新鲜帧重新量过、重新自证 ✓），证得过才允许再点一次 ✓。'
              + '★证不过就停手★：先看清现在是什么状态（panel_state / screen_diff），或者直接问主人 ✓。',
          };
        }
      }
    }
    /* 第一次点：★默认要求来源证明★（契约：模型自己写的坐标一律不执行 ✓）；
       ★逃生门★：显式 `{requireOffer:false, why:'…'}` 才放宽 —— 且必须留痕 ✓ */
    if (n === 0 && wantOffer && !hit) {
      return {
        ok: false, code: 'no-provenance',
        reason: '★这个坐标 (' + Math.round(Number(x)) + ',' + Math.round(Number(y))
          + ') 不是任何**确定性工具**刚给出的✗★（最近 ' + Math.round(ttl / 1000) + ' 秒内没有任何 '
          + 'uia_find/find_text/find_template/find_owned/click_checked/grid_count/icon_lib/locate 报过它附近 ' + nearPx + 'px 的点 ✓）',
        hint: '★模型自己写的坐标一律不执行✗★ —— 要点击请先用 find_text|<文字> / uia_find / find_owned 拿到坐标 ✓，'
          + '或者直接用 click_checked / locate → act（它们自己找坐标 + 点后核对判据 ✓）。',
      };
    }
    const bypass = (!wantOffer && !hit) ? why : null;
    if (bypass) recordBypass(action, x, y, bypass);
    return {
      ok: true, offer: hit ? hit.offer : null, dist: hit ? hit.dist : null,
      alreadyClicked: n, action: String(action || ''),
      freshEvidence: n >= 1 ? true : null,
      bypass,
    };
  }

  /* ★逃生门的留痕★（主人要求："每次放行都要在日志里留一行，方便事后审计"）
     · 写 testlog（结构化，好统计 ✓）+ debug.log（人看得懂 ✓）
     · 任何一步失败都不能影响动作本身 ✓ */
  function recordBypass(action, x, y, why) {
    /* ★去重★：同一次动作会被 safedrive 和 input **两道闸门各问一次** ✓ ——
       不去重会记两条（审计时看着像放了两次行 ✗）。3 秒内同动作同坐标同用途只记一条 ✓ */
    const last = bypasses[bypasses.length - 1];
    if (last && last.action === String(action || '') && last.x === Number(x) && last.y === Number(y)
      && last.why === String(why) && (now() - last.at) < 3000) return last;
    /* 同时挂一份在实例上：回执要把它写出来（谁、什么时候、什么用途 ✓） */
    const rec = { at: now(), action: String(action || ''), x: Number(x), y: Number(y), why: String(why) };
    bypasses.push(rec);
    if (bypasses.length > 50) bypasses = bypasses.slice(-50);
    try { require('./testlog').log('click', 'provenance-bypass', rec); } catch (e) {}
    try { require('./debug').log('[prov] ★逃生门放行★ ' + rec.action + ' (' + rec.x + ',' + rec.y + ') 用途=' + rec.why); } catch (e) {}
    return rec;
  }

  /* 真的点完（或确认已经发出）之后记账 ✓ */
  function note(action, x, y, from) {
    const t = prune();
    clicks.push({ x: Number(x), y: Number(y), at: t, action: String(action || ''), from: String(from || '') });
    if (clicks.length > 200) clicks = clicks.slice(-200);
    return clicks.length;
  }

  /* 成功之后清账 ✓（判据满足 → 同一目标可以重新开始 ✓） */
  function clear(x, y) {
    if (x == null) { clicks = []; offers = []; return 0; }
    const X = Number(x), Y = Number(y);
    const before = clicks.length;
    clicks = clicks.filter((c) => Math.hypot(c.x - X, c.y - Y) > nearPx);
    return before - clicks.length;
  }

  function stats() {
    prune();
    return { offers: offers.length, clicks: clicks.length, bypasses: bypasses.length, ttlMs: ttl, nearPx, maxSame };
  }

  return { offer, gate, note, clear, stats, lastClickAt, sameTargetCount,
    bypasses: () => bypasses.slice(),
    offers: () => offers.slice(), clicks: () => clicks.slice() };
}

/* ★★ 一个进程里只应该有一个账本 ★★（2026-10-11 加）
   为什么：`locate`/`act`（percept.js）与**裸 click**（safedrive.js）必须看同一本账 ✗→✓ ——
   否则"locate 刚量过的坐标"在 click 那边不算数、两边各拦各的，就是**两套互相打架的闸门** ✗。
   （原本 percept.js 自己 `PROV.create({})`，现在改成共用这一个 ✓） */
const instance = create({});

module.exports = { create, instance, TTL_MS, NEAR_PX, MAX_SAME };
