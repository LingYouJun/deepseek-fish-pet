const { app, shell, desktopCapturer, screen } = require('electron');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const web = require('./web');
const screenstream = require('./screenstream');
const input = require('./input');
const vision = require('./vision');
const config = require('./config');
const skills = require('./skills');
const style = require('./style');
const projects = require('./projects');

// 每个工具所需的最低权限档
const TOOL_TIER = {
  list_dir: 'read', read_file: 'read', use_skill: 'read', skill_ls: 'read', skill_read: 'read',
  proj_ls: 'read', proj_read: 'read',
  open_path: 'normal', open_url: 'normal', skill_write: 'normal', skill_rm: 'normal', proj_rm: 'normal', proj_open: 'normal',
  web_open: 'web', web_click: 'web', web_type: 'web', web_read: 'web',
  screen_shot: 'full', screen_look: 'full',
  click: 'full', rclick: 'full', dclick: 'full', move: 'full', drag: 'full', scroll: 'full', type: 'full', key: 'full',
};
const RANK = { off: 0, read: 1, normal: 2, web: 3, full: 4 };

function allowed(tier, tool) {
  const need = TOOL_TIER[tool];
  return !!need && (RANK[tier] || 0) >= RANK[need];
}

/* ---------------- 全屏截图（主屏） ----------------
   优先走连续屏幕流（抓一帧 ~50ms），流起不来退回 desktopCapturer（~650ms）。 */
function shotsDir() {
  const d = path.join(app.getPath('userData'), 'shots');
  try { fs.mkdirSync(d, { recursive: true }); } catch {}
  return d;
}

async function captureScreen() {
  const frame = await screenstream.grabFrame();
  if (frame && frame.dataUrl) {
    const p = path.join(shotsDir(), 'screen-' + Date.now() + '.jpg');
    fs.writeFileSync(p, Buffer.from(frame.dataUrl.split(',')[1], 'base64'));
    return { path: p, width: frame.width, height: frame.height, dataUrl: frame.dataUrl };
  }
  return captureScreenFallback();
}

async function captureScreenFallback() {
  const primary = screen.getPrimaryDisplay();
  const { width, height } = primary.size;                 // DIP 尺寸
  const scale = primary.scaleFactor || 1;
  const tw = Math.round(width * scale), th = Math.round(height * scale);   // 物理像素，更清晰
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: tw, height: th } });
  let src = sources[0];
  const match = sources.find((s) => s.display_id === String(primary.id));
  if (match) src = match;
  const png = src.thumbnail.toPNG();

  const p = path.join(shotsDir(), 'screen-' + Date.now() + '.png');
  fs.writeFileSync(p, png);
  return { path: p, width: tw, height: th, dataUrl: 'data:image/png;base64,' + png.toString('base64') };
}

/* Windows 自带 OCR（离线，支持中英文）。失败返回空串，不影响截图展示。 */
function ocr(pngPath) {
  try {
    const script = path.join(__dirname, '..', 'scripts', 'ocr.ps1');
    const r = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-Path', pngPath],
      { encoding: 'utf8', timeout: 25000, windowsHide: true });
    const out = String((r.stdout || '') + '\n' + (r.stderr || '')).trim();
    // 过滤掉 powershell 报错噪声，只要文字
    return out || '';
  } catch { return ''; }
}

async function run(tool, arg) {
  arg = String(arg == null ? '' : arg).trim();
  if (!TOOL_TIER[tool]) throw new Error('未知操作：' + tool);

  if (tool.startsWith('web_')) return web.run(tool, arg);

  if (tool === 'screen_shot') {
    const cap = await captureScreen();
    const text = ocr(cap.path);
    const result = '🖥 已截取屏幕（' + cap.width + '×' + cap.height + '）\n'
      + (text ? '屏幕上识别到的文字：\n' + text : '（未识别到文字；截图已展示在对话里，你可以自己看）');
    return { text: result, image: cap.dataUrl, path: cap.path, ocr: text };
  }

  if (tool === 'screen_look') {
    const cap = await captureScreen();
    const cfg = config.load();
    let text = '';
    let usedVision = false;
    let action = null;
    if (cfg.visionEnabled) {
      const q = (arg || '看看屏幕') + '\n\n【输出要求】先用一句中文说明你的判断；如果这一步需要操作屏幕，就在回答的最后单独输出一行：ACTION: 工具|参数（坐标基于 1280x720 截图，左上角 0,0；工具可选 click/rclick/dclick/move/drag/scroll/type/key，例如 ACTION: click|640,360）。如果不需要操作就不要写 ACTION 行。';
      try {
        text = await vision.describe(cfg, cap.dataUrl, q, 'low');
        usedVision = true;
        const m = text.match(/ACTION\s*[:：]\s*([a-z_]+)\s*\|\s*(.+)/i);
        if (m) {
          const t = m[1].trim().toLowerCase();
          if (TOOL_TIER[t]) action = { tool: t, arg: m[2].trim() };
        }
      } catch (e) {
        text = '';
      }
    }
    if (!text) {
      const t = ocr(cap.path);
      text = t ? ('屏幕上识别到的文字：\n' + t) : '（未启用视觉模型，且未识别到文字）';
    }
    return { text: (usedVision ? '👁 视觉模型：\n' : '🖥 屏幕文字：\n') + text, image: cap.dataUrl, path: cap.path, action };
  }

  // skill_ls / proj_ls 允许空参数（列根目录），其它需要参数的工具才拦
  if (!arg && tool !== 'skill_ls' && tool !== 'proj_ls') throw new Error('操作参数为空');
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

  /* ---------------- 技能：按需加载完整说明 ---------------- */
  if (tool === 'use_skill') {
    const s = skills.read(arg);
    if (!s) {
      const ids = skills.list().map((x) => x.id).join('、') || '(暂无)';
      throw new Error('没有这个技能：' + arg + '。可用技能：' + ids);
    }
    let out = '📘 技能「' + s.name + '」\n' + s.body;
    if (s.memory && s.memory.length) {
      const facts = s.memory.slice().sort((a, b) => (Number(b.weight) || 0) - (Number(a.weight) || 0)).slice(0, 10);
      out += '\n\n【这个技能积累下来的经验】\n' + facts.map((f) => '- ' + f.text).join('\n');
    }
    // 界面风格这一个技能要跟"记忆"联动：加载时按当前好感度/心情微调冷暖
    if (s.id === style.SKILL_ID) {
      try {
        const hint = style.moodHint(require('./mood').load());
        if (hint) out += '\n\n【当前状态微调（记忆联动）】\n' + hint;
      } catch {}
    }
    return out;
  }

  /* ---------------- 技能目录的自主管理（AI 自己整理经验） ---------------- */
  if (tool === 'skill_ls') {
    const items = skills.ls(arg || '');
    return '📂 技能目录 ' + (arg || '/') + '（' + items.length + ' 项）：\n' + (items.join('\n') || '(空)');
  }
  if (tool === 'skill_read') {
    const r = skills.readFile(arg || '');
    return '📄 ' + arg + (r.truncated ? '（只显示前 6000 字，共 ' + r.size + ' 字）' : '') + '：\n' + r.text;
  }
  if (tool === 'skill_write') {
    const s = String(arg || '');
    const i = s.indexOf('||');
    if (i < 0) throw new Error('格式：skill_write|技能/子路径/文件.md||内容');
    const rel = s.slice(0, i).trim();
    // 允许用 \n 写换行（ACTION 只能是一行）
    const content = s.slice(i + 2).replace(/\\n/g, '\n');
    const r = skills.writeFile(rel, content);
    return '💾 已写入技能文件：' + r.path + '（' + r.bytes + ' 字节）';
  }
  if (tool === 'skill_rm') {
    const r = skills.remove(arg || '');
    return '🗑 已删除：' + r.path;
  }

  /* ---------------- 项目文件夹（她写的小软件放这儿） ---------------- */
  if (tool === 'proj_ls') {
    const items = projects.ls(arg || '');
    return '📂 项目目录 ' + (arg || '/') + '（' + items.length + ' 项）：\n' + (items.join('\n') || '(空)');
  }
  if (tool === 'proj_read') {
    const r = projects.readFile(arg || '');
    return '📄 ' + arg + (r.truncated ? '（只显示前 8000 字，共 ' + r.size + ' 字）' : '') + '：\n' + r.text;
  }
  if (tool === 'proj_rm') {
    const r = projects.remove(arg || '');
    return '🗑 已删除：' + r.path;
  }
  if (tool === 'proj_open') {
    const r = await projects.open(arg || '');
    return '🌐 已用默认程序打开：' + r.path;
  }

  /* ---------------- OS 级键鼠（坐标是 1280x720 截图空间） ---------------- */
  const parseXY = (s) => {
    const m = String(s || '').trim().match(/^\s*(-?\d+(?:\.\d+)?)\s*[,，]\s*(-?\d+(?:\.\d+)?)\s*$/);
    if (!m) throw new Error('坐标格式应为 x,y');
    return [Number(m[1]), Number(m[2])];
  };
  if (tool === 'click' || tool === 'rclick' || tool === 'dclick' || tool === 'move') {
    const [x, y] = parseXY(arg);
    const label = { click: '左键点击', rclick: '右键点击', dclick: '双击', move: '移动鼠标' }[tool];
    input[tool](x, y);
    return `✅ 已${label}：(${x}, ${y})`;
  }
  if (tool === 'drag') {
    const parts = String(arg).split('|');
    const [x1, y1] = parseXY(parts[0]);
    const [x2, y2] = parseXY(parts[1]);
    input.drag(x1, y1, x2, y2);
    return `✅ 已拖拽：(${x1},${y1}) → (${x2},${y2})`;
  }
  if (tool === 'scroll') {
    const parts = String(arg).split('|');
    const [x, y] = parseXY(parts[0]);
    const delta = Number(parts[1]) || 120;
    input.scroll(x, y, delta);
    return `✅ 已滚动：(${x},${y}) ${delta > 0 ? '向上' : '向下'}`;
  }
  if (tool === 'type') {
    input.type(arg);
    return `✅ 已输入文字：${arg.slice(0, 50)}`;
  }
  if (tool === 'key') {
    input.key(arg);
    return `✅ 已按键：${arg}`;
  }
}

module.exports = { run, allowed, TOOL_TIER, RANK };
