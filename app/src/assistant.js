const { app, shell, desktopCapturer, screen } = require('electron');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const web = require('./web');
const screenstream = require('./screenstream');
const input = require('./input');
const vision = require('./vision');
const config = require('./config');

// 每个工具所需的最低权限档
const TOOL_TIER = {
  list_dir: 'read', read_file: 'read',
  open_path: 'normal', open_url: 'normal',
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
    const question = arg || '看这张屏幕截图，用简短中文描述画面，并指出主要可点击元素的位置坐标（x,y，基于 1280x720 截图）。';
    let text = '';
    let usedVision = false;
    try {
      text = await vision.describe(config.load(), cap.dataUrl, question);
      usedVision = true;
    } catch (e) {
      text = '';
    }
    if (!text) {
      const t = ocr(cap.path);
      text = t ? ('屏幕上识别到的文字：\n' + t) : '（未配置视觉模型，且未识别到文字）';
    }
    return { text: (usedVision ? '👁 视觉模型：\n' : '🖥 屏幕文字：\n') + text, image: cap.dataUrl, path: cap.path };
  }

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
