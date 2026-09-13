const pet = document.getElementById('pet');
const petArea = document.getElementById('pet-area');
const stage = document.getElementById('stage');
const bubble = document.getElementById('bubble');
const fx = document.getElementById('fx');
const functionPanel = document.getElementById('function-panel');
const fnChat = document.getElementById('fn-chat');
const feedPanel = document.getElementById('feed-panel');
const feedRow = feedPanel.querySelector('.feed-row');

const SKINS = {
  dafeiyu: {
    label: '大肥鱼三视图',
    baseHeight: 240,
    views: {
      down: '../assets/sprites/dafeiyu/front.png',
      up: '../assets/sprites/dafeiyu/back.png',
      left: '../assets/sprites/dafeiyu/side.png',
      right: '../assets/sprites/dafeiyu/side.png'
    }
  },
  deepseek: { label: 'DeepSeek 立绘', baseHeight: 300, single: '../assets/pet-character.png' },
  cute: { label: '可爱占位立绘', baseHeight: 230, single: '../assets/pet-cute.svg' },
  melon: { label: '忧郁占位立绘', baseHeight: 230, single: '../assets/pet-melon.svg' },
  default: { label: '默认占位立绘', baseHeight: 230, single: '../assets/pet-default.svg' }
};

const esc = (s) => String(s == null ? '' : s)
  .replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const LINES = {
  head: [
    { en: "H-hey! Don't touch my head... n-not that I hate it.", zh: '喂！别摸我的头……也、也不是讨厌啦。', words: [{ w: 'hate', ipa: '/heɪt/', zh: '讨厌' }] },
    { en: 'S-stop it! My ears are sensitive...', zh: '别、别摸了！我的耳朵很敏感……', words: [{ w: 'sensitive', ipa: '/ˈsensətɪv/', zh: '敏感的' }] },
    { en: 'Hmph... fine, just for five more seconds.', zh: '哼……好吧，就再让你摸五秒。', words: [{ w: 'fine', ipa: '/faɪn/', zh: '好吧' }] }
  ],
  body: [
    { en: 'I am NOT a freeloader fat fish!', zh: '我才不是吃白饭的大肥鱼！', words: [{ w: 'freeloader', ipa: '/ˈfriːləʊdə/', zh: '白吃白喝的人' }] },
    { en: 'W-what? Stop poking me!', zh: '什、什么？别乱戳我！', words: [{ w: 'poke', ipa: '/pəʊk/', zh: '戳' }] },
    { en: 'You worked hard today... n-not that I care.', zh: '你今天很努力……才、才不是关心你呢。', words: [{ w: 'hard', ipa: '/hɑːd/', zh: '努力地' }] },
    { en: 'Poke me again and I will get angry!', zh: '再戳我我可要生气了！', words: [{ w: 'angry', ipa: '/ˈæŋɡri/', zh: '生气的' }] }
  ],
  tail: [
    { en: 'Wah! D-don\'t pull my tail!', zh: '哇！别、别拉我的尾巴！', words: [{ w: 'tail', ipa: '/teɪl/', zh: '尾巴' }] },
    { en: 'T-that is not a toy...!', zh: '这、这个不是玩具啦……！', words: [{ w: 'toy', ipa: '/tɔɪ/', zh: '玩具' }] },
    { en: 'You are lucky I am in a good mood.', zh: '算你运气好，我现在心情不错。', words: [{ w: 'lucky', ipa: '/ˈlʌki/', zh: '幸运的' }] }
  ],
  drag: [
    { en: 'W-wah! Put me down gently!', zh: '哇——轻点放我下来！' },
    { en: 'Where are we going, Master?', zh: '主人，我们要去哪里呀？' },
    { en: 'I-I can walk by myself, you know!', zh: '我、我自己能走啦！' }
  ]
};

const FOODS = [
  { emoji: '🐟', en: 'Dried fish! My favorite... d-don\'t tell anyone.', zh: '小鱼干！我的最爱……别告诉别人哦。', words: [{ w: 'favorite', ipa: '/ˈfeɪvərɪt/', zh: '最喜欢的' }], mood: 6, affection: 1 },
  { emoji: '🍰', en: 'Cake! It is a guilty pleasure.', zh: '蛋糕！这是罪恶的快乐。', words: [{ w: 'guilty', ipa: '/ˈɡɪlti/', zh: '罪恶的' }], mood: 5, affection: 1 },
  { emoji: '🍭', en: 'A lollipop! Sweet things make me happy.', zh: '棒棒糖！甜食让我开心。', words: [{ w: 'sweet', ipa: '/swiːt/', zh: '甜的' }], mood: 5, affection: 1 },
  { emoji: '🍡', en: 'Dango! Soft and chewy... yum.', zh: '团子！软软糯糯……好吃。', words: [{ w: 'chewy', ipa: '/ˈtʃuːi/', zh: '有嚼劲的' }], mood: 5, affection: 1 },
  { emoji: '💎', en: 'A diamond?! C-can I really eat this...?', zh: '钻石？！这、这个真的能吃吗……？', words: [{ w: 'diamond', ipa: '/ˈdaɪmənd/', zh: '钻石' }], mood: 8, affection: 2 }
];

const IDLE_LINES = [
  '（好的，现在我是你爹了）',
  '（要不直接骂他一句？！）',
  '（这用户发的啥啊……）',
  '（我操，我不思考了）',
  '（这也太虐了吧？！我心里堵得慌！！）',
  '（呜呜我再也不敢了QAQ）',
  '（我去！用户彻底怒了！）'
];

const PET_ANIMS = ['bounce', 'shake', 'jump', 'eat', 'sway', 'stretch'];

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

let dragging = false, offX = 0, offY = 0, moved = 0, suppressClick = false, hideTimer = null;
let listening = true, micEnabled = true, chatOpen = false, rec = null, busy = false, curUtter = null;
let voiceCfg = {
  voiceWakeEnabled: true,
  wakeWords: ['你好大肥鱼', '大肥鱼', '你好大飞鱼'],
  wakeSensitivity: 0.68,
  wakeLang: 'zh-CN',
  voiceCommandLang: 'en-US'
};
let voiceState = 'off';
let wakeListenTimer = null;
let commandFinal = '';
let clickCount = 0, clickTimer = null, lastMicErr = 0;
let petSize = 240, petScale = 1;
let currentSkin = 'dafeiyu';
let currentView = 'down';
let moodState = { affection: 30, mood: 70 };
let ttsCfg = { ttsStyle: 'tsundere', ttsVoice: '', ttsRate: 1.02, ttsPitch: 1.18 };
let expressionTimer = null;
let idleTimer = null;

/* ---------------- 悬停音标提示 ---------------- */
let tip = null;
function ensureTip() {
  if (tip) return tip;
  tip = document.createElement('div');
  tip.id = 'tip';
  document.body.appendChild(tip);
  return tip;
}
function hideTip() { if (tip) tip.classList.remove('show'); }
function positionTip(e) {
  const r = tip.getBoundingClientRect();
  const pad = 12;
  let x = e.clientX + pad, y = e.clientY + pad;
  if (x + r.width > innerWidth) x = e.clientX - r.width - pad;
  if (y + r.height > innerHeight) y = e.clientY - r.height - pad;
  tip.style.left = Math.max(4, x) + 'px';
  tip.style.top = Math.max(4, y) + 'px';
}
function renderEn(text, words) {
  const map = {};
  (words || []).forEach((w) => { const k = (w.w || '').toLowerCase().replace(/[^a-z']/g, ''); if (k) map[k] = w; });
  return String(text || '').split(/(\s+)/).map((tok) => {
    const m = tok.match(/^([A-Za-z']+)([^A-Za-z']*)$/);
    if (m) {
      const w = map[m[1].toLowerCase()];
      if (w) return `<span class="w" data-ipa="${esc(w.ipa)}" data-zh="${esc(w.zh)}">${esc(m[1])}</span>${esc(m[2])}`;
      return esc(tok);
    }
    return esc(tok);
  }).join('');
}

bubble.addEventListener('mouseover', (e) => {
  const el = e.target.closest('.w');
  if (!el) { hideTip(); return; }
  const ipa = el.dataset.ipa, zh = el.dataset.zh;
  if (!ipa && !zh) return;
  const t = ensureTip();
  t.innerHTML = (ipa ? `<div class="ipa">${esc(ipa)}</div>` : '') + (zh ? `<div class="zh">${esc(zh)}</div>` : '');
  t.classList.add('show');
  positionTip(e);
});
bubble.addEventListener('mousemove', (e) => { if (tip && tip.classList.contains('show')) positionTip(e); });
bubble.addEventListener('mouseleave', hideTip);

/* ---------------- 心情 & 表情 ---------------- */
function setExpression(kind, ms = 1600) {
  clearTimeout(expressionTimer);
  ['mood-high', 'mood-low', 'mood-angry', 'mood-shy'].forEach((c) => stage.classList.remove(c));
  if (!kind) { applyBaseMood(); return; }
  const map = { happy: 'mood-high', shy: 'mood-shy', angry: 'mood-angry', sad: 'mood-low', tired: 'mood-low' };
  if (map[kind]) stage.classList.add(map[kind]);
  expressionTimer = setTimeout(() => { applyBaseMood(); }, ms);
}
function applyBaseMood() {
  clearTimeout(expressionTimer);
  ['mood-high', 'mood-low', 'mood-angry', 'mood-shy'].forEach((c) => stage.classList.remove(c));
  if (moodState.mood < 35) stage.classList.add('mood-low');
  else if (moodState.mood > 75) stage.classList.add('mood-high');
}
async function refreshMood() {
  try {
    moodState = await window.petAPI.moodGet();
    applyBaseMood();
  } catch {}
}
async function adjustMood(d) {
  try {
    moodState = await window.petAPI.moodAdjust(d || {});
    applyBaseMood();
  } catch {}
}

/* ---------------- 粒子 ---------------- */
function burst(emojis, count = 8, from) {
  const arr = Array.isArray(emojis) ? emojis : [emojis];
  const rect = pet.getBoundingClientRect();
  const cx = from?.x != null ? from.x : rect.width / 2;
  const cy = from?.y != null ? from.y : rect.height * 0.42;
  for (let i = 0; i < count; i++) {
    const el = document.createElement('span');
    el.className = 'particle';
    el.textContent = arr[i % arr.length];
    const angle = (-160 + Math.random() * 140) * Math.PI / 180;
    const dist = 38 + Math.random() * 82;
    el.style.left = cx + 'px';
    el.style.top = cy + 'px';
    el.style.setProperty('--tx', Math.round(Math.cos(angle) * dist) + 'px');
    el.style.setProperty('--ty', Math.round(Math.sin(angle) * dist - 30) + 'px');
    el.style.setProperty('--rot', Math.round((Math.random() - .5) * 90) + 'deg');
    el.style.setProperty('--sc', (0.85 + Math.random() * .6).toFixed(2));
    el.style.setProperty('--dur', (0.75 + Math.random() * .55).toFixed(2) + 's');
    el.style.fontSize = (14 + Math.random() * 12) + 'px';
    fx.appendChild(el);
    setTimeout(() => el.remove(), 1500);
  }
}

/* ---------------- 气泡 ---------------- */
function showReply(reply, hold, opts = {}) {
  if (!reply || !reply.en) return;
  const words = (reply.words || []).filter((w) => w && w.w);
  let html = `<div class="en">${renderEn(reply.en, words)}</div>`;
  if (reply.zh) html += `<div class="zh">${esc(reply.zh)}</div>`;
  if (words.length) {
    html += `<div class="ipa-hint">${words.map((w) => `${esc(w.w)} ${esc(w.ipa || '')}`).join(' · ')}</div>`;
  }
  if (reply.choices && reply.choices.length) {
    html += `<div class="choices">` + reply.choices.map((c, i) =>
      `<button data-i="${i}" title="${esc(c.ipa || '')}"><span class="en">${esc(c.en)}</span><span class="meta">${c.ipa ? `<span class="ipa-mini">${esc(c.ipa)}</span> · ` : ''}${esc(c.zh)}</span></button>`
    ).join('') + `</div>`;
  }
  bubble.innerHTML = html;
  bubble.classList.add('show');
  fitWindow();
  PET_ANIMS.forEach((c) => pet.classList.remove(c));
  const anim = opts.animation === 'none' ? null : (opts.animation || 'bounce');
  if (anim) {
    void pet.offsetWidth;
    pet.classList.add(PET_ANIMS.includes(anim) ? anim : 'bounce');
    setTimeout(() => PET_ANIMS.forEach((c) => pet.classList.remove(c)), 750);
  }
  bubble.classList.toggle('inner', !!opts.inner);
  if (opts.mood) setExpression(opts.mood, opts.moodMs || 1600);
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    bubble.classList.remove('show');
    fitWindow();
  }, hold || 9500);

  bubble.querySelectorAll('.choices button').forEach((b) => {
    b.addEventListener('click', () => {
      const c = reply.choices[+b.dataset.i];
      if (c && c.en) sendText(c.en);
    });
  });

  const done = opts.onDone || (() => {
    busy = false;
    resumeListening();
  });
  if (opts.speak === false) done();
  else speak(reply.en, done);
}

/* ---------------- TTS ---------------- */
function speak(text, done) {
  if (!text) { done?.(); return; }
  if (ttsCfg.ttsEnabled === false) { done?.(); return; }
  pauseListening();
  if (window.DayuTTS) {
    window.DayuTTS.speak(text, ttsCfg, done);
  } else {
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'en-US'; u.rate = 0.95; u.pitch = 1.05;
      u.onend = u.onerror = () => done?.();
      window.speechSynthesis.speak(u);
    } catch { done?.(); }
  }
}

async function sendText(text) {
  text = String(text || '').trim();
  if (!text || busy) return;
  busy = true;
  pauseListening();
  const safety = setTimeout(() => { if (busy) { busy = false; resumeListening(); } }, 30000);
  try {
    await window.petAPI.chatSend({ text });
    // 回复通过 onSay 展示，busy 在 TTS 结束后清除
  } catch (e) {
    showReply({ en: 'Sorry, something went wrong: ' + (e.message || e), zh: '' }, 6500, {
      speak: true,
      animation: 'shake',
      mood: 'sad',
      onDone: () => { busy = false; resumeListening(); }
    });
  } finally {
    clearTimeout(safety);
  }
}

/* ---------------- 麦克风：后台唤醒 / 指令识别 ---------------- */
function normalizeVoiceText(t) {
  return String(t || '').toLowerCase()
    .replace(/[\s，。！？、,.!?;；:：'"”‘’（）()\[\]【】]/g, '');
}

function levenshtein(a, b) {
  a = String(a || ''); b = String(b || '');
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  const dp = new Array(n + 1);
  for (let j = 0; j <= n; j++) dp[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[n];
}

function matchWakeWord(text) {
  const norm = normalizeVoiceText(text);
  if (!norm) return false;
  const words = (voiceCfg.wakeWords && voiceCfg.wakeWords.length)
    ? voiceCfg.wakeWords
    : ['你好大肥鱼'];
  const threshold = Math.max(0.5, Math.min(0.95, Number(voiceCfg.wakeSensitivity) || 0.68));
  for (const word of words) {
    const w = normalizeVoiceText(word);
    if (!w) continue;
    if (norm.includes(w)) return true;
    const minLen = Math.max(2, w.length - 2);
    const maxLen = Math.min(norm.length, w.length + 2);
    for (let i = 0; i <= norm.length - minLen; i++) {
      const chunk = norm.slice(i, i + maxLen);
      const sim = 1 - levenshtein(w, chunk) / Math.max(w.length, chunk.length || 1);
      if (sim >= threshold) return true;
    }
  }
  return false;
}

function stopRec() {
  if (!rec) return;
  try { rec.onend = null; rec.onerror = null; rec.stop(); } catch {}
  rec = null;
}

function canListen() {
  return !!SR && micEnabled && !chatOpen && !busy && !dragging;
}

function scheduleWake(delay = 350) {
  clearTimeout(wakeListenTimer);
  wakeListenTimer = setTimeout(() => {
    if (canListen()) startWakeListening();
  }, delay);
}

function handleMicError(err) {
  const now = Date.now();
  const code = err && err.error;
  if (now - lastMicErr > 30000 && code !== 'no-speech') {
    lastMicErr = now;
    const msg = {
      'not-allowed': '麦克风未授权',
      'audio-capture': '没有检测到麦克风设备',
      'no-speech': '没听到声音'
    }[code] || code;
    if (msg) showReply({ en: 'Mic: ' + msg, zh: '麦克风：' + msg }, 4200, { speak: false, animation: 'none' });
  }
}

function startWakeListening() {
  if (!voiceCfg.voiceWakeEnabled) { voiceState = 'off'; return; }
  if (!canListen()) { scheduleWake(700); return; }
  stopRec();
  voiceState = 'wake';
  listening = true;
  try {
    rec = new SR();
    rec.lang = voiceCfg.wakeLang || 'zh-CN';
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (e) => {
      let text = '';
      for (let i = e.resultIndex; i < e.results.length; i++) text += e.results[i][0].transcript || '';
      if (text && matchWakeWord(text)) onWakeDetected();
    };
    rec.onend = () => {
      rec = null;
      if (voiceState === 'wake' && canListen()) scheduleWake(220);
    };
    rec.onerror = (e) => {
      rec = null;
      handleMicError(e);
      if (voiceState === 'wake' && canListen() && e.error !== 'not-allowed') scheduleWake(1200);
    };
    rec.start();
  } catch {
    rec = null;
    scheduleWake(1500);
  }
}

function onWakeDetected() {
  if (voiceState !== 'wake') return;
  voiceState = 'awake';
  listening = false;
  clearTimeout(wakeListenTimer);
  stopRec();
  burst(['💗', '✨', '🐟'], 7);
  showReply({
    en: "Y-yes? I am here... n-not that I was waiting for you!",
    zh: '在、在啦！……才、才没有一直等你呢！',
    words: [{ w: 'waiting', ipa: '/ˈweɪtɪŋ/', zh: '等待' }]
  }, 3600, {
    speak: true,
    animation: 'jump',
    mood: 'shy',
    onDone: () => startCommandListening()
  });
}

function startCommandListening() {
  if (!voiceCfg.voiceWakeEnabled) { voiceState = 'off'; return; }
  if (!canListen()) { scheduleWake(600); return; }
  stopRec();
  voiceState = 'command';
  commandFinal = '';
  try {
    rec = new SR();
    rec.lang = voiceCfg.voiceCommandLang || 'en-US';
    rec.continuous = false;
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    rec.onresult = (e) => {
      const t = (e.results?.[0]?.[0]?.transcript || '').trim();
      if (t) commandFinal = t;
    };
    rec.onend = () => {
      rec = null;
      const t = commandFinal.trim();
      commandFinal = '';
      if (t) sendText(t);
      else scheduleWake(350);
    };
    rec.onerror = (e) => {
      rec = null;
      handleMicError(e);
      scheduleWake(900);
    };
    rec.start();
  } catch {
    rec = null;
    scheduleWake(1200);
  }
}

function pauseListening() {
  listening = false;
  voiceState = 'off';
  clearTimeout(wakeListenTimer);
  stopRec();
}

function resumeListening() {
  if (chatOpen || busy || !micEnabled || !voiceCfg.voiceWakeEnabled) return;
  if (voiceState === 'command' || voiceState === 'awake') return;
  if (voiceState === 'wake' && rec) { listening = true; return; }
  startWakeListening();
}

function updateMicButton() {}
function setMic(enabled) {
  micEnabled = enabled;
  updateMicButton();
  if (!micEnabled) pauseListening();
  else { listening = true; resumeListening(); }
}
function startListening() { startWakeListening(); }

function baseHeightForSkin(skin) {
  return (SKINS[skin] && SKINS[skin].baseHeight) || 240;
}

function applySkin(skin) {
  if (!SKINS[skin]) skin = 'dafeiyu';
  currentSkin = skin;
  currentView = 'down';
  const cfg = SKINS[skin];
  petArea.classList.remove('flip');
  if (cfg.views) {
    pet.src = cfg.views.down;
  } else {
    pet.src = cfg.single;
  }
  petSize = Math.round(baseHeightForSkin(skin) * petScale);
  document.documentElement.style.setProperty('--pet-h', petSize + 'px');
  fitWindow();
}

function setView(dir) {
  const cfg = SKINS[currentSkin];
  if (!cfg) return;
  if (!cfg.views) {
    if (dir === 'right') petArea.classList.add('flip');
    else if (dir === 'left') petArea.classList.remove('flip');
    return;
  }
  if (!cfg.views[dir]) return;
  currentView = dir;
  if (pet.src !== cfg.views[dir]) pet.src = cfg.views[dir];
  petArea.classList.toggle('flip', dir === 'right');
}

function setWalking(on) {
  petArea.classList.toggle('walking', !!on);
}

function showFunctionPanel(show) {
  const willShow = show == null ? functionPanel.classList.contains('hidden') : !!show;
  functionPanel.classList.toggle('hidden', !willShow);
  if (willShow) {
    clearTimeout(showFunctionPanel._timer);
    showFunctionPanel._timer = setTimeout(() => functionPanel.classList.add('hidden'), 4500);
  }
}

/* ---------------- 同款待机动画 ---------------- */
function playPetAnim(cls, ms = 900) {
  if (!cls) return;
  PET_ANIMS.forEach((c) => pet.classList.remove(c));
  void pet.offsetWidth;
  pet.classList.add(cls);
  setTimeout(() => pet.classList.remove(cls), ms);
}

function idleTick() {
  if (dragging || chatOpen || busy) return;
  const walking = petArea.classList.contains('walking');
  const r = Math.random();

  // 走路时只有小概率蹦一下，和参考工程一致
  if (walking) {
    if (r < 0.06) playPetAnim('jump', 620);
    return;
  }

  if (r < 0.28) playPetAnim('sway', 900);
  else if (r < 0.52) playPetAnim('stretch', 1100);
  else if (r < 0.72) playPetAnim('jump', 650);
  else if (r < 0.84 && !bubble.classList.contains('show')) {
    const line = IDLE_LINES[Math.floor(Math.random() * IDLE_LINES.length)];
    showReply({ en: line, zh: '' }, 3000, { speak: false, inner: true, animation: 'none' });
  }
}

/* ---------------- 点击 / 拖拽互动 ---------------- */
function regionOf(e) {
  const rect = pet.getBoundingClientRect();
  const ry = (e.clientY - rect.top) / Math.max(1, rect.height);
  const rx = (e.clientX - rect.left) / Math.max(1, rect.width);
  if (ry < 0.37) return 'head';
  if (ry > 0.62 && (rx < 0.34 || rx > 0.78)) return 'tail';
  return 'body';
}
function reactAt(region) {
  const arr = LINES[region] || LINES.body;
  const r = arr[Math.floor(Math.random() * arr.length)];
  const kinds = { head: ['💗', '✨', '💕'], body: ['✨', '🐟', '❗'], tail: ['💦', '❗', '🌀'] };
  burst(kinds[region] || ['✨'], region === 'tail' ? 7 : 6);
  if (region === 'head') adjustMood({ affection: 1, mood: 2 });
  else adjustMood({ mood: 1 });
  showReply(r, 6000, {
    speak: true,
    animation: region === 'tail' ? 'shake' : 'jump',
    mood: region === 'head' ? 'shy' : 'happy'
  });
  setExpression(region === 'head' ? 'shy' : 'happy', 1200);
  showFunctionPanel(true);
}

pet.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  dragging = true;
  moved = 0;
  suppressClick = false;
  offX = e.clientX;
  offY = e.clientY;
  window.petAPI.startDrag?.();
  e.preventDefault();
});
window.addEventListener('mousemove', (e) => {
  if (!dragging) return;
  moved += Math.abs(e.movementX || 0) + Math.abs(e.movementY || 0);
  petArea.classList.add('dragging');
  const mx = e.movementX || 0, my = e.movementY || 0;
  if (Math.abs(mx) >= Math.abs(my)) { if (Math.abs(mx) > 2) setView(mx < 0 ? 'left' : 'right'); }
  else if (Math.abs(my) > 2) setView(my < 0 ? 'up' : 'down');
  window.petAPI.move(e.screenX - offX, e.screenY - offY);
});
window.addEventListener('mouseup', (e) => {
  if (!dragging) return;
  dragging = false;
  petArea.classList.remove('dragging');
  window.petAPI.endDrag(e.screenX - offX, e.screenY - offY);
  setView('down');
  suppressClick = moved >= 10;
  if (moved >= 90 && Math.random() < 0.55) {
    const r = LINES.drag[Math.floor(Math.random() * LINES.drag.length)];
    showReply(r, 4500, { speak: true, animation: 'bounce' });
  }
  moved = 0;
});

pet.addEventListener('click', (e) => {
  if (suppressClick) { suppressClick = false; return; }
  clickCount++;
  const evt = { clientX: e.clientX, clientY: e.clientY };
  clearTimeout(clickTimer);
  clickTimer = setTimeout(() => {
    clickCount = 0;
    reactAt(regionOf(evt));
  }, 250);
  if (clickCount >= 2) { clearTimeout(clickTimer); clickCount = 0; }
});
pet.addEventListener('dblclick', () => {
  clearTimeout(clickTimer);
  clickCount = 0;
  openFeed();
});

/* ---------------- 功能面板 / 投喂 ---------------- */
function openChat() { window.petAPI.openChat(); }
function openFeed(show) {
  const willShow = show == null ? feedPanel.classList.contains('hidden') : !!show;
  feedPanel.classList.toggle('hidden', !willShow);
  if (willShow) {
    bubble.classList.remove('show');
    showFunctionPanel(false);
    fitWindow();
    feedPanel.querySelector('.feed-btn')?.focus();
  }
}
function buildFeedPanel() {
  feedRow.innerHTML = FOODS.map((f, i) => `<button class="feed-btn" data-i="${i}" title="${esc(f.en)}">${f.emoji}</button>`).join('');
  feedRow.querySelectorAll('.feed-btn').forEach((b) => {
    b.addEventListener('click', () => feed(FOODS[+b.dataset.i]));
  });
}
async function feed(food) {
  if (!food) return;
  openFeed(false);
  burst([food.emoji, '💗', '✨'], 10);
  await adjustMood({ mood: food.mood, affection: food.affection });
  showReply({ en: food.en, zh: food.zh, words: food.words }, 5200, {
    speak: true,
    animation: 'eat',
    mood: 'happy'
  });
}
document.getElementById('feed-close').addEventListener('click', () => openFeed(false));
fnChat.addEventListener('click', (e) => {
  e.stopPropagation();
  showFunctionPanel(false);
  openChat();
});

/* ---------------- 快捷菜单（主进程）& 跨窗口 ---------------- */
if (window.petAPI.onSay) window.petAPI.onSay((reply) => { if (reply && reply.en) showReply(reply); });
if (window.petAPI.onSayHello) window.petAPI.onSayHello(() => hardGreet());
if (window.petAPI.onAction) window.petAPI.onAction((a) => {
  if (!a) return;
  if (a.type === 'pat') reactAt('head');
  else if (a.type === 'feed') openFeed();
  else if (a.type === 'chat') openChat();
});
if (window.petAPI.onMode) window.petAPI.onMode((mode) => setModeUi(mode));
if (window.petAPI.onScale) window.petAPI.onScale((scale) => applyScale(scale));
if (window.petAPI.onDirection) window.petAPI.onDirection((dir) => setView(dir));
if (window.petAPI.onMoving) window.petAPI.onMoving((moving) => {
  setWalking(!!moving);
  if (!moving) setView('down');
});
if (window.petAPI.onSkin) window.petAPI.onSkin((skin) => applySkin(skin));
if (window.petAPI.onTtsConfig) window.petAPI.onTtsConfig((next) => {
  ttsCfg = { ...ttsCfg, ...(next || {}) };
  voiceCfg = { ...voiceCfg, ...(next || {}) };
  if (typeof voiceCfg.wakeWords === 'string') {
    voiceCfg.wakeWords = voiceCfg.wakeWords.split(/[,，;；\s]+/).filter(Boolean);
  }
  if (!Array.isArray(voiceCfg.wakeWords) || !voiceCfg.wakeWords.length) {
    voiceCfg.wakeWords = ['你好大肥鱼', '大肥鱼', '你好大飞鱼'];
  }
  if (!busy) {
    pauseListening();
    if (voiceCfg.voiceWakeEnabled !== false) scheduleWake(250);
  }
});
if (window.petAPI.onChatState) window.petAPI.onChatState((open) => {
  chatOpen = open;
  if (open) pauseListening(); else resumeListening();
});

function setModeUi(mode) {
  stage.dataset.mode = mode || 'idle';
  setWalking(mode === 'follow' || mode === 'wander');
  if (mode === 'idle') { currentView = 'down'; setView('down'); }
}

/* ---------------- DSH 会话联动 ---------------- */
const DSH_LINES = {
  start: { en: 'Master is working on a DSH task... I will keep quiet.', zh: '主人开始忙 DSH 任务了……我安静看着。' },
  done: { en: 'The task looks finished. Good job... n-not that I was watching!', zh: '任务好像完成了。干得不错……才、才没有一直盯着看呢！' }
};
let dshPrev = { active: false, state: 'idle' };
setInterval(async () => {
  if (chatOpen || busy) return;
  let s;
  try { s = await window.petAPI.dshState(); } catch { return; }
  if (!s || !s.ok) return;
  const was = dshPrev;
  dshPrev = { active: s.active, state: s.state };
  if (!s.active && was.active) showReply(DSH_LINES.done, 8000, { speak: true, mood: 'happy' });
  else if (s.active && s.state === 'working' && !(was.active && was.state === 'working')) showReply(DSH_LINES.start, 6000, { speak: true, mood: 'shy' });
}, 6000);

/* ---------------- 启动 ---------------- */
function hardGreet() {
  showReply({
    en: "Hmph! I am NOT a freeloader fat fish. ...Anyway, good morning, Master.",
    zh: '哼！我才不是吃白饭的大肥鱼。……总之，早上好，主人。',
    words: [
      { w: 'freeloader', ipa: '/ˈfriːləʊdə/', zh: '白吃白喝的人' },
      { w: 'anyway', ipa: '/ˈeniweɪ/', zh: '总之' }
    ],
    choices: [
      { en: 'Good morning! I slept great.', zh: '早上好！我睡得很好。', ipa: '/ɡʊd ˈmɔːnɪŋ! aɪ slept ɡreɪt/' },
      { en: 'Morning! A bit sleepy though.', zh: '早！不过还有点困。', ipa: '/ˈmɔːnɪŋ! ə bɪt ˈsliːpi ðəʊ/' }
    ]
  }, 12000, { speak: true, mood: 'shy' });
}

function applyScale(scale) {
  petScale = Math.min(1.5, Math.max(0.75, Number(scale) || 1));
  petSize = Math.round(baseHeightForSkin(currentSkin) * petScale);
  document.documentElement.style.setProperty('--pet-h', petSize + 'px');
  document.documentElement.style.setProperty('--bubble-w', Math.round(370 * Math.max(.88, petScale)) + 'px');
  fitWindow();
}

function fitWindow() {
  try {
    const pr = pet.getBoundingClientRect();
    const petW = pr.width || petSize || 200;
    const w = Math.ceil(Math.max(petW, bubble.offsetWidth || 0) + 48);
    const h = Math.ceil(stage.offsetHeight + 8);
    window.petAPI.resize(h, bubble.offsetHeight, w);
  } catch {}
}

(async function init() {
  let cfg = {};
  try { cfg = await window.petAPI.configGet(); } catch {}
  ttsCfg = { ...ttsCfg, ...(cfg || {}) };
  voiceCfg = { ...voiceCfg, ...(cfg || {}) };
  if (typeof voiceCfg.wakeWords === 'string') {
    voiceCfg.wakeWords = voiceCfg.wakeWords.split(/[,，;；\s]+/).filter(Boolean);
  }
  if (!Array.isArray(voiceCfg.wakeWords) || !voiceCfg.wakeWords.length) {
    voiceCfg.wakeWords = ['你好大肥鱼', '大肥鱼', '你好大飞鱼'];
  }
  applySkin(cfg.petSkin || 'dafeiyu');
  applyScale(cfg.petScale || 1);
  setModeUi(cfg.petMode || 'wander');
  await refreshMood();
  buildFeedPanel();
  updateMicButton();
  clearInterval(idleTimer);
  idleTimer = setInterval(idleTick, 2600);
  pet.addEventListener('load', fitWindow);
  if (pet.complete) fitWindow();
  if (cfg.apiKey) {
    try { showReply(await window.petAPI.chatGreet(), 12000, { speak: true, mood: 'shy' }); }
    catch { hardGreet(); }
  } else {
    hardGreet();
  }
  startListening();
})();

/* ---------------- 键盘缩放（Ctrl + / -） ---------------- */
window.addEventListener('keydown', (e) => {
  if (!e.ctrlKey) return;
  if (e.key === '+' || e.key === '=') {
    e.preventDefault();
    window.petAPI.setScale?.(Math.min(1.5, petScale + 0.25));
  } else if (e.key === '-' || e.key === '_') {
    e.preventDefault();
    window.petAPI.setScale?.(Math.max(0.75, petScale - 0.25));
  }
});

