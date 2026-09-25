// 项目文件夹：桌宠写的"真·小软件"都放这里
//
//   <userData>/projects/<项目名>/index.html …
//
// 和技能目录一样带路径沙箱，只能在 projects/ 里操作。
// 多行代码不走单行 ACTION（装不下），而是让模型在回复里用块：
//   <<<WRITE: 番茄钟/index.html
//   <!doctype html> …
//   >>>
// 由主进程解析出来，交给渲染层做"允许/拒绝"再落盘。
const { app, shell } = require('electron');
const path = require('path');
const fs = require('fs');

function rootDir() {
  const d = path.join(app.getPath('userData'), 'projects');
  try { fs.mkdirSync(d, { recursive: true }); } catch {}
  return d;
}

/* 相对路径 → projects/ 下的绝对路径，禁止越界 */
function safePath(rel) {
  const base = path.resolve(rootDir());
  const cleaned = String(rel == null ? '' : rel).replace(/\\/g, '/').replace(/^\/+/, '').trim();
  const full = path.resolve(base, cleaned);
  if (full !== base && !full.startsWith(base + path.sep)) throw new Error('路径越界（只能在项目文件夹里操作）');
  return full;
}

function ls(rel) {
  const p = safePath(rel);
  const st = fs.statSync(p);
  if (!st.isDirectory()) return [path.basename(p)];
  return fs.readdirSync(p, { withFileTypes: true })
    .filter((d) => !d.name.startsWith('.'))
    .map((d) => (d.isDirectory() ? d.name + '/' : d.name))
    .sort();
}

function readFile(rel, max) {
  const p = safePath(rel);
  if (fs.statSync(p).isDirectory()) throw new Error('这是文件夹，用 proj_ls 看里面');
  const cap = Math.max(500, Math.min(40000, Number(max) || 8000));
  const text = fs.readFileSync(p, 'utf8');
  return { text: text.slice(0, cap), truncated: text.length > cap, size: text.length };
}

/* 写一个文件（自动建目录）。单个文件上限 200KB，防跑飞 */
function writeOne(rel, content) {
  const p = safePath(rel);
  if (p === path.resolve(rootDir())) throw new Error('不能写项目根目录');
  const text = String(content == null ? '' : content);
  if (Buffer.byteLength(text) > 200 * 1024) throw new Error('文件太大（上限 200KB）：' + rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text);
  return { path: String(rel).replace(/\\/g, '/'), bytes: Buffer.byteLength(text) };
}

/* 批量写（来自回复里的 WRITE 块） */
function writeMany(files) {
  const out = [];
  for (const f of files || []) {
    if (!f || !f.path) continue;
    out.push(writeOne(f.path, f.content));
  }
  return out;
}

function remove(rel) {
  const p = safePath(rel);
  if (p === path.resolve(rootDir())) throw new Error('不能删项目根目录');
  const st = fs.statSync(p);
  if (st.isDirectory()) fs.rmSync(p, { recursive: true });
  else fs.unlinkSync(p);
  return { path: String(rel) };
}

/* 用系统默认程序打开（.html 就是浏览器） */
async function open(rel) {
  const p = safePath(rel);
  const err = await shell.openPath(p);
  if (err) throw new Error(err);
  return { path: String(rel) };
}

/* 解析回复里的 WRITE 块（可能多个） */
function parseWriteBlocks(raw) {
  const out = [];
  const re = /<<<\s*WRITE\s*[:：]\s*([^\r\n]+?)\s*\r?\n([\s\S]*?)\r?\n?\s*>>>/g;
  let m;
  while ((m = re.exec(String(raw || '')))) {
    const p = String(m[1]).trim().replace(/^["'`]|["'`]$/g, '');
    if (p) out.push({ path: p, content: m[2] });
  }
  return out;
}

function openFolder(rel) { return shell.openPath(rel ? safePath(rel) : rootDir()); }

module.exports = { rootDir, safePath, ls, readFile, writeOne, writeMany, remove, open, openFolder, parseWriteBlocks };
