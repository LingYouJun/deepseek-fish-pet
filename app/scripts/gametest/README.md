# gametest —— 离线/在线测试台（去 Electron 依赖后的约定）

> ★本文件是给 lead 看的接口约定★：帧怎么给、OCR 放哪、clicks.jsonl 怎么按批次读。
> ★跑分不需要我起 Electron✗★（`--no-sandbox` 已由 lead 验证可起窗 ✓）。

## 1. 帧 + OCR 的输入约定（`score.js --frames=<目录> --ocrDir=<目录>`）

| 项 | 约定 |
|---|---|
| 帧图 | `<frames>/fNNN.png`（`f000.png`、`f001.png`… 三位数字从 000 起 ✓），**必须 1920x1080**、物理像素 ✓ |
| OCR JSON | `<ocrDir>/ocr-fNNN.json`（与帧**同名**、前缀 `ocr-` ✓ 一一对应 ✓）；不给 `--ocrDir` 时脚本会自己试着调 OCR ✓（本机会话里 Node→PowerShell 不可靠 ✗，建议给 ✓） |
| JSON 结构 | `{ok, imgW, imgH, text, lines:[{text, words:[{t,x,y,w,h}]}]}` —— ★字段名是 `t`✗不是 text；坐标在 x/y/w/h 上、不在 boundingRect 里 ✓；单位=截图像素（本机=物理 ✓）★ |
| 真值 | `layout.js`（**唯一来源** ✓ 由 `score.js` 直接 `require` ✓ 不手抄 ✓）；帧必须是 `render.html` 渲染出来的（`render.js` 由同一份 layout.js 生成 ✓） |
| 编码 | JSON 用 **UTF-8 无 BOM**（`[IO.File]::WriteAllText(..., UTF8Encoding($false))` ✓；带 BOM 也能读 ✓ 脚本会 strip ✓） |
| 其它参数 | `--tolPx=6`（命中容差 ✓）、`--perClass=N`（每类抽多少个 ✓ 982 默认全跑 ✓） |
| 输出 | `C:\deepseek\gametest\score.json`（分类通过率 + 中心误差 + 逐行 verdict ✓：`ok`/`wrong`/`notfound`/`ambiguous` ✓） |

批量 OCR 的命令（一次搞定一个目录）：
`foreach ($f in Get-ChildItem <frames> -Filter *.png) { powershell -File app\scripts\gametest\shoot-ocr.ps1 -Png $f.FullName -Out "<ocrDir>\ocr-$($f.BaseName).json" }`

## 2. 真点击测试（`window.js` + `clicks.jsonl`）

启动（★由 lead/主人执行 ✓ 我不起 ✗★；`--no-sandbox` 是关键 ✓）：
```
Start-Process electron.exe -ArgumentList "--no-sandbox","<repo>\app\scripts\gametest\window.js","--user-data-dir=C:\deepseek\gametest\ud-live"
```
· 一启动即就绪 ✓（无边框 1920x1080 置顶 ✓）；★ESC 立即关窗✗★ ✓；独立 `--user-data-dir` ✓（不抢她的单实例锁 ✓）。
· 窗口布局 = `layout.js` ✓（102 个元素 ✓：文字 42 / 纯图形 30 / 同名重复 12 / 小按钮 12 / 贴边 6 ✓ + 2 个无按钮区 ✓）。

### `clicks.jsonl`（窗口自己写 = 真值 ✓）
| 字段 | 说明 |
|---|---|
| `batch` | ★批次号★ = 该次启动的时间戳（毫秒 ✓）。**同一批的所有行 batch 相同** ✓ 便于按批读 ✓ |
| `kind` | `'batch-start'`（启动时写入的第一行 ✓ 带 layout 计数与屏幕尺寸 ✓）或 `'click'` ✓ |
| `t` | 点击时刻（ms 时间戳 ✓） |
| `id` | ★被点到的元素 id★（如 `B012` ✓）= 真值 ✓；点空白处则本行不产生（页面只对 `.btn` 记录 ✓） |
| `label` / `class` | 该元素的文字/分类 ✓（便于直接判"点到谁" ✓） |
| `x`,`y` | 窗口内坐标（= 物理坐标 ✓ 因为窗口在 (0,0) 且 1920x1080 ✓） |
| `sx`,`sy` | 屏幕坐标 ✓ |

· **清空/分批**：每次启动 **会清空** `clicks.jsonl` 并写一行 `batch-start` ✓ → ★一批 = 一次启动 = 一个 batch 号★ ✓；要保留上一批请先拷贝该文件 ✓。
· 真值判据（lead 侧）：拿 locate 给出的目标 id 与 `clicks.jsonl` 里同 `batch` 的最后一条 `id` 比对 ✓ —— ★正好落在目标上才算过✗★ ✓；报"成功"但没有对应行 = **假成功**✗ ✓（必须为 0 ✓）。
· 布局真值快照：启动时同时写 `C:\deepseek\gametest\layout-snapshot.json` ✓（与窗口画面同源 ✓ 便于复核 ✓）。

## 3. 我不做什么
· ★不起任何 Electron✗★（抓帧/真点击都由 lead 侧执行 ✓）；不改产品代码 ✓；不放宽任何闸门 ✓。
· 跑分脚本：`score.js`（离线帧 ✓）/ `lattice-small.js`（格距+相位实验 ✓ 现明确报"量不出"✓）/ `notfound-table.js`（text 未命中逐条 ✓）/ `verify-round.js`（防误配 + icon 单格根因 ✓）/ `zoomocr.js`（裁剪放大对比 ✓）。
