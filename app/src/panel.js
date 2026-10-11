/* panel.js —— ★"现在在哪个面板"的状态判定（用**只在那个面板出现**的词当指纹 ✓ 纯函数 ✓ 可单测 ✓）★
 *
 * 【为什么需要它 ✗→✓（今晚的真实失败模式 3）】
 *   她点对「编辑队列」之后，★卡在一个根本不存在的"确认"按钮上反复找✗★，
 *   最后因为"连续看屏幕次数过多"任务期结束 ✓。
 *   根因不是"她笨"✗：★她根本没有"我现在在哪个面板"的概念✗★ —— 没有面板就没有"这个面板里该有什么"✓，
 *   于是只能在屏幕上乱找那个词 ✓。
 *   本模块给出确定性答案 ✓：「当前面板 = 队列面板（依据：命中了『当前进驻』✓；选人面板的『清空选择/确认』一个都没中 ✗）」✓
 *
 * 【指纹从哪来 ✗→✓】★真机素材实测出来的，不是拍脑袋 ✗★（2026-10-11）
 *   素材：step1.png（基地视图 ✓）/ step3.png（选人面板 ✓）/ after-click.png（会客室队列面板 ✓）/ stop-state.png（DSH 窗口 ✗）
 *   实测各面板"只在自己身上出现"的词：
 *     · 基地视图    ：编辑队列（base/step1 ✓）、进驻上限、干员信息、控制中枢、队列轮换
 *     · 选人面板    ：清空选择 ✓、确认 ✓、伊内丝/晓歌/苦艾/骋风…（干员名 ✓）、技能、心情、信赖值、进驻状态、收起>
 *     · 队列面板    ：当前进驻 ✓、房间2/12 ✓、（2/3）✓
 *     · 编辑队列面板：当前进驻 ✓（和队列面板同源 ✓ —— 今晚 after-click.png 就是它 ✓）
 *   交叉检查（真实计数 ✓）：编辑队列→base,step1（★点前就有✓★）；当前进驻→queue（★点前没有✓★）；
 *                          清空选择/确认→select；会客室→四个面板都有（★所以"会客室"不能单独当判据✗★）。
 *
 * 【判定规则（保守 ✓ 不确定就说不确定 ✗ 不许瞎猜 ✓）】
 *   每个面板给一组指纹词 ✓；命中数最多者为候选 ✓；命中数 < minHits（默认 2 ✓）→ 报 unknown ✓；
 *   两个面板并列最高 → 报 uncertain 并列出两者 ✓。
 */
'use strict';

/* ★指纹表（真机实测 ✓；左边是"面板名"，右边是"只在它身上出现的词"）★ */
const PANELS = {
  /* ★2026-10-11 补：基地地图那一屏原来报 unknown ✗（真实缺陷，lead 抓到 ✓）★
     证据：01-after-esc.png 的 OCR（fixtures/ocr-basemap.json ✓）里有
     房间数量 / 发电站 / 训练室 / 加工站 / 回收站 ✓ —— 而 base 原有的词全是"房间列表视图"的
     （进驻上限/干员信息/控制中枢/队列轮换 ✓）→ 地图视图一个都不中 → unknown ✓。
     交叉核对（7 帧真实 OCR ✓）：这 5 个词在 select/queue/dsh 三帧里**一个都没出现** ✓ → 加进来不会误判 ✓。
     ⚠️ 工作区/非工作区 **不能**加 ✗：dsh 和 step1 帧里也有 ✓（会并列成 uncertain ✓）。 */
  base: { label: '基地视图（房间列表 / 基建地图）', words: ['编辑队列', '进驻上限', '干员信息', '控制中枢', '队列轮换', '房间数量', '发电站', '训练室', '加工站', '回收站'] },
  select: { label: '干员选择面板（选人）', words: ['清空选择', '确认', '进驻状态', '信赖值', '收起>'] },
  queue: { label: '进驻队列面板（会客室/制造站等的队列）', words: ['当前进驻', '房间2/12', '（2/3）'] },
  dsh: { label: '桌宠/DSH 自己的窗口（不是游戏 ✗）', words: ['对话', '轨迹', '深度求索'] },
};

function norm(s) { return String(s == null ? '' : s).replace(/\s+/g, ''); }

/* 整帧 OCR 文本里，每个面板命中哪些词 ✓ */
function hits(ocr, name) {
  const p = PANELS[name];
  if (!p) return null;
  const hay = norm((ocr && ocr.text) || '') + '|' + (ocr && ocr.lines || []).map((L) => norm(L.text)).join('|');
  const hit = p.words.filter((w) => hay.indexOf(w) >= 0);
  return { name, label: p.label, hits: hit, score: hit.length, total: p.words.length };
}

/* ★判定当前面板★ → {panel, label, score, best, second, verdict:'ok'|'unknown'|'uncertain', all:[...]} */
function detect(ocr, opt) {
  const o = opt || {};
  const minHits = o.minHits == null ? 2 : Number(o.minHits);
  const all = Object.keys(PANELS).map((k) => hits(ocr, k)).filter(Boolean).sort((a, b) => b.score - a.score);
  const best = all[0] || null, second = all[1] || null;
  if (!best || best.score === 0) return { panel: null, label: null, score: 0, best, second, verdict: 'unknown', all, note: '一个指纹词都没命中 ✗ → 我不知道这是哪个面板（不猜 ✓）' };
  if (best.score < minHits) return { panel: null, label: null, score: best.score, best, second, verdict: 'unknown', all, note: '命中 ' + best.score + ' 个词 < ' + minHits + ' → 证据不足 ✗（不猜 ✓）' };
  if (second && second.score === best.score) return { panel: null, label: null, score: best.score, best, second, verdict: 'uncertain', all, note: '「' + best.label + '」和「' + second.label + '」并列最高（各 ' + best.score + '）✗ → 不确定 ✓' };
  return { panel: best.name, label: best.label, score: best.score, best, second, verdict: 'ok', all, note: '依据：命中 ' + JSON.stringify(best.hits) + '（第二是 ' + (second ? second.label + ' ' + second.score : '无') + ' ✓）' };
}

/* 某面板的"可用判据词"（给 click_checked 建议 ✓：★只在成功后出现的词✓★） */
function criteriaFor(name) { return (PANELS[name] ? PANELS[name].words.slice() : []); }

module.exports = { PANELS, norm, hits, detect, criteriaFor };
