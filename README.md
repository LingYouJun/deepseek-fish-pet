# 大肥鱼桌宠 · DeepSeek Fish Pet

二创「吃白饭的大肥鱼」蓝发鲸鱼女仆桌宠。Electron 透明悬浮窗 + 英语陪练 + DeepSeek 对话 + 记忆/生词/心情系统。

## 目录结构

```
deepseek-fish-pet/
├─ app/                  # Electron 源码
│  ├─ main.js            # 主进程：窗口、托盘、菜单、IPC、桌宠移动模式
│  ├─ preload.js         # 安全桥
│  ├─ src/               # LLM / 记忆 / 心情 / 生词 / 网页助手 / DSH 联动
│  ├─ renderer/          # 桌宠窗口与聊天窗口 UI
│  ├─ assets/            # 立绘素材（pet-character.png 已裁剪透明边）
│  └─ persona.json       # 默认人设（可被用户配置覆盖）
├─ ref/                  # 形象参考图
├─ design-mockup.html    # 设计概念稿
└─ 立绘交接说明.md
```

## 主要功能

- 透明无边框置顶桌宠，拖动移动、位置记忆
- 单击摸头/戳身体/戳尾巴有不同反应与粒子特效
- 双击打开投喂面板；悬停出现快捷 Dock（聊天 / 摸摸 / 投喂 / 收音）
- 右键菜单：打开对话、投喂、模式（原地待机 / 跟随鼠标 / 自动散步）、大小、回到屏幕中央、退出
- 系统托盘：隐藏/显示、打开对话、退出
- 独立聊天大窗：英文对话 + 中文翻译 + 音标 + 2 个预制回复
- 可调 TTS 朗读：自动优先自然女声，内置傲娇少女/元气可爱/温柔小声/清冷御姐等音色风格
- 语音识别录入、生词本复习
- 三层记忆、心情/好感度、DSH 会话联动
- 可选 AI 助手：只读 / 常规 / 网页操控（需安装 Playwright 浏览器）

## 开发运行

```powershell
cd D:\project\大肥鱼桌宠\deepseek-fish-pet\app
npm install
npm start
```

首次启动没有 API Key 时会自动打开绑定窗口，也可以先点「稍后再说」使用本地预制问候。

## 构建

```powershell
cd D:\project\大肥鱼桌宠\deepseek-fish-pet\app
npm install
npm run dist:release
```

安装包输出到：

```
D:\project\大肥鱼桌宠\release
```

如果只想生成未打包目录：

```powershell
npm run pack
```

## 素材替换

直接替换 `app/assets/pet-character.png` 即可（透明底 PNG，人物居中、底部贴边）。更完整说明见 `立绘交接说明.md`。

## 协议

MIT
