// 人设：一个可写文件 + 逐字段的锁
//
// 为什么要单独一个模块：
//   1) AI 现在会**自己改人设**，所以人设文件必须放在可写的地方（userData），
//      不能再放 app/persona.json（打包后是只读的 asar）
//   2) 每个字段可以上锁：锁住 = AI 不许动，但用户自己还能改
const { app } = require('electron');
const path = require('path');
const fs = require('fs');

/* AI 可以改的字段（其它字段——比如 language/vocab_level——不属于"人设"，AI 碰不到） */
const FIELDS = ['name', 'world_setting', 'character_setting', 'personality', 'catchphrase', 'hidden_setting'];
const LABELS = {
  name: '名字',
  world_setting: '世界观',
  character_setting: '人物设定',
  personality: '性格',
  catchphrase: '口头禅',
  hidden_setting: '隐藏设定',
};

const builtinFile = () => path.join(__dirname, '..', 'persona.json');   // 随包发布的默认
const file = () => path.join(app.getPath('userData'), 'persona.json');  // 实际使用的（可写）

/* 首次运行把默认人设拷进 userData（之后用户/AI 都改这份） */
function ensure() {
  const f = file();
  if (!fs.existsSync(f)) {
    try { fs.copyFileSync(builtinFile(), f); }
    catch { try { fs.writeFileSync(f, JSON.stringify({ name: '大肥鱼' }, null, 2)); } catch {} }
  }
  return f;
}

function load() {
  ensure();
  try { return JSON.parse(fs.readFileSync(file(), 'utf8').replace(/^\uFEFF/, '')) || {}; } catch { return {}; }
}
function save(next) {
  ensure();
  try { fs.writeFileSync(file(), JSON.stringify(next, null, 2)); } catch {}
  return next;
}
function patch(p) { return save({ ...load(), ...(p || {}) }); }

/* ---- 锁 ---- */
function locks() { const l = load().locks; return (l && typeof l === 'object') ? l : {}; }
function setLock(field, locked) {
  if (!FIELDS.includes(field)) return load();
  const p = load();
  const l = Object.assign({}, p.locks || {});
  if (locked) l[field] = true; else delete l[field];
  p.locks = l;
  return save(p);
}
const unlocked = (field) => !locks()[field];

/* ---- AI 写入：只改没锁的字段 ---- */
function applyAI(changes) {
  const p = load();
  const l = locks();
  const applied = [], skipped = [], ignored = [];
  for (const k of Object.keys(changes || {})) {
    const v = changes[k];
    if (!FIELDS.includes(k)) { ignored.push(k); continue; }
    if (l[k]) { skipped.push(k); continue; }
    if (typeof v !== 'string' || !v.trim()) continue;
    p[k] = v.trim();
    applied.push(k);
  }
  if (applied.length) save(p);
  return { applied, skipped, ignored };
}

module.exports = { FIELDS, LABELS, file, builtinFile, ensure, load, save, patch, locks, setLock, unlocked, applyAI };
