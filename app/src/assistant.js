const { shell } = require('electron');
const fs = require('fs');
const web = require('./web');

// 每个工具所需的最低权限档
const TOOL_TIER = {
  list_dir: 'read', read_file: 'read',
  open_path: 'normal', open_url: 'normal',
  web_open: 'web', web_click: 'web', web_type: 'web', web_read: 'web'
};
const RANK = { off: 0, read: 1, normal: 2, web: 3 };

function allowed(tier, tool) {
  const need = TOOL_TIER[tool];
  return !!need && (RANK[tier] || 0) >= RANK[need];
}

async function run(tool, arg) {
  arg = String(arg == null ? '' : arg).trim();
  if (!TOOL_TIER[tool]) throw new Error('未知操作：' + tool);

  if (tool.startsWith('web_')) return web.run(tool, arg);

  if (!arg) throw new Error('操作参数为空');
  if (tool === 'open_url') {
    if (!/^https?:\/\//i.test(arg)) throw new Error('网址需以 http(s):// 开头');
    await shell.openExternal(arg);
    return `✅ 已打开网页：${arg}`;
  }
  if (tool === 'open_path') {
    const err = await shell.openPath(arg);
    if (err) throw new Error(err);
    return `✅ 已打开：${arg}`;
  }
  if (tool === 'list_dir') {
    const items = fs.readdirSync(arg).slice(0, 80);
    return `📂 ${arg}（${items.length} 项）：\n${items.join('\n')}`;
  }
  if (tool === 'read_file') {
    const text = fs.readFileSync(arg, 'utf8').slice(0, 3000);
    return `📄 ${arg}：\n${text}`;
  }
}

module.exports = { run, allowed, TOOL_TIER };
