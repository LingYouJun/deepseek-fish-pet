const $ = (id) => document.getElementById(id);

let cfg = {};
let busy = false;
let ttsOn = true;

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* ---------------- 悬停音标 ---------------- */
let tip = null;
function ensureTip() { if (!tip) { tip = document.createElement('div'); tip.id = 'tip'; document.body.appendChild(tip); } return tip; }
function hideTip() { if (tip) tip.classList.remove('show'); }
function positionTip(e) {
  const r = tip.getBoundingClientRect(), pad = 12;
  let x = e.clientX + pad, y = e.clientY + pad;
  if (x + r.width > innerWidth) x = e.clientX - r.width - pad;
  if (y + r.height > innerHeight) y = e.clientY - r.height - pad;
  tip.style.left = x + 'px'; tip.style.top = y + 'px';
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

/* ---------------- 初始化 ---------------- */
(async function init() {
  cfg = await window.petAPI.configGet();
  ttsOn = cfg.ttsEnabled !== false;
  $('ttsBtn').classList.toggle('on', ttsOn);
  if (!cfg.apiKey) showSetup(true); else { showMain(); greet(); }
  refreshMood();
})();

async function refreshMood() {
  try {
    const m = await window.petAPI.moodGet();
    const aff = Math.round(m.affection ?? 0), mo = Math.round(m.mood ?? 0);
    $('affVal').textContent = aff + ' / 100';
    $('moodVal').textContent = mo + ' / 100';
    $('moodBar').title = `好感度 ${aff} · 心情 ${mo}`;
  } catch {}
}

async function refreshDsh() {
  try {
    const s = await window.petAPI.dshState();
    if (!s || !s.ok) { $('dshBar').textContent = ''; return; }
    const map = { working: '执行中', thinking: '思考中', idle: '空闲' };
    $('dshBar').textContent = `🖥 DSH ${map[s.state] || ''}${s.tool ? ' · ' + s.tool : ''}${s.active ? '' : '（已停）'}`;
  } catch {}
}
setInterval(refreshDsh, 5000);

function showSetup(prefill) {
  $('setup').classList.remove('hidden');
  ['persona', 'diary'].forEach((x) => $(x).classList.add('hidden'));
  $('main').classList.add('hidden');
  if (prefill) {
    $('apiBase').value = cfg.apiBase || 'https://api.deepseek.com/v1';
    $('apiKey').value = cfg.apiKey || '';
    $('model').value = cfg.model || 'deepseek-chat';
    $('vocabLevel').value = cfg.vocabLevel || 'high_school';
    $('assistant').value = cfg.assistant || 'off';
    $('provider').value = 'custom';
  }
}
function showMain() {
  ['setup', 'persona', 'diary'].forEach((x) => $(x).classList.add('hidden'));
  $('main').classList.remove('hidden');
  $('input').focus();
}

/* ---------------- 绑定 API ---------------- */
$('provider').addEventListener('change', (e) => {
  if (e.target.value === 'custom') return;
  const [base, model] = e.target.value.split('|');
  $('apiBase').value = base; $('model').value = model;
});
$('save').addEventListener('click', async () => {
  const apiBase = $('apiBase').value.trim(), apiKey = $('apiKey').value.trim(), model = $('model').value.trim();
  if (!apiBase || !apiKey || !model) { $('setupMsg').textContent = '接口地址 / API Key / 模型名 都要填哦'; return; }
  $('save').disabled = true; $('setupMsg').textContent = '正在测试连接…';
  try {
    await window.petAPI.configTest({ apiBase, apiKey, model });
    cfg = await window.petAPI.configSet({ apiBase, apiKey, model, vocabLevel: $('vocabLevel').value, assistant: $('assistant').value });
    $('setupMsg').textContent = '';
    showMain(); greet();
  } catch (e) { $('setupMsg').textContent = '连接失败：' + e.message; }
  finally { $('save').disabled = false; }
});
$('skip').addEventListener('click', () => { showMain(); greet(); });
$('settingsBtn').addEventListener('click', () => showSetup(true));

/* ---------------- 人设 ---------------- */
$('personaBtn').addEventListener('click', async () => {
  const p = await window.petAPI.personaGet();
  $('pName').value = p.name || ''; $('pWorld').value = p.world_setting || '';
  $('pChar').value = p.character_setting || ''; $('pCatch').value = p.catchphrase || ''; $('pHidden').value = p.hidden_setting || '';
  $('pMsg').textContent = '';
  $('persona').classList.remove('hidden');
});
$('pSave').addEventListener('click', async () => {
  $('pSave').disabled = true; $('pMsg').textContent = '保存中…';
  try {
    await window.petAPI.personaSet({
      name: $('pName').value.trim(), world_setting: $('pWorld').value.trim(),
      character_setting: $('pChar').value.trim(), catchphrase: $('pCatch').value.trim(),
      hidden_setting: $('pHidden').value.trim()
    });
    $('pMsg').textContent = '已保存 ✅';
    setTimeout(() => $('persona').classList.add('hidden'), 600);
  } catch (e) { $('pMsg').textContent = '保存失败：' + e.message; }
  finally { $('pSave').disabled = false; }
});
$('pCancel').addEventListener('click', () => $('persona').classList.add('hidden'));

/* ---------------- 记忆日记 ---------------- */
async function renderDiary() {
  const m = await window.petAPI.memoryGet();
  const body = $('diaryBody');
  const long = [...(m.long || [])].reverse();
  const mid = [...(m.medium || [])].reverse();
  let html = `<div class="dstat">📚 长期记忆 <b>${long.length}</b> 天 · 今日会话 <b>${mid.length}</b> 段</div>`;
  if (!long.length && !mid.length) html += '<div class="dempty">还没有记忆。多聊几天，我就会把它们写成日记啦。</div>';
  if (mid.length) {
    html += '<div class="dsec">今天的会话（中期记忆）</div>';
    for (const e of mid) {
      html += `<div class="dentry mid"><div class="dhead"><span>📝 ${esc(e.date)}</span><button class="ddel" data-kind="medium" data-ts="${e.ts}">删除</button></div><div class="dtext">${esc(e.summary)}</div></div>`;
    }
  }
  if (long.length) {
    html += '<div class="dsec">日记（长期记忆 · 按天）</div>';
    for (const e of long) {
      html += `<div class="dentry"><div class="dhead"><span>🗓 ${esc(e.date)}</span><button class="ddel" data-kind="long" data-ts="${e.ts}">删除</button></div><div class="dtext">${esc(e.diary)}</div></div>`;
    }
  }
  body.innerHTML = html;
  body.querySelectorAll('.ddel').forEach((b) => b.addEventListener('click', async () => {
    await window.petAPI.memoryDelete({ kind: b.dataset.kind, ts: Number(b.dataset.ts) });
    renderDiary();
  }));
}

$('diaryBtn').addEventListener('click', () => { $('diary').classList.remove('hidden'); renderDiary(); });
$('diaryClose').addEventListener('click', () => $('diary').classList.add('hidden'));

/* ---------------- 生词本 ---------------- */
let vocabData = [];
async function renderVocab() {
  vocabData = await window.petAPI.vocabList();
  const body = $('vocabBody');
  if (!vocabData.length) {
    body.innerHTML = '<div class="dempty">生词本还是空的。点对话里带虚线的单词，或跟读时读错的红词，就能收藏进来。</div>';
    return;
  }
  body.innerHTML = vocabData.map((v, i) => {
    const rate = v.review ? Math.round(((v.good || 0) / v.review) * 100) : null;
    return `<div class="vitem"><div class="vmain"><b>${esc(v.w)}</b><span class="vipa">${esc(v.ipa || '')}</span><span class="vzh">${esc(v.zh || '')}</span></div><div class="vmeta">${v.review ? `复习 ${v.review} 次 · 掌握 ${rate}%` : '未复习'}<button class="vdel" data-i="${i}">删除</button></div></div>`;
  }).join('');
  body.querySelectorAll('.vdel').forEach((b) => b.addEventListener('click', async () => {
    await window.petAPI.vocabDel(vocabData[+b.dataset.i].w);
    renderVocab();
  }));
}

let reviewQueue = [], reviewIdx = 0, reviewShown = false;
async function startReview() {
  vocabData = await window.petAPI.vocabList();
  if (!vocabData.length) { $('vocabBody').innerHTML = '<div class="dempty">还没有生词可复习。</div>'; return; }
  reviewQueue = vocabData.slice().sort((a, b) => {
    const ra = a.review ? (a.good || 0) / a.review : 0;
    const rb = b.review ? (b.good || 0) / b.review : 0;
    return ra - rb;
  });
  reviewIdx = 0; reviewShown = false; renderCard();
}
function renderCard() {
  const body = $('vocabBody');
  if (reviewIdx >= reviewQueue.length) { body.innerHTML = '<div class="dempty">本轮复习完成 ✅</div>'; return; }
  const v = reviewQueue[reviewIdx];
  body.innerHTML = `<div class="vcard"><div class="vword">${esc(v.w)}</div>` +
    `<div class="vipa2">${reviewShown ? esc(v.ipa || '') : '&nbsp;'}</div>` +
    (reviewShown ? `<div class="vzh2">${esc(v.zh || '（无释义）')}</div>` : '') +
    `<div class="vbtns">${reviewShown ? '<button id="vGood" class="primary">认识 ✓</button><button id="vBad" class="ghost">不认识 ✗</button>' : '<button id="vShow" class="primary">显示释义</button>'}</div>` +
    `<div class="vprog">${reviewIdx + 1} / ${reviewQueue.length}</div></div>`;
  const show = $('vShow'); if (show) show.addEventListener('click', () => { reviewShown = true; renderCard(); });
  const good = $('vGood'); if (good) good.addEventListener('click', () => markReview(true));
  const bad = $('vBad'); if (bad) bad.addEventListener('click', () => markReview(false));
}
async function markReview(ok) {
  await window.petAPI.vocabReview(reviewQueue[reviewIdx].w, ok);
  reviewIdx++; reviewShown = false; renderCard();
}

$('vocabBtn').addEventListener('click', () => { $('vocab').classList.remove('hidden'); renderVocab(); });
$('vocabClose').addEventListener('click', () => $('vocab').classList.add('hidden'));
$('vocabReview').addEventListener('click', startReview);

// 点对话里的单词 → 收藏进生词本
document.addEventListener('click', async (e) => {
  const el = e.target.closest('#msgs .w');
  if (!el) return;
  const w = el.textContent.trim();
  if (!w) return;
  await window.petAPI.vocabAdd({ w, ipa: el.dataset.ipa || '', zh: el.dataset.zh || '' });
  addSys(`📒 已加入生词本：${w}`);
});

/* ---------------- 消息渲染 ---------------- */
function scroll() { const m = $('msgs'); m.scrollTop = m.scrollHeight; }
function addUser(text) {
  const d = document.createElement('div');
  d.className = 'msg user'; d.textContent = text;
  $('msgs').appendChild(d); scroll();
}
function addPet(en, zh, words, opts = {}) {
  const d = document.createElement('div');
  d.className = 'msg pet' + (opts.typing ? ' typing' : '');
  if (opts.typing) {
    d.innerHTML = '<img class="msg-avatar" src="../assets/pet-character.png" alt=""><div class="msg-content"><span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span></div>';
  } else {
    const ws = (words || []).filter((w) => w && w.w);
    const hint = ws.length ? `<div class="ipa-hint">${ws.map((w) => `${esc(w.w)} ${esc(w.ipa || '')}`).join(' · ')}</div>` : '';
    d.innerHTML = '<img class="msg-avatar" src="../assets/pet-character.png" alt="">' +
      `<div class="msg-content"><div class="en">${renderEn(en, words)}</div>` +
      (zh ? `<div class="zh">${esc(zh)}</div>` : '') + hint + '</div>';
  }
  $('msgs').appendChild(d); scroll();
  return d;
}
function addErr(text) {
  const key = String(text);
  const last = $('msgs').lastElementChild;
  if (last && last.dataset.err === key) return; // 去重，避免重复刷屏
  const d = document.createElement('div');
  d.className = 'msg err'; d.dataset.err = key; d.textContent = text;
  $('msgs').appendChild(d); scroll();
}

function addSys(text) {
  const d = document.createElement('div');
  d.className = 'msg sys';
  d.textContent = text;
  $('msgs').appendChild(d); scroll();
}

// AI 助手操作请求：允许 / 拒绝
function renderAction(msgEl, action) {
  const bar = document.createElement('div');
  bar.className = 'actionbar';
  bar.innerHTML = `<span class="atool">🤖 ${esc(action.tool)}</span><span class="aarg" title="${esc(action.arg)}">${esc(action.arg)}</span>`;
  const allow = document.createElement('button'); allow.textContent = '允许'; allow.className = 'allow';
  const deny = document.createElement('button'); deny.textContent = '拒绝'; deny.className = 'deny';
  bar.appendChild(allow); bar.appendChild(deny);
  msgEl.appendChild(bar);
  scroll();
  allow.addEventListener('click', async () => {
    bar.remove();
    try {
      const r = await window.petAPI.assistantRun(action);
      addSys('🤖 ' + r.result);
    } catch (e) { addErr('助手执行失败：' + e.message); }
  });
  deny.addEventListener('click', () => { bar.remove(); addSys('已拒绝该操作'); });
}
function renderChoices(choices) {
  const box = $('choices');
  box.innerHTML = '';
  (choices || []).forEach((c) => {
    if (!c?.en) return;
    const b = document.createElement('button');
    b.className = 'choice';
    b.title = c.ipa || '';
    b.innerHTML = `<div class="en">${esc(c.en)}</div><div class="meta">${esc(c.zh)}</div>`;
    b.addEventListener('click', () => send(c.en));
    box.appendChild(b);
  });
}

// 悬停音标（消息区 + 预制回复）
document.addEventListener('mouseover', (e) => {
  const el = e.target.closest('.w');
  if (!el) { hideTip(); return; }
  const ipa = el.dataset.ipa, zh = el.dataset.zh;
  if (!ipa && !zh) return;
  const t = ensureTip();
  t.innerHTML = (ipa ? `<div class="ipa">${esc(ipa)}</div>` : '') + (zh ? `<div class="zh">${esc(zh)}</div>` : '');
  t.classList.add('show'); positionTip(e);
});
document.addEventListener('mousemove', (e) => { if (tip && tip.classList.contains('show')) positionTip(e); });

/* ---------------- 顶部快捷操作 ---------------- */
document.querySelectorAll('#quickActions .quick').forEach((btn) => {
  btn.addEventListener('click', async () => {
    const act = btn.dataset.act;
    if (act === 'pat') window.petAPI.action?.('pat');
    else if (act === 'feed') window.petAPI.action?.('feed');
    else if (act === 'listen') { if (!recording) startRec(); else finalize(); }
    else if (act === 'review') { $('vocab').classList.remove('hidden'); startReview(); }
    addSys(`已把「${btn.textContent.trim()}」告诉大肥鱼 🐳`);
  });
});

/* ---------------- 对话 ---------------- */
async function send(text) {
  text = String(text || '').trim();
  if (!text || busy) return;
  busy = true;
  $('input').value = ''; $('choices').innerHTML = '';
  addUser(text);
  const pending = addPet('', '', [], { typing: true });
  try {
    const reply = await window.petAPI.chatSend({ text });
    pending.remove();
    const pe = addPet(reply.en, reply.zh, reply.words);
    speak(reply.en);
    renderChoices(reply.choices);
    refreshMood();
    if (reply.action) renderAction(pe, reply.action);
  } catch (e) {
    pending.remove(); addErr(e.message || String(e));
  } finally {
    busy = false; $('input').focus();
  }
}
$('send').addEventListener('click', () => send($('input').value));
$('input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send($('input').value); }
});

/* ---------------- TTS ---------------- */
function speak(text) {
  if (!ttsOn || !text || !window.speechSynthesis) return;
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-US'; u.rate = 0.95;
    window.speechSynthesis.speak(u);
  } catch {}
}
$('ttsBtn').addEventListener('click', async () => {
  ttsOn = !ttsOn;
  $('ttsBtn').classList.toggle('on', ttsOn);
  if (!ttsOn) window.speechSynthesis?.cancel();
  await window.petAPI.configSet({ ttsEnabled: ttsOn });
});

/* ---------------- 麦克风：点击发送 / 上滑后点任意位置取消 ---------------- */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let rec = null, recCanceled = false, recFinal = '', recInterim = '', recStartY = 0, recording = false, cancelMode = false, finalized = false;

function setRecUI(on) {
  $('recStatus').classList.toggle('hidden', !on);
  $('input').classList.toggle('hidden', on);
  $('send').classList.toggle('hidden', on);
  $('mic').classList.toggle('rec', on);
}

function finalize() {
  if (finalized) return;
  finalized = true;
  const t = (recFinal + ' ' + recInterim).replace(/\s+/g, ' ').trim();
  try { rec?.stop(); } catch {}
  rec = null; recording = false; cancelMode = false;
  setRecUI(false);
  if (t && !recCanceled) send(t);
}

function startRec() {
  if (!SR) { addErr('语音识别不可用'); return; }
  recCanceled = false; recFinal = ''; recInterim = ''; cancelMode = false; finalized = false;
  rec = new SR();
  rec.lang = 'en-US'; rec.interimResults = true; rec.continuous = true;
  rec.onresult = (e) => {
    if (finalized) return;
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) recFinal += r[0].transcript + ' ';
      else recInterim = r[0].transcript;
    }
  };
  rec.onend = () => finalize();
  rec.onerror = () => {
    if (finalized) return;
    finalized = true; rec = null; recording = false; cancelMode = false;
    setRecUI(false);
    addErr('语音识别失败（可能没麦克风或未授权）');
  };
  try { rec.start(); } catch { rec = null; setRecUI(false); addErr('语音识别启动失败'); return; }
  recording = true;
  setRecUI(true);
  $('recHint').textContent = '再点一次发送 · 上滑取消';
}

// 点一下开始；再点一下立即发送（不等识别器收尾）
$('mic').addEventListener('click', (e) => {
  if (!recording) { recStartY = e.clientY; startRec(); }
  else { recCanceled = cancelMode; finalize(); }
});

window.addEventListener('mousemove', (e) => {
  if (!recording) return;
  cancelMode = recStartY - e.clientY > 60;
  $('recHint').textContent = cancelMode ? '点击任意位置取消' : '再点一次发送 · 上滑取消';
});

window.addEventListener('mousedown', (e) => {
  if (!recording || !cancelMode) return;
  if (e.target.closest('#mic')) return; // 点麦克风走上面的发送逻辑
  recCanceled = true;
  finalize();
});

/* ---------------- 欢迎语 ---------------- */
function greet() {
  if ($('msgs').childElementCount) return;
  const hello = {
    en: "Hmph! I am NOT a freeloader fat fish. ...Anyway, good morning, Master.",
    zh: '哼！我才不是吃白饭的大肥鱼。……总之，早上好，主人。',
    words: [
      { w: 'freeloader', ipa: '/ˈfriːləʊdə/', zh: '白吃白喝的人' },
      { w: 'anyway', ipa: '/ˈeniweɪ/', zh: '总之' }
    ]
  };
  addPet(hello.en, hello.zh, hello.words);
  speak(hello.en);
  renderChoices([
    { en: 'Good morning! I slept great.', zh: '早上好！我睡得很好。', ipa: '/ɡʊd ˈmɔːnɪŋ! aɪ slept ɡreɪt/' },
    { en: 'Morning! A bit sleepy though.', zh: '早！不过还有点困。', ipa: '/ˈmɔːnɪŋ! ə bɪt ˈsliːpi ðəʊ/' }
  ]);
}
