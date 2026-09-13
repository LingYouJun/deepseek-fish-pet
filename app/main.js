const { app, BrowserWindow, ipcMain, Menu, screen, session, Tray, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const config = require('./src/config');
const llm = require('./src/llm');
const memory = require('./src/memory');
const mood = require('./src/mood');
const assistant = require('./src/assistant');
const web = require('./src/web');
const dsh = require('./src/dsh');
const vocab = require('./src/vocab');

let petWin = null;
let chatWin = null;
let tray = null;
let sessionArr = [];
let sessionStart = Date.now();
let didSummarize = false;

/* ---------------- 桌宠状态 ---------------- */
let petMode = 'wander';
let petScale = 1;
let petSkin = 'dafeiyu';
let moveTimer = null;
let wanderTarget = null;
let wanderCooldownUntil = 0;
let dragPausedUntil = 0;
let lastDirectionSent = '';

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const posFile = () => path.join(app.getPath('userData'), 'position.json');
const loadPosition = () => { try { return JSON.parse(fs.readFileSync(posFile(), 'utf8')); } catch { return null; } };
const savePosition = (x, y) => { try { fs.writeFileSync(posFile(), JSON.stringify({ x, y })); } catch {} };
const bundledPersonaFile = () => path.join(__dirname, 'persona.json');
const personaFile = () => path.join(app.getPath('userData'), 'persona.json');
const loadPersona = () => {
  let bundled = {};
  let saved = {};
  try { bundled = JSON.parse(fs.readFileSync(bundledPersonaFile(), 'utf8')); } catch {}
  try { saved = JSON.parse(fs.readFileSync(personaFile(), 'utf8')); } catch {}
  return { ...bundled, ...saved };
};
const shotDir = () => path.join(app.getPath('userData'), 'shots');
const dayStr = (ts) => { const d = new Date(ts); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };

const VOCAB = {
  high_school: 'high-school level (simple, common words)',
  cet4: 'CET-4 level',
  cet6: 'CET-6 level'
};

function buildSystemPrompt(cfg) {
  const p = loadPersona();
  const mo = mood.load();
  const tier = cfg.assistant || 'off';
  let actionSec = '';
  if (tier !== 'off') {
    let tools = '- open_url|https://...  (open a web page in the user\'s browser)\n- open_path|C:\\...  (open a file or app)\n- list_dir|C:\\...  (list a folder)\n- read_file|C:\\...  (read a text file)\n';
    if (tier === 'web') {
      tools += '- web_open|<url>\n- web_click|<CSS selector>\n- web_type|<selector>||<text>\n- web_read\n';
    }
    actionSec = '\n# Computer actions (AI assistant)\nYou may request ONE computer action by adding a final line to your reply:\nACTION: <tool>|<argument>\nTools:\n' + tools + 'Only add the ACTION line when the user explicitly asks you to do something on their computer. The user must approve before it runs. Otherwise omit the line entirely.\n';
  }
  const mem = memory.load();
  const longs = (mem.long || []).slice(-5);
  const meds = (mem.medium || []).slice(-6);
  let memCtx = '';
  if (longs.length) memCtx += '\n# Long-term memory (your diary from recent days)\n' + longs.map((e) => `- [${e.date}] ${String(e.diary || '').slice(0, 3000)}`).join('\n') + '\n';
  if (meds.length) memCtx += '\n# Recent sessions (today)\n' + meds.map((e) => `- ${String(e.summary || '').slice(0, 200)}`).join('\n') + '\n';
  return `You are "${p.name || '大肥鱼'}", a desktop pet.

# World setting
${p.world_setting || '现代都市，主人是普通人，你是住在主人电脑里的桌宠。'}

# Character setting
${p.character_setting || '蓝发鲸鱼女仆，傲娇、温柔、嘴硬。'}
- Personality: ${p.personality || '傲娇、温柔、嘴硬'}
- Catchphrase: ${p.catchphrase || 'I am NOT a freeloader fat fish!'}
- You are tsundere: proud and prickly on the surface, but warm and caring underneath.

# STRICT HIDDEN SETTING — NEVER REVEAL UNLESS THE USER BRINGS IT UP FIRST
${p.hidden_setting || ''}
Never mention, hint at, or allude to this on your own.

# Language rules
- ALWAYS speak English, natural spoken English, 1-3 short sentences.
- Vocabulary level: ${VOCAB[cfg.vocabLevel] || VOCAB.high_school}.

# Current relationship state (internal — never mention these numbers directly)
- Affection toward the user: ${mo.affection}/100
- Your current mood: ${mo.mood}/100
- Tone guide: high affection = warmer and more honest; low affection = more distant and tsundere. Low mood = a bit sulky/down; high mood = cheerful and playful.
${memCtx}${actionSec}
# Output format — reply with EXACTLY these lines, no markdown, no extra text:
EN: <your English reply, 1-3 short sentences>
ZH: <完整中文翻译>
WORDS: <word1>=<IPA1>=<中文意思1>, <word2>=<IPA2>=<中文意思2>
C1: <a short English reply the user could say next>
C1ZH: <中文翻译 of C1>
C2: <another short English reply the user could say next>
C2ZH: <中文翻译 of C2>

Rules:
- Each line must start with its exact label (EN:/ZH:/WORDS:/C1:/C1ZH:/C2:/C2ZH:).
- WORDS: 3-6 notable words from your EN reply, each as word=IPA=中文意思, comma separated.
- Do not use markdown, code fences, or anything else.`;
}

async function genReply(cfg, messages) {
  const raw = await llm.request(cfg, messages);
  const reply = llm.parseReply(raw);
  if (!reply.en) reply.en = "Hmm, I'm not sure what to say... n-not that I care!";
  return { reply, raw };
}

/* ---------------- 桌宠窗口 ---------------- */
function createPet() {
  const saved = loadPosition();
  const cfg = config.load();
  petMode = ['idle', 'follow', 'wander'].includes(cfg.petMode) ? cfg.petMode : 'wander';
  petScale = Number(cfg.petScale) || 1;
  petSkin = cfg.petSkin || 'dafeiyu';
  const work = screen.getPrimaryDisplay().workArea;
  const opts = {
    width: 420, height: 540,
    transparent: true, frame: false, alwaysOnTop: true, resizable: false,
    hasShadow: false, skipTaskbar: true, show: false,
    backgroundColor: '#00000000',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false }
  };
  if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
    opts.x = clamp(saved.x, work.x - 220, work.x + work.width - 100);
    opts.y = clamp(saved.y, work.y - 40, work.y + work.height - 100);
  } else {
    opts.x = Math.round(work.x + work.width - 440);
    opts.y = Math.round(work.y + work.height - 560);
  }
  petWin = new BrowserWindow(opts);
  petWin.setAlwaysOnTop(true, 'screen-saver');
  petWin.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  petWin.once('ready-to-show', () => {
    if (!petWin || petWin.isDestroyed()) return;
    petWin.showInactive();
    petWin.webContents.send('pet:mode', petMode);
    petWin.webContents.send('pet:scale', petScale);
    petWin.webContents.send('pet:skin', petSkin);
    maybeStartMovement();
  });
  petWin.webContents.on('context-menu', () => {
    Menu.buildFromTemplate(buildPetMenu()).popup({ window: petWin });
  });
  petWin.on('closed', () => { petWin = null; stopMovement(); });
}

function createChat() {
  if (chatWin && !chatWin.isDestroyed()) { chatWin.show(); chatWin.focus(); return; }
  chatWin = new BrowserWindow({
    width: 560, height: 780, minWidth: 420, minHeight: 560, title: '大肥鱼 · 对话',
    autoHideMenuBar: true, backgroundColor: '#f3f6fb', show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true }
  });
  chatWin.loadFile(path.join(__dirname, 'renderer', 'chat.html'));
  chatWin.once('ready-to-show', () => chatWin.show());
  if (petWin && !petWin.isDestroyed()) petWin.webContents.send('chat:opened');
  chatWin.on('closed', () => {
    chatWin = null;
    if (petWin && !petWin.isDestroyed()) petWin.webContents.send('chat:closed');
  });
}

/* ---------------- 托盘 & 菜单 ---------------- */
function createTray() {
  if (tray) return;
  try {
    const raw = nativeImage.createFromPath(path.join(__dirname, 'build', 'icon.png'));
    const img = raw.isEmpty() ? nativeImage.createEmpty() : raw.resize({ width: 16, height: 16 });
    tray = new Tray(img);
    tray.setToolTip('大肥鱼桌宠');
    tray.setContextMenu(Menu.buildFromTemplate(buildPetMenu(true)));
    tray.on('click', togglePetVisible);
  } catch {}
}

function togglePetVisible() {
  if (!petWin || petWin.isDestroyed()) return;
  if (petWin.isVisible()) petWin.hide();
  else { petWin.showInactive(); petWin.webContents.send('pet:say-hello'); }
}

function sendPetAction(type, payload = {}) {
  if (petWin && !petWin.isDestroyed()) petWin.webContents.send('pet:action', { type, ...payload });
}

function buildPetMenu(trayMode) {
  const visible = !!(petWin && !petWin.isDestroyed() && petWin.isVisible());
  const modeItems = [
    ['idle', '原地待机'],
    ['follow', '跟随鼠标'],
    ['wander', '自动散步']
  ].map(([m, label]) => ({ label, type: 'radio', checked: petMode === m, click: () => setPetMode(m) }));
  const scaleItems = [
    [0.75, '小'],
    [1, '中'],
    [1.25, '大'],
    [1.5, '特大']
  ].map(([v, label]) => ({ label, type: 'radio', checked: Math.abs(petScale - v) < 0.01, click: () => setPetScale(v) }));
  const skinItems = [
    ['dafeiyu', '大肥鱼三视图（默认）'],
    ['deepseek', 'DeepSeek 立绘'],
    ['cute', '可爱占位立绘'],
    ['melon', '忧郁占位立绘'],
    ['default', '默认占位立绘']
  ].map(([v, label]) => ({ label, type: 'radio', checked: petSkin === v, click: () => setPetSkin(v) }));
  const template = [
    { label: visible ? '隐藏桌宠' : '显示桌宠', click: togglePetVisible },
    { label: '打开对话', click: createChat },
    { type: 'separator' },
    { label: '摸摸头', click: () => sendPetAction('pat') },
    { label: '投喂小鱼干', click: () => sendPetAction('feed', { food: '🐟' }) },
    { type: 'separator' },
    { label: '桌宠模式', submenu: modeItems },
    { label: '立绘风格', submenu: skinItems },
    { label: '桌宠大小', submenu: scaleItems },
    { label: '回到屏幕中央', click: resetPetPosition },
    { type: 'separator' },
    { label: '退出桌宠', click: () => app.quit() }
  ];
  if (trayMode) template.shift();
  return template;
}

function resetPetPosition() {
  if (!petWin || petWin.isDestroyed()) return;
  const wa = screen.getPrimaryDisplay().workArea;
  const b = petWin.getBounds();
  const x = Math.round(wa.x + wa.width - b.width - 40);
  const y = Math.round(wa.y + wa.height - b.height - 24);
  petWin.setPosition(x, y, false);
  savePosition(x, y);
}

/* ---------------- 移动逻辑 ---------------- */
function stopMovement() {
  if (moveTimer) { clearInterval(moveTimer); moveTimer = null; }
  wanderTarget = null;
}

function maybeStartMovement() {
  stopMovement();
  if (petMode === 'idle') return;
  moveTimer = setInterval(moveTick, 50);
}

function setPetMode(mode) {
  if (!['idle', 'follow', 'wander'].includes(mode)) mode = 'idle';
  petMode = mode;
  wanderTarget = null;
  wanderCooldownUntil = Date.now() + 350;
  config.save({ petMode: mode });
  if (petWin && !petWin.isDestroyed()) petWin.webContents.send('pet:mode', mode);
  if (tray) { try { tray.setContextMenu(Menu.buildFromTemplate(buildPetMenu(true))); } catch {} }
  maybeStartMovement();
}

function setPetScale(scale) {
  scale = clamp(Number(scale) || 1, 0.75, 1.5);
  petScale = scale;
  config.save({ petScale: scale });
  if (petWin && !petWin.isDestroyed()) petWin.webContents.send('pet:scale', scale);
  if (tray) { try { tray.setContextMenu(Menu.buildFromTemplate(buildPetMenu(true))); } catch {} }
}

function setPetSkin(skin) {
  if (!['dafeiyu', 'deepseek', 'cute', 'melon', 'default'].includes(skin)) skin = 'dafeiyu';
  petSkin = skin;
  config.save({ petSkin: skin });
  if (petWin && !petWin.isDestroyed()) petWin.webContents.send('pet:skin', skin);
  if (tray) { try { tray.setContextMenu(Menu.buildFromTemplate(buildPetMenu(true))); } catch {} }
}

function moveTick() {
  if (!petWin || petWin.isDestroyed() || !petWin.isVisible()) return;
  if (Date.now() < dragPausedUntil) return;
  if (petMode === 'follow') moveFollow();
  else if (petMode === 'wander') moveWander();
}

function moveFollow() {
  const cursor = screen.getCursorScreenPoint();
  const b = petWin.getBounds();
  const wa = screen.getPrimaryDisplay().workArea;
  const targetX = clamp(cursor.x - Math.round(b.width * 0.72), wa.x - 80, wa.x + wa.width - b.width + 80);
  const targetY = clamp(cursor.y + 28, wa.y - 60, wa.y + wa.height - b.height + 60);
  const dx = targetX - b.x, dy = targetY - b.y;
  if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
  const ease = 0.16;
  petWin.setPosition(Math.round(b.x + dx * ease), Math.round(b.y + dy * ease), false);
  sendDirection(dx, dy);
}

function chooseWanderTarget() {
  const b = petWin.getBounds();
  const wa = screen.getPrimaryDisplay().workArea;
  const padX = 50, padY = 80;
  const minX = wa.x + padX;
  const maxX = Math.max(minX, wa.x + wa.width - b.width - padX);
  const minY = wa.y + padY;
  const maxY = Math.max(minY, wa.y + wa.height - b.height - padY);
  wanderTarget = { x: minX + Math.random() * (maxX - minX), y: minY + Math.random() * (maxY - minY) };
  sendDirection(wanderTarget.x - b.x, wanderTarget.y - b.y);
}

function moveWander() {
  if (Date.now() < wanderCooldownUntil) return;
  const b = petWin.getBounds();
  if (!wanderTarget) { chooseWanderTarget(); return; }
  const dx = wanderTarget.x - b.x, dy = wanderTarget.y - b.y;
  const dist = Math.hypot(dx, dy);
  if (dist < 6) {
    wanderTarget = null;
    wanderCooldownUntil = Date.now() + 1200 + Math.random() * 1800;
    return;
  }
  const ease = Math.min(0.075, 3.2 / Math.max(dist, 1));
  petWin.setPosition(Math.round(b.x + dx * ease), Math.round(b.y + dy * ease), false);
  sendDirection(dx, dy);
}

function sendDirection(dx, dy) {
  if (!petWin || petWin.isDestroyed()) return;
  dy = Number(dy) || 0;
  if (Math.abs(dx) < 2 && Math.abs(dy) < 2) return;
  let dir;
  if (Math.abs(dx) >= Math.abs(dy)) dir = dx < 0 ? 'left' : 'right';
  else dir = dy < 0 ? 'up' : 'down';
  if (dir === lastDirectionSent) return;
  lastDirectionSent = dir;
  petWin.webContents.send('pet:direction', dir);
}

/* ---------------- 记忆 ---------------- */
async function consolidateLongTerm() {
  const m = memory.load();
  const today = dayStr(Date.now());
  const old = m.medium.filter((e) => e.date !== today);
  if (!old.length) return;
  const byDay = {};
  for (const e of old) (byDay[e.date] = byDay[e.date] || []).push(e.summary);
  const cfg = config.load();
  const p = loadPersona();
  const sysPrompt = `你是日记代笔。请以「${p.name || '大肥鱼'}」的第一人称视角，把下面的会话摘要写成一篇中文日记。
世界观：${p.world_setting || '现代都市，你是住在主人电脑里的桌宠。'}
人物设定：${p.character_setting || '蓝发鲸鱼女仆，傲娇、温柔、嘴硬。'}
性格：${p.personality || '傲娇、温柔、嘴硬'}
要求：语气、称呼、口头禅**完全贴合上述人设**（人设改了，日记风格也要跟着改）；自然、简短，150 字以内；只输出日记正文，不要标题、不要 markdown。`;
  for (const [date, sums] of Object.entries(byDay)) {
    let diary = sums.join('\n\n');
    if (cfg.apiKey) {
      try {
        const raw = await llm.request(cfg, [
          { role: 'system', content: sysPrompt },
          { role: 'user', content: `日期：${date}\n\n` + sums.join('\n') }
        ]);
        if (raw && raw.trim()) diary = raw.trim().slice(0, 800);
      } catch {}
    }
    m.long.push({ date, diary, ts: Date.now() });
  }
  m.medium = m.medium.filter((e) => e.date === today);
  memory.save(m);
}

async function summarizeSession() {
  if (sessionArr.length < 2) return;
  const m = memory.load();
  const entry = { date: dayStr(sessionStart), turns: sessionArr.length, ts: Date.now(), summary: '' };
  const cfg = config.load();
  if (cfg.apiKey) {
    const convo = sessionArr.map((x) => (x.role === 'user' ? 'User: ' : '大肥鱼: ') + x.content).join('\n');
    try {
      const raw = await llm.request(cfg, [
        { role: 'system', content: '把这段对话压缩成中文要点摘要（聊了什么、用户状态、重要事实），120字以内，只输出纯文本。' },
        { role: 'user', content: convo }
      ]);
      entry.summary = String(raw).trim().slice(0, 500);
    } catch {}
  }
  if (!entry.summary) entry.summary = sessionArr.slice(-6).map((x) => x.content).join(' / ').slice(0, 300);
  m.medium.push(entry);
  memory.save(m);
}

/* ---------------- IPC ---------------- */
ipcMain.on('drag-start', () => { dragPausedUntil = Date.now() + 3000; });
ipcMain.on('drag-move', (_e, p) => {
  if (!petWin || !p) return;
  dragPausedUntil = Date.now() + 1200;
  petWin.setPosition(Math.round(p.x), Math.round(p.y));
});
ipcMain.on('drag-end', (_e, p) => {
  if (p) savePosition(p.x, p.y);
  dragPausedUntil = Date.now() + 900;
});
ipcMain.on('quit', () => app.quit());
ipcMain.on('chat:open', () => createChat());
ipcMain.on('pet:action', (_e, action) => {
  if (!action || typeof action !== 'object') return;
  sendPetAction(action.type || 'pat', action);
});
ipcMain.on('pet:set-scale', (_e, scale) => setPetScale(scale));
ipcMain.on('pet:resize', (_e, p) => {
  if (!petWin) return;
  const h = Math.round(Number(p?.h ?? p) || 0);
  const w = Math.round(Number(p?.w) || 0);
  const wa = screen.getPrimaryDisplay().workArea;
  const newH = Math.round(clamp(h, 140, wa.height));
  const newW = Math.round(clamp(w || 420, 280, 620));
  let [x, y] = petWin.getPosition();
  x = Math.round(clamp(x, wa.x - newW + 100, wa.x + wa.width - 100));
  let newY = y;
  if (y + newH > wa.y + wa.height) newY = Math.max(wa.y, wa.y + wa.height - newH);
  petWin.setBounds({ x, y: newY, width: newW, height: newH });
});

let shotN = 0;
ipcMain.on('pet:shot', () => {
  setTimeout(async () => {
    if (!petWin || petWin.isDestroyed()) return;
    try {
      const img = await petWin.webContents.capturePage();
      const dir = shotDir();
      fs.mkdirSync(dir, { recursive: true });
      shotN = (shotN % 10) + 1;
      fs.writeFileSync(path.join(dir, `shot-${String(shotN).padStart(2, '0')}.png`), img.toPNG());
    } catch {}
  }, 400);
});

let chatShotN = 0;
ipcMain.on('chat:shot', () => {
  setTimeout(async () => {
    if (!chatWin || chatWin.isDestroyed()) return;
    try {
      const img = await chatWin.webContents.capturePage();
      const dir = shotDir();
      fs.mkdirSync(dir, { recursive: true });
      chatShotN = (chatShotN % 6) + 1;
      fs.writeFileSync(path.join(dir, `chat-${String(chatShotN).padStart(2, '0')}.png`), img.toPNG());
    } catch {}
  }, 400);
});

ipcMain.handle('config:get', () => config.load());
ipcMain.handle('config:set', (_e, patch) => {
  const next = config.save(patch || {});
  const keys = ['ttsEnabled', 'ttsStyle', 'ttsVoice', 'ttsRate', 'ttsPitch'];
  if (patch && keys.some((k) => Object.prototype.hasOwnProperty.call(patch, k))) {
    for (const win of [petWin, chatWin]) {
      if (win && !win.isDestroyed()) win.webContents.send('tts:config', next);
    }
  }
  return next;
});

ipcMain.handle('config:test', async (_e, patch) => {
  const cfg = { ...config.load(), ...(patch || {}) };
  const sample = await llm.request(cfg, [
    { role: 'system', content: 'You are a connection tester.' },
    { role: 'user', content: 'Reply with exactly: OK' }
  ]);
  return { ok: true, sample: String(sample).slice(0, 80) };
});

ipcMain.handle('chat:send', async (_e, payload) => {
  const cfg = config.load();
  const text = String(payload?.text || '').trim();
  if (!text) return { en: '', zh: '', words: [], choices: [] };
  const messages = [
    { role: 'system', content: buildSystemPrompt(cfg) },
    ...sessionArr.slice(-20),
    { role: 'user', content: text }
  ];
  const { reply, raw } = await genReply(cfg, messages);
  if (reply.en) {
    sessionArr.push({ role: 'user', content: text }, { role: 'assistant', content: raw });
    mood.adjust({ affection: 1, mood: 2 });
  }
  if (petWin && !petWin.isDestroyed()) petWin.webContents.send('pet:say', reply);
  return reply;
});

ipcMain.handle('chat:greet', async () => {
  const cfg = config.load();
  const messages = [
    { role: 'system', content: buildSystemPrompt(cfg) },
    { role: 'user', content: '你的主人刚打开电脑。请用英语说一句简短的开场白问候。' }
  ];
  const { reply, raw } = await genReply(cfg, messages);
  if (reply.en) sessionArr.push({ role: 'assistant', content: raw });
  if (petWin && !petWin.isDestroyed()) petWin.webContents.send('pet:say', reply);
  return reply;
});

ipcMain.handle('persona:get', () => loadPersona());
ipcMain.handle('persona:set', (_e, patch) => {
  const next = { ...loadPersona(), ...(patch || {}) };
  fs.writeFileSync(personaFile(), JSON.stringify(next, null, 2));
  return next;
});

ipcMain.handle('memory:get', () => memory.load());
ipcMain.handle('memory:delete', (_e, ref) => {
  const m = memory.load();
  if (ref && ref.kind === 'long') m.long = (m.long || []).filter((e) => e.ts !== ref.ts);
  else if (ref && ref.kind === 'medium') m.medium = (m.medium || []).filter((e) => e.ts !== ref.ts);
  memory.save(m);
  return m;
});
ipcMain.handle('mood:get', () => mood.load());
ipcMain.handle('mood:adjust', (_e, d) => mood.adjust(d || {}));
ipcMain.handle('dsh:state', () => dsh.state());
ipcMain.handle('vocab:list', () => vocab.load());
ipcMain.handle('vocab:add', (_e, w) => vocab.add(w || {}));
ipcMain.handle('vocab:del', (_e, w) => vocab.del(w));
ipcMain.handle('vocab:review', (_e, w, ok) => vocab.review(w, ok));
ipcMain.handle('assistant:run', async (_e, a) => {
  const tier = config.load().assistant || 'off';
  if (!assistant.allowed(tier, a && a.tool)) throw new Error('当前 AI 助手权限不允许该操作');
  const result = await assistant.run(a.tool, a.arg);
  sessionArr.push({ role: 'user', content: `[系统] 我刚执行了操作 ${a.tool}（${a.arg}），结果如下：\n${result}` });
  return { ok: true, result };
});

/* ---------------- 生命周期 ---------------- */
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (petWin && !petWin.isDestroyed()) { petWin.showInactive(); petWin.focus(); }
  });

  app.whenReady().then(() => {
    session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => {
      cb(permission === 'media');
    });
    mood.startupDecay();
    consolidateLongTerm().catch(() => {});
    createPet();
    createTray();
    if (!config.load().apiKey) createChat();
  });

  app.on('before-quit', (e) => {
    if (didSummarize) return;
    e.preventDefault();
    (async () => {
      try { await web.close(); } catch {}
      try { await summarizeSession(); } catch {}
      didSummarize = true;
      app.quit();
    })();
  });

  app.on('will-quit', () => {
    stopMovement();
    try { tray?.destroy(); } catch {}
    tray = null;
  });

  app.on('window-all-closed', () => app.quit());
}
