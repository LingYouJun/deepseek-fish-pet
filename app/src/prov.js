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

  function prune() {
    const t = now();
    offers = offers.filter((v) => t - v.at <= ttl);
    clicks = clicks.filter((v) => t - v.at <= ttl * 5);
    return t;
  }

  /* 确定性工具报坐标时调用 ✓（labelled ✓ 便于回执里说清"坐标是谁给的"✓） */
  function offer(x, y, from, label) {
    const t = prune();
    if (!Number.isFinite(Number(x)) || !Number.isFinite(Number(y))) return null;
    const rec = { x: Number(x), y: Number(y), from: String(from || '?'), label: String(label || ''), at: t };
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
      if (d <= nearPx && d < bestD) { bestD = d; best = v; }
    }
    return best ? { offer: best, dist: bestD } : null;
  }

  function sameTargetCount(x, y) {
    prune();
    const X = Number(x), Y = Number(y);
    return clicks.filter((c) => Math.hypot(c.x - X, c.y - Y) <= nearPx).length;
  }

  /* ★动鼠标之前的闸门★ → {ok:true, offer} / {ok:false, reason, hint} */
  function gate(action, x, y) {
    prune();
    const hit = findOffer(x, y);
    if (!hit) {
      return {
        ok: false,
        reason: '★这个坐标 (' + Math.round(Number(x)) + ',' + Math.round(Number(y)) + ') 不是任何**确定性工具**刚给出的✗★'
          + '（最近 ' + Math.round(ttl / 1000) + ' 秒内没有任何 find_text/find_template/grid_count/icon_lib/find_owned/click_checked 报过它附近 ' + nearPx + 'px 的点 ✓）',
        hint: '★模型自己写的坐标一律不执行✗★ —— 要点击请先用 find_text|<文字> 或 find_owned|<按钮>|<房间> 拿到坐标 ✓，'
          + '或者直接用 click_checked（它自己找坐标 + 点后核对判据 ✓）。',
      };
    }
    const n = sameTargetCount(x, y);
    if (n >= maxSame) {
      return {
        ok: false,
        reason: '★这个目标已经点过 ' + n + ' 次了（上限 ' + maxSame + '）✗★ —— 坐标来自「' + hit.offer.from + '」✓',
        hint: '★别再点了✗★（主人的原话：点对一次又点一次取消了 ✓）。请先 panel_state 看当前面板、'
          + '或换一个"只在成功后出现"的判据，把情况如实报给主人 ✓。',
      };
    }
    return { ok: true, offer: hit.offer, dist: hit.dist, alreadyClicked: n, action: String(action || '') };
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
    return { offers: offers.length, clicks: clicks.length, ttlMs: ttl, nearPx, maxSame };
  }

  return { offer, gate, note, clear, stats, offers: () => offers.slice(), clicks: () => clicks.slice() };
}

module.exports = { create, TTL_MS, NEAR_PX, MAX_SAME };
