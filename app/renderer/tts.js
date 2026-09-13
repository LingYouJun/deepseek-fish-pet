/* 大肥鱼桌宠 · 朗读音色与风格选择 */
(function () {
  const STYLES = {
    tsundere: { rate: 1.02, pitch: 1.18, label: '傲娇少女（推荐）' },
    cute: { rate: 1.08, pitch: 1.28, label: '元气可爱' },
    gentle: { rate: 0.88, pitch: 1.08, label: '温柔小声' },
    cool: { rate: 0.96, pitch: 0.94, label: '清冷御姐' },
    custom: { rate: 1.0, pitch: 1.1, label: '自定义' }
  };
  const FEMALE_HINTS = ['aria','jenny','michelle','samantha','zira','hazel','eva','ava','emma','olivia','sophia','karen','victoria','moira','tessa','fiona','xiaoxiao','xiaoyi','huihui','xiaoqiu','female','woman','女'];
  const MALE_HINTS = ['david','mark','george','daniel','james','guy','ryan','alex','fred','male','man','男'];
  const NATURAL_HINTS = ['natural','online','neural','cloud','azure','edge'];
  function getVoices() {
    if (!window.speechSynthesis) return [];
    try { return window.speechSynthesis.getVoices() || []; } catch { return []; }
  }
  function scoreVoice(v, cfg) {
    const name = String(v.name || '').toLowerCase();
    const uri = String(v.voiceURI || '').toLowerCase();
    const lang = String(v.lang || '').toLowerCase();
    let s = 0;
    if (cfg && cfg.ttsVoice && (v.voiceURI === cfg.ttsVoice || v.name === cfg.ttsVoice)) s += 1000;
    if (NATURAL_HINTS.some((x) => name.includes(x) || uri.includes(x))) s += 90;
    if (FEMALE_HINTS.some((x) => name.includes(x) || uri.includes(x))) s += 55;
    if (MALE_HINTS.some((x) => name.includes(x) || uri.includes(x))) s -= 85;
    if (lang.startsWith('en-us')) s += 25;
    else if (lang.startsWith('en-gb')) s += 20;
    else if (lang.startsWith('en-au') || lang.startsWith('en-ca')) s += 17;
    else if (lang.startsWith('en')) s += 12;
    else if (lang.startsWith('zh')) s += 3;
    if (v.localService) s += 2;
    return s;
  }
  function bestVoice(cfg) {
    const voices = getVoices();
    if (!voices.length) return null;
    let best = null, bestScore = -Infinity;
    for (const v of voices) {
      const s = scoreVoice(v, cfg || {});
      if (s > bestScore) { best = v; bestScore = s; }
    }
    return best;
  }

  function speak(text, cfg, done) {
    if (!text || !window.speechSynthesis) { done?.(); return; }
    cfg = cfg || {};
    let finished = false;
    const finish = () => { if (finished) return; finished = true; done?.(); };
    const doSpeak = () => {
      try {
        window.speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(text);
        const voice = bestVoice(cfg);
        const style = STYLES[cfg.ttsStyle] || STYLES.tsundere;
        if (voice) u.voice = voice;
        u.lang = (voice && voice.lang) || 'en-US';
        u.rate = Number(cfg.ttsRate) || style.rate;
        u.pitch = Number(cfg.ttsPitch) || style.pitch;
        u.volume = 1;
        u.onend = finish;
        u.onerror = finish;
        window.speechSynthesis.speak(u);
      } catch { finish(); }
    };
    // Chromium 首次 getVoices() 可能为空，稍等 voiceschanged 后再读一次。
    if (getVoices().length) { doSpeak(); return; }
    let tries = 0;
    const timer = setInterval(() => {
      if (getVoices().length || ++tries >= 6) {
        clearInterval(timer);
        doSpeak();
      }
    }, 120);
  }

  function listVoices(cfg) {
    const voices = getVoices().slice();
    voices.sort((a, b) => scoreVoice(b, cfg || {}) - scoreVoice(a, cfg || {}));
    return voices;
  }

  window.DayuTTS = { STYLES, getVoices, listVoices, bestVoice, speak, voiceLabel: (v) => `${v.name} · ${v.lang || ''}` };
})();
