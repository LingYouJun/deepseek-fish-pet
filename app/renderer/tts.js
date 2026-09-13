/* 大肥鱼桌宠 · Edge 神经语音（晓晓 / 晓伊 / 云希 / 云扬） */
(function () {
  const STYLES = {
    tsundere: { rate: 1.02, pitch: 1.12, label: '傲娇少女（推荐）' },
    cute: { rate: 1.08, pitch: 1.22, label: '元气可爱' },
    gentle: { rate: 0.90, pitch: 1.04, label: '温柔小声' },
    cool: { rate: 0.96, pitch: 0.94, label: '清冷御姐' },
    custom: { rate: 1.0, pitch: 1.0, label: '自定义' }
  };

  const EDGE_VOICES = [
    { name: '晓晓（女，温柔）', voiceURI: 'zh-CN-XiaoxiaoNeural', lang: 'zh-CN' },
    { name: '晓伊（女，活泼）', voiceURI: 'zh-CN-XiaoyiNeural', lang: 'zh-CN' },
    { name: '云希（男，阳光）', voiceURI: 'zh-CN-YunxiNeural', lang: 'zh-CN' },
    { name: '云扬（男，沉稳）', voiceURI: 'zh-CN-YunyangNeural', lang: 'zh-CN' }
  ];
  const DEFAULT_VOICE = 'zh-CN-XiaoxiaoNeural';
  let currentAudio = null;
  let speakSeq = 0;

  function getVoices() { return EDGE_VOICES.slice(); }
  function listVoices() { return EDGE_VOICES.slice(); }
  function bestVoice(cfg) {
    const id = (cfg && cfg.ttsVoice) || '';
    return EDGE_VOICES.find((v) => v.voiceURI === id) || EDGE_VOICES[0];
  }

  function stop() {
    speakSeq++;
    if (currentAudio) {
      try { currentAudio.pause(); currentAudio.src = ''; } catch {}
      currentAudio = null;
    }
    try { window.speechSynthesis?.cancel(); } catch {}
  }

  function speak(text, cfg, done) {
    if (!text) { done?.(); return; }
    cfg = cfg || {};
    stop();
    const seq = ++speakSeq;
    let finished = false;
    const finish = () => { if (finished) return; finished = true; done?.(); };
    const style = STYLES[cfg.ttsStyle] || STYLES.tsundere;
    const voice = bestVoice(cfg);

    if (window.petAPI && window.petAPI.edgeTts) {
      window.petAPI.edgeTts({
        text,
        voice: voice.voiceURI,
        rate: Number(cfg.ttsRate) || style.rate,
        pitch: Number(cfg.ttsPitch) || style.pitch,
        style: cfg.ttsStyle || 'tsundere'
      }).then((res) => {
        if (seq !== speakSeq) return;
        if (!res || !res.ok || (!res.dataUrl && !res.url)) throw new Error((res && res.error) || 'Edge TTS 合成失败');
        const audio = new Audio(res.dataUrl || res.url);
        if (seq !== speakSeq) return;
        currentAudio = audio;
        const audioDone = () => {
          if (currentAudio === audio) currentAudio = null;
          finish();
        };
        audio.onended = audioDone;
        audio.onerror = audioDone;
        audio.play().catch(audioDone);
      }).catch((err) => {
        console.warn('[EdgeTTS]', err);
        finish();
      });
      return;
    }

    // 仅在开发环境没有 preload 时兜底；正式包不会走这里。
    if (window.speechSynthesis) {
      try {
        const u = new SpeechSynthesisUtterance(text);
        u.lang = 'zh-CN';
        u.rate = Number(cfg.ttsRate) || style.rate;
        u.pitch = Number(cfg.ttsPitch) || style.pitch;
        u.onend = finish;
        u.onerror = finish;
        window.speechSynthesis.speak(u);
      } catch { finish(); }
    } else finish();
  }

  window.DayuTTS = {
    STYLES,
    EDGE_VOICES,
    getVoices,
    listVoices,
    bestVoice,
    speak,
    stop,
    voiceLabel: (v) => `${v.name || ''} · ${v.lang || ''}`
  };
})();
