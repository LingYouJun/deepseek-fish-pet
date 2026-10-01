const { app, shell, desktopCapturer, screen } = require('electron');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { StringDecoder } = require('string_decoder');   // OCR 收 stdout 用（见 ocr() 的注释）
const web = require('./web');
const screenstream = require('./screenstream');
const input = require('./input');
const vision = require('./vision');
const config = require('./config');
const skills = require('./skills');
const style = require('./style');
const projects = require('./projects');
const personatags = require('./personatags');

// 每个工具所需的最低权限档
const TOOL_TIER = {
  list_dir: 'read', read_file: 'read', use_skill: 'read', skill_ls: 'read', skill_read: 'read',
  proj_ls: 'read', proj_read: 'read', tag_list: 'read',
  open_path: 'normal', open_url: 'normal', skill_write: 'normal', skill_rm: 'normal', proj_rm: 'normal', proj_open: 'normal', proj_run: 'normal', proj_write: 'normal',
  tag_set: 'normal', tag_rm: 'normal',
  web_open: 'web', web_click: 'web', web_type: 'web', web_read: 'web',
  screen_shot: 'full', screen_look: 'full',
  click: 'full', rclick: 'full', dclick: 'full', move: 'full', drag: 'full', scroll: 'full', type: 'full', key: 'full',
  game_start: 'full', game_stop: 'read', game_status: 'read',
};
const RANK = { off: 0, read: 1, normal: 2, web: 3, full: 4 };

function allowed(tier, tool) {
  // 停手和查状态永远允许：万一权限被调低，也得能让她把游戏助手停下来
  if (tool === 'game_stop' || tool === 'game_status') return true;
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
  /* 关键：整条链路（提示词、input.norm）都约定坐标空间是 1280x720，
     而回退路径原来返回的是物理分辨率（1920x1080 / 2560x1440）→ 模型按图上的像素报坐标
     会被 norm() 静默钳到屏幕右下角，点错位置还回"✅ 已点击"。
     这里直接缩放到 1280x720，让两条路径的坐标空间完全一致。 */
  const png = src.thumbnail.resize({ width: 1280, height: 720 }).toPNG();

  const p = path.join(shotsDir(), 'screen-' + Date.now() + '.png');
  fs.writeFileSync(p, png);
  return { path: p, width: 1280, height: 720, dataUrl: 'data:image/png;base64,' + png.toString('base64') };
}

/* Windows 自带 OCR（离线，支持中英文）。失败返回空串，不影响截图展示。
 *
 * 必须**异步**：以前用 spawnSync，主进程事件循环被整个占住——实测单次 420~570ms，
 * 期间宠物窗和对话窗完全点不动；多步看屏任务会一路卡顿。现在改成 spawn + Promise，
 * 上限仍是 25 秒，但不再阻塞任何东西。 */
function ocr(pngPath) {
  return new Promise((resolve) => {
    const script = path.join(__dirname, '..', 'scripts', 'ocr.ps1');
    let child, done = false, out = '', err = '';
    const fin = (t) => { if (!done) { done = true; resolve(t || ''); } };
    try {
      child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-Path', pngPath],
        { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch { return fin(''); }
    const timer = setTimeout(() => { try { child.kill(); } catch {} fin(''); }, 25000);
    /* 用 StringDecoder 而不是 `out += d`：后者是**逐块隐式 toString('utf8')**，
       一个中文字被切在两次 data 事件之间就会解出 U+FFFD 乱码
       （projects.js 里踩过同一个坑，那边也是这么修的）。
       配合 ocr.ps1 里设的 UTF-8 输出编码，中文才不乱。 */
    const dec = new StringDecoder('utf8');
    child.stdout.on('data', (d) => { if (out.length < 40000) out += dec.write(d); });
    child.stderr.on('data', (d) => { if (err.length < 4000) err += dec.write(d); });
    child.on('error', () => { clearTimeout(timer); fin(''); });
    child.on('close', (code) => {
      clearTimeout(timer);
      /* 以前把 stdout + stderr 直接拼起来返回，于是 powershell 的报错文本会被当成
         "屏幕上识别到的文字"喂给模型（第 89 / 115 行）。现在失败一律当"没识别到"，
         并且把混在 stdout 里的报错行剔掉。 */
      if (code !== 0) {
        if (err.trim()) { try { console.error('[ocr] ' + err.slice(0, 300)); } catch {} }
        return fin('');
      }
      const lines = String(out).split(/\r?\n/).filter((l) =>
        !/^\s*(At line:|\+ |CategoryInfo|FullyQualifiedErrorId|Exception|MethodInvocationException|MissingMethodException)/.test(l));
      fin(lines.join('\n').trim());
    });
  });
}

/* 只读文件开头 n 个字符（用 fd 定位读，不把整个文件读进内存）。
   截断时按字符边界收一下，避免最后半个多字节字符变乱码。 */
function readHead(file, n) {
  const cap = Math.max(100, Number(n) || 3000);
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(cap * 4);            // 按 UTF-8 最坏 4 字节/字符留量
    const got = fs.readSync(fd, buf, 0, buf.length, 0);
    let s = buf.slice(0, got).toString('utf8');
    if (s.length > cap) s = s.slice(0, cap);
    return s + (got >= buf.length ? '\n…（文件很大，只读了开头）' : '');
  } finally {
    try { fs.closeSync(fd); } catch {}
  }
}

async function run(tool, arg) {
  arg = String(arg == null ? '' : arg).trim();
  if (!TOOL_TIER[tool]) throw new Error('未知操作：' + tool);

  if (tool.startsWith('web_')) return web.run(tool, arg);

  if (tool === 'screen_shot') {
    const cap = await captureScreen();
    const text = await ocr(cap.path);
    const result = '🖥 已截取屏幕（' + cap.width + '×' + cap.height + '）\n'
      + (text ? '屏幕上识别到的文字：\n' + text : '（未识别到文字；截图已展示在对话里，你可以自己看）');
    return { text: result, image: cap.dataUrl, path: cap.path, ocr: text };
  }

  if (tool === 'screen_look') {
    /* 分段计时：抓帧 / 视觉 / OCR 各花了多久。
       "看屏幕要 6-7 秒太慢"这种问题，光看总耗时是没法优化的 ——
       实测抓帧热态只要 22ms、视觉 API 约 1.7s，加起来远小于总耗时，
       说明大头在别处。所以把每段都打出来，别猜。 */
    const timing = {};
    const tick = () => Date.now();
    const tCap = tick();
    const cap = await captureScreen();
    timing.captureMs = tick() - tCap;
    const cfg = config.load();
    let text = '';
    let usedVision = false;
    let visionErr = '';
    let action = null;
    if (cfg.visionEnabled) {
      const q = (arg || '看看屏幕') + '\n\n【输出要求】先用一句中文说明你的判断；如果这一步需要操作屏幕，就在回答的最后单独输出一行：ACTION: 工具|参数（坐标基于 1280x720 截图，左上角 0,0；工具可选 click/rclick/dclick/move/drag/scroll/type/key，例如 ACTION: click|640,360）。如果不需要操作就不要写 ACTION 行。';
      try {
        const tV = tick();
        text = await vision.describe(cfg, cap.dataUrl, q, 'low');
        timing.visionMs = tick() - tV;
        usedVision = true;
        const m = text.match(/ACTION\s*[:：]\s*([a-z_]+)\s*\|\s*(.+)/i);
        if (m) {
          const t = m[1].trim().toLowerCase();
          if (TOOL_TIER[t]) action = { tool: t, arg: m[2].trim() };
        }
      } catch (e) {
        /* ⚠️ 这里以前是 `text = ''`，**把视觉失败完全吞掉**：key 过期 / 余额不足 /
         * 网络不通，全都表现成"降级成 OCR"，用户和模型都不知道出了什么事，
         * 还会一直重复调。现在把原因记下来、一并报回去（翻译过的可读版本由 vision.js 给）。 */
        timing.visionMs = tick() - tV;
        visionErr = String((e && e.message) || e);
        text = '';
      }
    }
    if (!text) {
      const tO = tick();
      const t = await ocr(cap.path);
      timing.ocrMs = tick() - tO;
      text = t ? ('屏幕上识别到的文字：\n' + t) : '（未识别到文字）';
      if (visionErr) text += '\n\n⚠️ 视觉模型调用失败，已降级为 OCR：' + visionErr;
      else if (!cfg.visionEnabled) text += '\n\n（config.json 里 visionEnabled 是关的，所以没走视觉模型）';
    }
    return {
      text: (usedVision ? '👁 视觉模型：\n' : '🖥 屏幕文字：\n') + text,
      image: cap.dataUrl, path: cap.path, action, visionErr, timing,
    };
  }

  // 这几个允许空参数（列根目录 / 停手 / 查状态），其它需要参数的工具才拦
  const NOARG = { skill_ls: 1, proj_ls: 1, game_stop: 1, game_status: 1, screen_shot: 1, web_read: 1 };
  if (!arg && !NOARG[tool]) throw new Error('操作参数为空');
  if (tool === 'open_url') {
    if (!/^https?:\/\//i.test(arg)) throw new Error('网址需以 http(s):// 开头');
    await shell.openExternal(arg);
    return `✅ 已打开网页：${arg}`;
  }
  if (tool === 'open_path') {
    /* 注意：这里用系统默认处理器打开，**等于能运行任意程序**（.exe/.bat/.vbs/.hta 都会被执行），
       normal 档就能用。proj_run 的"解释器白名单"只约束 proj_run，不代表这一档只能跑白名单内的东西。 */
    const err = await shell.openPath(arg);
    if (err) throw new Error(err);
    return `✅ 已打开：${arg}`;
  }
  if (tool === 'list_dir') {
    const items = fs.readdirSync(arg).slice(0, 80);
    return `📂 ${arg}（${items.length} 项）：\n${items.join('\n')}`;
  }
  if (tool === 'read_file') {
    /* 只读前 3000 字。以前是 readFileSync 整读再 slice——模型给个大文件路径
       （C:\Windows\Logs\CBS\CBS.log、视频、hiberfil.sys）主进程就同步卡死+内存暴涨，
       而且 read 档就能调用，用户很容易点"允许"。 */
    const text = readHead(arg, 3000);
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
  /* 项目文件写入。
   * 为什么必须单独开一个工具：以前项目文件**只能**靠回复里的 <<<WRITE: 路径 …>>> 块创建，
   * 而那个语法只写在"首轮系统提示词"里 —— 多步任务续跑用的是精简提示词（buildContinuePrompt），
   * 里面完全没提 WRITE 块。于是续跑阶段她手上**唯一像写入的工具就是 skill_write**：
   * 实测她把算乘法的 `calc/mul.py` 写进了**技能文件夹**，还返回"已写入技能文件"一路成功、
   * 不报任何错 —— 属于"看着正常其实写错地方"。补上 proj_write 后续跑阶段也有正确落盘方式。 */
  if (tool === 'proj_write') {
    const s = String(arg || '');
    const i = s.indexOf('||');
    if (i < 0) throw new Error('格式：proj_write|子路径/文件.py||文件内容');
    const rel = s.slice(0, i).trim();
    const content = s.slice(i + 2).replace(/\\n/g, '\n');   // ACTION 只能一行，允许用 \n 写换行
    const r = projects.writeOne(rel, content);
    return '💾 已写入项目文件：' + r.path + '（' + r.bytes + ' 字节）';
  }

  /* ---------------- 人格词条（她自己的"人格词典"，也是将来换立绘的 key） ---------------- */
  if (tool === 'tag_list') {
    return '🏷 当前人格词条表（tier1 核心人格 = 立绘 key）：\n' + personatags.vocabulary();
  }
  if (tool === 'tag_set') {
    const s = String(arg || '');
    const i = s.indexOf('{');
    if (i < 0) throw new Error('格式：tag_set|{"id":"yandere","label":"病娇","tier":1,"moodDir":1,"words":["病娇","偏执"]}');
    let o;
    try { o = JSON.parse(s.slice(i)); } catch { throw new Error('JSON 解析失败（检查引号、逗号、不要换行）'); }
    const r = personatags.setTag(o);
    if (!r.ok) throw new Error(r.error);
    return '🏷 已' + (r.action === 'added' ? '新增' : '更新') + '词条「' + r.tag.label + '」(' + r.tag.id
      + '，tier' + r.tag.tier + '，词：' + r.tag.words.join('/') + ')，词条表共 ' + r.total + ' 条。'
      + (r.tag.tier === 1 ? '（tier1 = 核心人格，会影响立绘与行为方向）' : '');
  }
  if (tool === 'tag_rm') {
    const r = personatags.removeTag(arg);
    if (!r.ok) throw new Error(r.error);
    return '🗑 已删除词条「' + r.removed.label + '」(' + r.removed.id + ')，词表剩 ' + r.total + ' 条。';
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
  if (tool === 'proj_run') {
    const cfgR = config.load();
    const r = await projects.run(arg || '', (cfgR.memory || {}).projRunTimeout || 60000);
    const head = r.timeout
      ? '⏱ 运行超时被强制结束（' + Math.round(r.ms / 1000) + 's）'
      : (r.code === 0 ? '✅ 运行成功（' + Math.round(r.ms / 1000) + 's，退出码 0）' : '❌ 运行出错（退出码 ' + r.code + '，' + Math.round(r.ms / 1000) + 's）');
    return head + '：' + r.path + '\n--- 输出 ---\n' + r.output;
  }

  /* ---------------- 游戏助手（默认关闭，用户开口才启动） ----------------
     懒加载：gameagent 自己依赖 assistant，放在函数里 require 避免循环依赖。 */
  if (tool === 'game_start' || tool === 'game_stop' || tool === 'game_status') {
    const game = require('./gameagent');
    if (tool === 'game_status') {
      const s = game.status();
      if (!s.running) return '🎮 游戏助手（替你打游戏的那个循环）现在**没有在运行**。\n'
        + '注意：这只表示"我没在帮打"，**不代表游戏本身开没开** —— 游戏开没开要看屏幕（用 screen_look 或 screen_shot）。';
      return '🎮 正在打：第 ' + s.step + ' / ' + s.maxSteps + ' 步，已操作 ' + (s.tally.act || 0) + ' 次'
        + '（成功 ' + (s.tally.ok || 0) + ' / 失败 ' + (s.tally.fail || 0) + '）\n任务：' + s.task;
    }
    if (tool === 'game_stop') {
      const r = game.stop();
      return r.already
        ? '🎮 游戏助手本来就没在运行，不用停（这不代表游戏没开着）。'
        : '🛑 已经让她停手了，正在收尾（一两秒内就完全停下）。';
    }
    const s = String(arg || '');
    const i = s.indexOf('||');
    const task = (i >= 0 ? s.slice(0, i) : s).trim();
    const maxSteps = i >= 0 ? (Number(s.slice(i + 2)) || 0) : 0;
    const r = await game.start({ task, maxSteps: maxSteps || undefined });
    if (!r || !r.ok) throw new Error((r && r.error) || '启动失败');
    return '🎮 已经开打了，她在持续盯屏操作，每一步都会汇报到对话里。\n任务：' + task.slice(0, 120)
      + '\n（**不需要再调 game_start**：现在只要用正常格式跟主人说一声你已经上手了、想停就说「停」。用户说停的时候再调 game_stop。）';
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
