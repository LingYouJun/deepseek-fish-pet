const pet = document.getElementById('pet');
const petArea = document.getElementById('pet-area');
const stage = document.getElementById('stage');
const bubble = document.getElementById('bubble');
const fx = document.getElementById('fx');
const dock = document.getElementById('dock');
const feedPanel = document.getElementById('feed-panel');
const feedRow = feedPanel.querySelector('.feed-row');

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

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

let dragging = false, offX = 0, offY = 0, moved = 0, suppressClick = false, hideTimer = null;
let listening = true, micEnabled = true, chatOpen = false, rec = null, busy = false, curUtter = null;
let clickCount = 0, clickTimer = null, lastMicErr = 0;
let petSize = 350, petScale = 1;
let moodState = { affection: 30, mood: 70 };
let expressionTimer = null;

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
  pet.classList.remove('bounce', 'shake');
  void pet.offsetWidth;
  pet.classList.add(opts.animation === 'shake' ? 'shake' : 'bounce');
  setTimeout(() => pet.classList.remove('bounce', 'shake'), 700);
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
    if (busy) { busy = false; resumeListening(); }
  });
  if (opts.speak === false) done();
  else speak(reply.en, done);
}

/* ---------------- TTS ---------------- */
function speak(text, done) {
  if (!text || !window.speechSynthesis) { done?.(); return; }
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-US';
    u.rate = 0.95;
    u.pitch = 1.05;
    curUtter = u;
    const finish = () => { if (curUtter === u) { curUtter = null; done?.(); } };
    u.onend = finish;
    u.onerror = finish;
    window.speechSynthesis.speak(u);
  } catch { done?.(); }
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

/* ---------------- 持续收音 ---------------- */
function startListening() {
  if (!SR || !micEnabled || !listening || chatOpen || rec || busy) return;
  try {
    rec = new SR();
    rec.lang = 'en-US';
    rec.continuous = false;
    rec.interimResults = false;
    rec.onresult = (e) => { const t = (e.results?.[0]?.[0]?.transcript || '').trim(); if (t) sendText(t); };
    rec.onend = () => { rec = null; if (micEnabled && listening && !chatOpen && !busy) setTimeout(startListening, 300); };
    rec.onerror = (e) => {
      rec = null;
      const now = Date.now();
      if (now - lastMicErr > 30000) {
        lastMicErr = now;
        const msg = { 'not-allowed': '麦克风未授权', 'audio-capture': '没有检测到麦克风设备', 'no-speech': '没听到声音' }[e.error];
        if (msg) showReply({ en: 'Mic: ' + msg, zh: '麦克风：' + msg }, 5000, { speak: false });
      }
      if (micEnabled && listening && !chatOpen && !busy && e.error !== 'not-allowed') setTimeout(startListening, 1500);
    };
    rec.start();
  } catch {}
}
function pauseListening() { listening = false; try { rec?.stop(); } catch {} rec = null; }
function resumeListening() { if (chatOpen || busy || !micEnabled) return; listening = true; startListening(); }
function updateMicButton() {
  const btn = dock.querySelector('[data-act="listen"]');
  if (btn) { btn.classList.toggle('on', micEnabled); btn.classList.toggle('listening', micEnabled); }
}
function setMic(enabled) {
  micEnabled = enabled;
  updateMicButton();
  if (!micEnabled) pauseListening();
  else { listening = true; resumeListening(); }
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
    animation: region === 'tail' ? 'shake' : 'bounce',
    mood: region === 'head' ? 'shy' : 'happy'
  });
  setExpression(region === 'head' ? 'shy' : 'happy', 1200);
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
  window.petAPI.move(e.screenX - offX, e.screenY - offY);
});
window.addEventListener('mouseup', (e) => {
  if (!dragging) return;
  dragging = false;
  petArea.classList.remove('dragging');
  window.petAPI.endDrag(e.screenX - offX, e.screenY - offY);
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

/* ---------------- 快捷 Dock / 投喂 ---------------- */
function openChat() { window.petAPI.openChat(); }
function openFeed(show) {
  const willShow = show == null ? feedPanel.classList.contains('hidden') : !!show;
  feedPanel.classList.toggle('hidden', !willShow);
  if (willShow) feedPanel.querySelector('.feed-btn')?.focus();
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
    animation: 'bounce',
    mood: 'happy'
  });
}
document.getElementById('feed-close').addEventListener('click', () => openFeed(false));
dock.querySelectorAll('.dock-btn').forEach((btn) => {
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const act = btn.dataset.act;
    if (act === 'chat') openChat();
    else if (act === 'pat') reactAt('head');
    else if (act === 'feed') openFeed();
    else if (act === 'listen') setMic(!micEnabled);
  });
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
if (window.petAPI.onDirection) window.petAPI.onDirection((dir) => {
  petArea.classList.toggle('dir-left', dir === 'left');
});
if (window.petAPI.onChatState) window.petAPI.onChatState((open) => {
  chatOpen = open;
  if (open) pauseListening(); else resumeListening();
});

function setModeUi(mode) {
  stage.dataset.mode = mode || 'idle';
  petArea.classList.toggle('walking', mode === 'follow' || mode === 'wander');
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
  petSize = Math.round(350 * petScale);
  document.documentElement.style.setProperty('--pet-w', petSize + 'px');
  document.documentElement.style.setProperty('--bubble-w', Math.round(370 * Math.max(.88, petScale)) + 'px');
  fitWindow();
}

function fitWindow() {
  try {
    const w = Math.ceil(Math.max(petSize, bubble.offsetWidth || 0) + 46);
    const h = Math.ceil(stage.offsetHeight + 8);
    window.petAPI.resize(h, bubble.offsetHeight, w);
  } catch {}
}

(async function init() {
  let cfg = {};
  try { cfg = await window.petAPI.configGet(); } catch {}
  applyScale(cfg.petScale || 1);
  setModeUi(cfg.petMode || 'idle');
  await refreshMood();
  buildFeedPanel();
  updateMicButton();
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

