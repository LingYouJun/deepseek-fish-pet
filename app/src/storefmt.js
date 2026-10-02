/* 存储层格式版本与迁移 —— C8 只覆盖了 session，这里把机制下沉到**所有记忆命名空间**
 *
 * 【为什么】用户的记忆（永久记忆、技能候选池、日记、统计、界面风格、对话日志…）是最不能丢的东西，
 *   而它们原来**一个都没有版本号**。格式一变就是静默读不回来，或者读出半截 ——
 *   和 session 当年一模一样的问题，只是散在七个文件里。
 *
 * 【DSH 的做法（dsh-session-format）】迁移必须相邻、缺边抛错、高版本拒绝加载。
 *   本模块把同一套规则做成"按命名空间各自一份"，因为每个文件独立演化。
 *
 * 【形状分三类，处理方式不同】
 *   ① 对象（chatlog / permanent / skillmem / stats / style / session）→ 包 version + 走迁移链；
 *   ② 数组（long / medium / statslog）→ **保持原样**。它们没有可加版本的位置，
 *      硬包成 {version,items} 要同时改三处读写方，收益不抵风险；这里只**显式登记**它们"故意是数组"，
 *      以免将来有人当成"没迁完"又去动它。
 *   ③ 标量（ending 存的是字面量 null —— "已收尾、没有挂起的事"）→ 原样通过。
 *      ⚠️ 第一版审计脚本把 null 当成了"解析失败"，其实它是**合法状态**（memory/index.js 的 END_NS）。
 *
 * 【高版本怎么办】照 DSH :134：**拒绝加载**，并把该命名空间标成只读（绝不写回覆盖）。
 */
'use strict';

const CURRENT = 1;

/* 故意是数组的命名空间（登记在案，不包装） */
const ARRAY_NS = ['long', 'medium', 'statslog'];
/* 可能是标量的命名空间（null 是合法状态） */
const SCALAR_NS = ['ending'];

/* 每个命名空间一份迁移链。目前所有对象命名空间都是 v0 → v1，且**只加 version 字段、不改形状** ——
   这不是"没干活"：它建立了机制与版本基线，以后真改形状时才有"从哪迁"的锚点。
   写迁移时的规矩（照 DSH）：up() 必须是**纯函数**，不改传入的对象。 */
const MIGRATIONS = {
  // 通用：v0（没有 version 字段的裸对象）→ v1
  '*': [
    { from: 0, to: 1, up: (d) => Object.assign({}, d, { version: 1 }) },
  ],
};

function shapeOf(v) {
  if (Array.isArray(v)) return 'array';
  if (v === null) return 'scalar';
  if (typeof v !== 'object') return 'scalar';
  return 'object';
}

function detectVersion(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return 0;
  const n = Number(v.version);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function chainFor(ns) {
  return MIGRATIONS[ns] || MIGRATIONS['*'];
}

/* 把任意形状的数据迁移到当前版本。
 * 返回 { ok, data, from, migrated, shape, error? }
 *   ok:false 时调用方**不要**用 data 覆盖磁盘。 */
function migrate(ns, raw) {
  const shape = shapeOf(raw);
  if (shape === 'array' && ARRAY_NS.indexOf(ns) >= 0) return { ok: true, data: raw, from: 0, migrated: false, shape, note: '故意是数组，不包装' };
  if (shape === 'scalar') return { ok: true, data: raw, from: 0, migrated: false, shape, note: raw === null ? '合法状态（例如"已收尾"）' : '标量' };
  if (shape === 'array') return { ok: true, data: raw, from: 0, migrated: false, shape, note: '未登记的数组，原样通过' };

  const from = detectVersion(raw);
  if (from > CURRENT) {
    return { ok: false, from, shape, error: '这个文件是**更新版本**的桌宠写的（文件版本 ' + from + '，本程序只到 ' + CURRENT + '）——'
      + '为避免读坏，已拒绝加载该命名空间（' + ns + '），并把它标为只读，绝不覆盖。请升级桌宠。' };
  }
  let cur = raw;
  let v = from;
  const chain = chainFor(ns);
  while (v < CURRENT) {
    const step = chain.find((m) => m.from === v);
    if (!step) return { ok: false, from, shape, error: '命名空间 ' + ns + ' 缺少从版本 ' + v + ' 开始的迁移步骤' };
    try { cur = step.up(cur); } catch (e) { return { ok: false, from, shape, error: '迁移 ' + step.from + '→' + step.to + ' 失败：' + ((e && e.message) || e) }; }
    v = step.to;
  }
  return { ok: true, data: cur, from, migrated: from !== CURRENT, shape };
}

/* 写盘前包一层：对象加 version；数组/标量原样返回。 */
function wrap(ns, data) {
  if (data === undefined) return undefined;
  const shape = shapeOf(data);
  if (shape !== 'object') return data;
  return Object.assign({}, data, { version: CURRENT });
}

/* 启动自检：每个登记过的链必须相邻且连到 CURRENT（照 DSH :124 的"宁可启动就炸"） */
function selfCheck() {
  for (const [ns, chain] of Object.entries(MIGRATIONS)) {
    let v = 0;
    for (const m of chain) {
      if (m.from !== v) throw new Error('存储迁移链断了（' + ns + '）：期望从 ' + v + ' 开始，却拿到 ' + m.from);
      if (m.to !== m.from + 1) throw new Error('存储迁移必须相邻（' + ns + '）：' + m.from + ' → ' + m.to);
      v = m.to;
    }
    if (v !== CURRENT) throw new Error('存储迁移链不完整（' + ns + '）：只连到 ' + v + '，当前是 ' + CURRENT);
  }
  return true;
}
selfCheck();

module.exports = { CURRENT, migrate, wrap, detectVersion, shapeOf, selfCheck, ARRAY_NS, SCALAR_NS, MIGRATIONS };
