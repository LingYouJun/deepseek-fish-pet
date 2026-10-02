/* 会话（原"短期记忆"）
 * 不再是一个"记忆层"，就是当前这轮对话本身。
 * 关键改动：后台防抖把草稿写到磁盘，断电/强杀不丢；
 *          下次启动把草稿恢复成"还没结束的会话"接着聊。
 */
const store = require('../store');
const bus = require('../bus');
const fmt = require('../sessionfmt');

const NS = 'session';
const MAX_DRAFT_MSGS = 300;   // 草稿最多留多少条，防文件无限大

let state = null;
/* 磁盘上那个会话文件的版本比本程序还新 → 拒绝加载。此时**绝不能写盘**：
   否则会用空会话覆盖掉用户那个"更高版本"的文件，而那是不可逆的数据丢失。
   （照 DSH dsh-session-format:134 的语义：旧程序不猜新格式。） */
let readOnly = false;

function newId() { return 's-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7); }
function blank() { return { id: newId(), startedAt: Date.now(), messages: [], resumed: false }; }
function ensure() { if (!state) state = blank(); return state; }

let saveTimer = null;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 800);
}
function saveNow() {
  clearTimeout(saveTimer);
  if (!state) return;
  if (readOnly) return;          // 见上面 readOnly 的说明：拒绝加载期间一律不写
  try {
    const msgs = state.messages.slice(-MAX_DRAFT_MSGS);
    /* 写盘前统一包上当前格式版本 —— 这是迁移的另一半，见 src/sessionfmt.js */
    store.write(NS, fmt.wrap({ id: state.id, startedAt: state.startedAt, savedAt: Date.now(), messages: msgs }));
  } catch {}
}

/* 启动时恢复：有草稿 → 当成还没结束的会话继续；没有 → 开新会话。
 * 读出来的数据**先过迁移**（老格式 → 当前格式），迁移失败就拒绝加载并保护原文件。 */
function restore() {
  const d = store.read(NS, null);
  if (d != null) {
    const m = fmt.migrate(d);
    if (!m.ok) {
      /* 迁移不了（例如文件是更高版本写的）→ 开新会话，但**只读**，绝不覆盖原文件 */
      readOnly = true;
      try { console.error('[session] 拒绝加载会话草稿：' + m.error); } catch {}
      state = blank();
      bus.emit('session:start', info());
      return state;
    }
    const v = m.data;
    if (v && Array.isArray(v.messages) && v.messages.length) {
      state = { id: v.id || newId(), startedAt: v.startedAt || Date.now(), messages: v.messages, resumed: true, migratedFrom: m.migrated ? m.from : null };
      /* 迁移过就立刻用新格式写回一次（别等下次保存，免得中途崩了又回到老格式） */
      if (m.migrated) saveNow();
      bus.emit('session:start', info());
      return state;
    }
  }
  state = blank();
  bus.emit('session:start', info());
  return state;
}

function push(...msgs) {
  ensure();
  for (const m of msgs) if (m) state.messages.push(m);
  scheduleSave();
  return state;
}

function all() { return ensure().messages; }

/* 收尾成功后清空草稿，避免下次被当成未结束会话重复记账 */
function clear() { state = blank(); clearTimeout(saveTimer); if (!readOnly) store.write(NS, null); }

function info() {
  const s = ensure();
  return { id: s.id, startedAt: s.startedAt, count: s.messages.length, resumed: !!s.resumed, readOnly: readOnly, migratedFrom: s.migratedFrom == null ? null : s.migratedFrom, version: fmt.CURRENT };
}

module.exports = { restore, push, all, clear, info, saveNow, NS };
