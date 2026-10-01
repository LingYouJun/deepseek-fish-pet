const { app } = require('electron');
const path = require('path');
const fs = require('fs');

const file = () => path.join(app.getPath('userData'), 'config.json');

/* 记忆系统参数（全部可在 config.json 里覆盖，改参数不用改代码） */
const MEMORY_DEFAULTS = {
  mediumKeep: 20,        // 中期记忆保留条数
  longKeepDays: 20,      // 日记保留天数
  promoteWeight: 7,      // 权重达到多少就晋升为「永久记忆」
  candDays: 14,          // 候选多少天没再出现就开始衰减
  candDecay: 0.8,        // 衰减系数
  candFloor: 1,          // 权重低于此值从候选池清掉
  skillCandDays: 21,     // 技能经验候选多少天没出现开始衰减
  skillPoolMax: 200,     // 共有技能经验池最多留多少条（超了按权重低的淘汰）
  skillFileWeight: 4,    // 技能经验权重到多少就归档进技能文件夹
  skillArchiveMax: 2,    // 每次最多归档几条经验（防启动时一口气烧太多 token）
  skillArchiveCalls: 10, // 一次归档总共最多几次模型调用（硬上限）
  skillAutoArchive: true,// 启动时自动把攒够权重的经验归档进技能
  projRunTimeout: 60000,  // 执行脚本的超时（毫秒），到点强制结束
  screenWarm: true,      // 启动时预热屏幕流（首帧更快；不想让系统一直显示"正在捕获"就设 false）
  historyTokens: 3000,   // 历史按 token 预算保留（省 token：老回合本来就会压缩成 EN: 一行，砍短体感无损）
  fullTurns: 3,          // 最近几轮助手回复保留完整格式（格式锚）
  toolResultChars: 250,  // AI 助手执行结果入库时的截断长度（太长会把真实对话挤出历史）
  inject: {              // 每轮注入上下文的数量/长度
    permanentFacts: 20,
    longDays: 3,
    mediumCount: 4,
    longChars: 200,
    mediumChars: 200,
  },
};

/* 发音评测（"像不像"）参数 —— **全部可被 config.json 覆盖，一个都不写死**
 * 依据：发音评测可行性-20261001.md 的实验结论
 *   · 只能用"逐词相对分 S = 该词代价 / 其它词均值"，**绝对分不可用**（换音色 4.014 > 换词 3.033）
 *   · 真错词 S≈4.52 排第1；只换音色时最大 S≈1.24 且平坦 → 阈值取 2.0
 *   · 前端消融里 CMN(丢掉第0维) 略优，所以默认 dropC0=true
 *   · 阈值 2.0 只来自单句 12 词、且音色差异是模拟的 → 之后必然要按真人样本调，故全部外置 */
const PRON_DEFAULTS = {
  enabled: true,        // 总开关
  threshold: 2.0,       // S 大于此值判为"可疑的词"
  frameMs: 25,          // MFCC 窗长（毫秒）
  hopMs: 10,            // 帧移（毫秒）
  nfft: 512,
  nmel: 26,             // Mel 滤波器个数
  ncep: 13,             // 倒谱系数维数
  preemph: 0.97,        // 预加重
  fmin: 0,              // Mel 下限 Hz
  fmax: 8000,           // Mel 上限 Hz（16kHz 采样 → 奈奎斯特）
  cmn: 'mean',          // 倒谱归一化：none | mean | meanvar
  dropC0: true,         // 丢掉第 0 维倒谱（= 不把音量当特征，实验里略优）
  dtwBand: null,        // DTW 带宽约束：null=不限；数字=带宽占对角线比例
  minWordFrames: 3,     // 词至少几帧才参与打分（短词方差大，如 "I"）
  speechFloorDb: -45,   // 低于此能量当静音
  refMaxChars: 200,     // 参考句超过这个长度就不处理
};

const DEFAULTS = {
  apiBase: 'https://api.deepseek.com/v1',
  apiKey: '',
  model: 'deepseek-flash',   // DeepSeek-V4.1-Flash（旧名 deepseek-chat 请勿再用：不在现价目表内）
  ttsEnabled: true,
  ttsVoice: '',
  ttsStyle: 'tsundere',
  ttsRate: 1.02,
  ttsPitch: 1.18,
  vocabLevel: 'high_school',
  assistant: 'off',
  petMode: 'interact',   // interact = 交互模式（点热区出动作，不拖不戳）| chat = 聊天模式（可拖可戳）
  petLinesMajorP: 0.85,  // 关键人格换了 → 让 AI 全量重写交互台词的概率
  petLinesMinorP: 0.2,   // 只是微调人设 → 小概率顺手改几句
  petLinesMinorN: 6,     // 小改时最多改几个部位
  // 视觉模型（可选）：用于"看懂屏幕"，会花 token。默认关闭，关闭时退回本地 OCR（免费）。
  visionEnabled: false,
  visionBase: '',
  visionKey: '',
  visionModel: 'deepseek-flash',
  asrEngine: 'auto',     // auto | whisper | webspeech
  asrModel: 'base.en',   // tiny.en | base.en | small.en（默认 base.en：tiny 太不准，口语练习会误判）
  asrVad: true,          // 装了就启用 VAD 只处理语音段：实测免幻觉 + 快 53%（模型缺自动跳过）
  asrVadThreshold: 0.5,  // VAD 灵敏度 0~1，越高越严格（说话轻就调低）
  speakGoodP: 0.8,       // 口语打分：p ≥ 此值 = 绿（读得清楚）
  speakOkP: 0.55,        // p ≥ 此值 = 黄（一般），再低 = 红（含糊）
  speakPosBias: true,    // 句首偏差补偿（第 1~2 个词天然偏低，给一点点补偿）
  vocabAutoAdd: true,    // 读得含糊的词自动进生词本
  memory: MEMORY_DEFAULTS,
  pron: PRON_DEFAULTS,   // 发音评测（"像不像"）的全部参数，见上
};

const deepMerge = (base, over) => {
  const out = { ...base };
  for (const k of Object.keys(over || {})) {
    const v = over[k];
    out[k] = (v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object' && !Array.isArray(base[k]))
      ? deepMerge(base[k], v) : v;
  }
  return out;
};

function load() {
  let saved = {};
  try { saved = JSON.parse(fs.readFileSync(file(), 'utf8').replace(/^\uFEFF/, '')) || {}; } catch {}
  const merged = deepMerge(DEFAULTS, saved);
  merged.memory = deepMerge(MEMORY_DEFAULTS, saved.memory || {});   // 旧配置没有 memory 字段也能补齐
  merged.memory.inject = deepMerge(MEMORY_DEFAULTS.inject, (saved.memory && saved.memory.inject) || {});
  merged.pron = deepMerge(PRON_DEFAULTS, saved.pron || {});         // 发音评测参数同样两级合并
  return merged;
}

function save(patch) {
  const next = deepMerge(load(), patch || {});
  try { fs.writeFileSync(file(), JSON.stringify(next, null, 2)); } catch {}
  return next;
}

module.exports = { load, save, DEFAULTS, MEMORY_DEFAULTS, PRON_DEFAULTS, file };

