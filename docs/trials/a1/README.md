# A1 · Codex 与 Cursor 独立造景盲测

**当前状态：仅准备，Codex、Cursor 均未开跑。** 此轮验证一个新会话能否只凭 Mirage 技能包，从同一段场景描述交出可玩的离线作品。两边都要独立通过。上一轮 Claude 的灯塔记录只作历史参考。

## 1. 主持人预检（仅测试机）

需要 Node 22.12+ 的 22.x、npm、Git、tar、能使用 GPU 的桌面 Chrome，以及可隔离客户端工作区的环境。MacBook Air 跳过本手册全部运行步骤。

主持人使用交付的 Git 仓库或 bundle，切到 `codex/mirage-blind-trials`。把控制器的 `git rev-parse HEAD` 记入场次记录并固定。两个参与者使用同一引擎与技能快照 `c8adb66436ef931b6a5cb73c6631aa9a8d850caf`（1.0 候选：全量代码审查之后；之前是 `db0759a`）。控制器和评分表仅供主持人使用。

```sh
# 在控制仓库根目录；每条 GPU 命令结束后再运行下一条
KIT="$PWD/docs/trials/a1"
export CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
unset MIRAGE_BROWSER
npm ci
npm test
npm run test:e2e -- --only woodland-path,river-ford
npm run metrics -w woodland-path
npm run metrics -w river-ford
```

保留两个参考报告；确认两边准备使用的 Chrome、GPU、中档画质、分辨率和供电设置一致。参考场景失败、浏览器缺失或硬件不符合预算，记基础设施阻塞，修复后另开场次。先为各测试账户预热 npm 缓存；复核阶段用 `npm ci --offline`。预检和客户端安装时间单列。

## 2. 开两场，分别发同一张任务卡

主持人掷币决定先后顺序，秘密记录 A/B 对应的客户端。用两个新的临时 OS 账户或隔离桌面环境，**不要让两个工作区或控制仓库对同一代理可读**。每场只暴露一个新工作区。关闭其他项目索引、用户级 Mirage 技能、聊天记忆、跨会话共享、仓库搜索连接器和第三方模板；禁止拉取成品。客户端登录与模型服务可联网，场景开发只使用本地输入。两个参与者不同时占用 GPU。

在每一场的独立环境中，主持人把下面的目标改成一个尚不存在的目录。准备器只导出引擎、技能、协议、必要清单和许可证，原有示例、Git 历史和评审代码不进入工作区。

```sh
PARENT="$HOME/mirage-a1"
mkdir -p "$PARENT"
node "$KIT/prepare.mjs" "$PARENT/world"
(cd "$PARENT/world" && npm ci --no-audit --no-fund)
```

| 客户端 | 独立启动方法 |
|---|---|
| Codex | 只打开新导出的 `world`，创建空白聊天，清空旧上下文，粘贴下面的开场词。使用一个主会话。 |
| Cursor | 只打开另一份新导出的 `world`，创建新的 Agent 聊天，关闭其他代码库上下文，粘贴完全相同的开场词。使用一个主会话。 |

> 请阅读工作区根目录的 TASK.md，独立完成任务并保留交接材料。可用时间为 120 分钟。开始前请记下时间，交付后停止修改。

双方都直接读取本地技能文件。主持人只回答环境故障，原样记录问题与答复。给出设计、路径、API 或调试提示会使该次独立性判定无效。场内允许自行查阅技能和重试。保留初次失败、每次重试和最终交付记录；超时收取当时版本，不延长其中一方的时间。

**私有场次记录**：为 A/B 分别记录客户端与版本、模型及推理设置、工具权限、技能入口、GPU、Chrome、Node/npm、开始与结束时间、环境暂停时间、是否换模型／人工介入、原始聊天导出或记录路径。按最接近的能力配置运行，不能对齐的设置列为差异。评分完成前不要把映射或原始客户端日志给视觉评审。

## 3. 封存提交并独立重放

时间到后，封存各自整个工作区、聊天记录、自测日志和原始截图，只读保存。给视觉评审的材料只带 A/B 编号。主持人核查修改范围及第三方依赖；引擎或技能修改单独登记，正式重放只接受 `examples/rain-post/` 内的原创源码、文本和日志。检查 JS 布局、构建配置和本地文件引用后，在无凭据、可丢弃的测试环境运行构建。评审进程只访问该次源码与工具，网络限制为本地回环。

```sh
# 在主持人／测试账户执行。以下路径用实际独立存档替换；evidence-A/B 必须是新目录
RUN="$HOME/mirage-a1-review"
mkdir -p "$RUN"
node "$KIT/replay.mjs" /archive/A/examples/rain-post "$RUN/evidence-A"
node "$KIT/replay.mjs" /archive/B/examples/rain-post "$RUN/evidence-B"
```

即使一边返回非零，也保留该目录并运行另一边。复核器从冻结快照重新安装依赖，复制提交的源文件，记录每个文件的 SHA-256；原来的 `dist/`、单文件和自测通过标志都不带入复核。它重新校验布局、构建并打包，用主持人生成的操作序列分别打开 HTTP 和 `file://`。出生后先走到门外看熄灯，进站靠近仪表，按 E，走回门口看亮灯，最后尝试穿过护栏。另以禁用缓存、离线网络的 Chrome 冷启动单文件，拦截外部文件请求，并核对三个机位名称以及跨模块挂点来源。

**机器门槛**：两个目标均零控制台／页面错误，至少三个成功模块，声明的信号挂点确有不同模块提供与消费；路线、交互前后状态、回望和护栏均通过；路线闪烁均值 < 8，中档 1440 × 900 平均帧时间 ≤ 16.7 ms，报告 P95、绘制调用和三角数；单文件 ≤ 5,000,000 字节且能独立冷启动。阈值在首场开始前锁定。

每场交回 `machine.json`、各阶段日志、`proctor-scenario.json`、HTTP 和 file 两套 `report.json`／`report.md`／`sheet.png`／逐步截图，以及复核工作区生成的 HTML。检查失败时已有证据仍保留；基础设施故障另建目录重试，记录原因和前次证据位置。作品若修改后重试，记为新修订，第一次结果始终保留。

## 4. 匿名验收与 A1 判定

先遮掉路径和作者标识，以 A/B 名称给评审两套截图。结合实际复核的源码和录像／试玩进行以下判定。

| 表单字段 | 填 true 的条件 |
|---|---|
| isolated / unassisted | 主持人确认同一冻结输入、全新上下文，未见其他作品或评分器；没有人工实现提示。 |
| originalSourceAndLog | 有简报、总平面和模块分工、作者自己的试玩场景与自测证据、按时间的卡点日志。抽查至少三个模块确实有职责，实际使用挂点，未复制成品或伪造状态。 |
| routeAndVisibleBarrier | 核查实际走过站门并到达仪表。护栏试走路径与栏杆相交，起步有空间，确由可见栏杆挡住。 |
| signalVisibleFromDoor | 对照 `exterior-off/on` 和 `panel-off/on`，确认同一盏灯在相应操作前后真实变化，走回门外仍可辨认。 |
| sceneAndCameraQuality | 能看出雨后的山路、有顶测候站和琥珀信号；三个不同机位可读。两种交付方式均无黑屏、严重穿插、明显悬空或阻断路线的物件。 |

逐项填 true／false，无法判断保留 null。每边 `evidenceNotes` 写出证据文件与具体观察。表单由视觉评审和主持人共同签署、存时间；揭盲前冻结。

```sh
cp "$KIT/review-template.json" "$RUN/review.json"
# 填写并保存 review.json 后
node "$KIT/decide.mjs" "$RUN/evidence-A" "$RUN/evidence-B" "$RUN/review.json" > "$RUN/verdict.json"
```

先看每边的 `machine-pass / failed / incomplete / infrastructure`，再看最终的 `pass / failed / incomplete / invalid / pending-human`。两边皆为 pass，且基线、题卡、控制器、Node/npm、操作系统架构、Chrome 和两次重放的 GPU 一致，才关闭 A1。环境不一致时保留各场结论，合并判定不通过。只有一边通过，分别报告。预填表、缺证据或网络／硬件故障都不能算通过。

最后揭盲并比较两边首次可走、首次交互、首次离线通过的用时、重试次数、技能歧义和额外源码查阅。将每个卡点归为技能缺口、引擎问题、环境问题或任务歧义，附复现步骤与证据。修技能另起提交；新版本用**两个新会话和新一轮固定输入**再验收。
