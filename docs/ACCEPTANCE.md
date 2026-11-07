# Mirage 测试机串行验收

截至 2026-11-07，入口和证据检查**已实现，待异机验证**。本轮只写源码、审阅差异；MacBook Air 不运行下面的命令。
当前开发状态见 [1.0 状态表](STATUS-1.0.md)。A1 仍是[单独主持的盲测](trials/a1/README.md)，不会被此入口启动。

## 准备

使用 macOS 或 Linux 测试机，Node 22.12+ 的 22.x、npm、Git、tar、可使用硬件 GPU 的桌面 Chrome。
暂不支持此入口在 Windows 运行。`CHROME` 是可执行文件的绝对路径，默认 macOS 标准安装位置。
机器上一次只运行一个验收任务，关闭其他 GPU 作业，记录供电、节能与显示器刷新率。

从累计开发分支 `codex/mirage-gpu-ci` 的干净 checkout 开始。无需先在源 checkout 安装依赖。
在仓库外的持久目录放机器资料，使用 [MACHINE.template.json](acceptance/MACHINE.template.json)，把 null 全部换成实际值。
目录示例不含空格，以兼容已有单文件工具。`--out` 的父目录必须存在，最终目录必须尚不存在。

```sh
git switch codex/mirage-gpu-ci
mkdir -p "$HOME/mirage-acceptance"
cp docs/acceptance/MACHINE.template.json "$HOME/mirage-acceptance/machine.json"
# 填好 machine.json 后，在测试机执行：
export CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
unset MIRAGE_BROWSER ONLY NODE_OPTIONS
npm run acceptance -- --run --machine "$HOME/mirage-acceptance/machine.json" --out "$HOME/mirage-acceptance/run-001"
```

不带参数或 `--help` 只显示用法；真正执行必须有 `--run`。脚本拒绝未提交修改，不会覆盖已有结果。
它把当前 HEAD 用 `git archive` 固定到新目录的 `source.tar`，再解包到 `workspace/`。
此目录是普通源码快照，不是 Git worktree；源 checkout 中的旧 dist、release、截图和 node_modules 均不带入。
随后在快照内执行 `npm ci`，需要包源可达或 npm 缓存已预热。记录提交、源码归档与锁文件 SHA-256、
Node/npm/Chrome、操作系统架构、填写的硬件信息，以及场景报告中实际返回的 GPU 名称。

GPU CI 已通过同一入口接入，runner 配置和 artifact 下载见 [GPU-CI.md](GPU-CI.md)。

## 固定顺序

| 顺序 | 检查与输出 |
|---|---|
| 前置 | 安装后检查 Chrome 实际硬件 WebGL2、GPU 设备、驱动和像素读回，保存 `gpu.json`；通过后再进入类型门槛。 |
| 0 | 打包后的[类型消费者检查](TYPES.md)：core／world／play／game 四包全部现有 JS 入口，NodeNext／Bundler 两种方式；先记录两者结果，再判定失败。已准备、未执行。 |
| 1 | 安装锁定依赖，`npm test`：各包检查、场景 schema/真实 JS 导入/错误诊断、挂点、人物动作、技能包。 |
| 2 | 全部带 playtest 的示例按目录发现并串行执行 e2e；当前七个。构建、网页试玩、garden-quest 通关、同一画布三轮会话销毁与挂载、打包、离线试玩。 |
| 3 | 雪屋 30–165 Hz 固定步长；已有触屏模拟、静止淡入与时钟、GPU 空闲／隐藏／节能检查。 |
| 4 | 院子五个光照机位静帧；均要求 sameFrameIndex 的 max 与 differing 为 0，缺一机位也失败。 |
| 5 | 林缘与河湾 medium 指标；人物 HTTP 与 file 各八张截图、显隐同机位性能对照。 |
| 6 | 读回本次报告：e2e 步骤齐全、两种交付均通过、模块与控制台无错误、截图非空；七个单文件均 ≤ 5,000,000 字节。 |

现有测试参数与阈值保持不变；详细含义见[第一批](FIRST-BATCH.md)、[河湾](../examples/river-ford/README.md)、[人物](CHARACTER-REVIEW.md)。
触屏模拟和无头帧计时不代替手机、集显热机和真浏览器的手动实测。软件渲染器不能作为硬件预算验收通过。

第 0 步对照已安装的 Rapier 0.19.3 官方声明，并要求 NodeNext 和 Bundler 均通过。可先独立运行 `npm run test:types -- --out <新目录>` 定位类型问题。整包步骤 2 的 garden-quest playthrough 会记录三轮生命周期数据，步骤 6 核对记录。详情见[类型交接](TYPES.md)和[资源归属](LIFECYCLE.md)。

## 如何读取结果

- `gpu.json` 保存硬件 WebGL2 预检查，无可用硬件时在此停止。
- `summary.json` 每步落盘，记录开始／结束、返回码、耗时、日志路径、原始报告位置与待办门槛。
- `logs/*.log` 保留完整输出，包含只有终端输出的雪屋、触屏和 GPU 检查。
- `types/` 保存打包消费者的编译日志、tarball、工具链与安装锁文件；该子目录的 node_modules 可在交接时移除。
- `workspace/out/e2e/summary.json` 是整包明细；各示例 `out/` 里有拼图、逐步图和指标，`release/` 有本次生成的 HTML。
- `workspace/examples/hello-courtyard/out/verify/` 保存五个光照机位。
- `workspace/examples/river-ford/out/character-http/` 和 `character-file/` 保存人物图与对照数据。
- `REVIEW.md` 是本次待填写的人工记录。将**整个 run-001 目录**交回；磁盘不够时可先删快照的 node_modules，保留其余证据与 source.tar。

返回 0 和 `machine-pass-pending-review` 表示本次桌面自动检查通过，仍需人工看图；`releaseReady` 始终为 false。
命令失败或缺报告返回 1，保留 `failed` 与出错位置。首次失败就停止，不继续叠加 GPU 负载；
日志能区分依赖／浏览器／端口故障与引擎断言，不能把环境故障当成产品通过。
每步限时 30 分钟，整包 e2e 限时 90 分钟。中断会记录 `interrupted`，并结束该步骤的子进程组。
强制断电／kill -9 后的 `running` 记录是不完整结果；检查并关闭该次遗留进程后再运行。
修复后提交代码，用 `run-002` 等新目录重跑；本版没有复用旧通过步骤的恢复模式。

## 其余门槛的验收顺序

1. 先处理此轮自动检查失败和人工看图发现的问题，每笔修复回到新目录复核。
2. 用同一修订在集显测试机再次运行，并记录真手机走／跑／转视角／交互、横竖屏与后台恢复。帧预算按预先约定的画质和分辨率记录。
3. 按既有浏览器方法复查 Firefox / WebKit；真 Safari 由设备持有人试玩。0.2.0 的历史报告不替当前修订背书。
4. 参考场景通过后再由主持人执行 A1。A1 固定 `db0759a` 的引擎输入与原控制器版本；若有修复要进入盲测，双方一起换新基线、新题卡版本并开新场次，不能一边热补丁。
5. 取得实际 GPU CI 首跑和失败归档证据，继续收敛公开 API、类型与 npm 发布准备。[CI 接入](GPU-CI.md)
