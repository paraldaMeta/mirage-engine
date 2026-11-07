# GPU CI 接入与证据

2026-11-07。工作流与证据归档已实现，待 GPU runner 首跑。当前 GitHub 仓库的 runner 列表为空。
开发分支为 `codex/mirage-gpu-ci`。MacBook Air 仅编辑源码和审阅差异。

## 接入测试机

使用专供 Mirage 的 macOS 或 Linux 测试机，安装桌面 Chrome、GPU 驱动、Git、tar，并为源码快照、依赖和证据预留磁盘。
Linux 的 runner 服务用户需要访问实际 GPU 设备；Chrome 的 WebGL2 硬件检查会记录设备、驱动和绘制读回结果。
在同一 GPU 上只运行一个 runner worker，验收期间避免另开 GPU 作业。

在仓库 Settings → Actions → Runners → New self-hosted runner 取得适合该系统的安装命令，使用 GitHub 当前 runner 版本（至少 2.327.1）。
在测试机注册时增加标签 `mirage-gpu`，并保留默认的 `self-hosted` 标签。按页面提示配置服务和网络出口。
本文的工作流只使用显式手动触发与 main 推送；代码审阅后由维护者选择候选分支运行。[GitHub runner 安装说明](https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/add-runners)

在 Settings → Secrets and variables → Actions → Variables 设置以下仓库变量。

| 变量 | 填写内容 |
|---|---|
| `MIRAGE_GPU_CHROME` | 测试机 Chrome 可执行文件的绝对路径。例如 Linux 的 `/usr/bin/google-chrome` 或 macOS 的 `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`。 |
| `MIRAGE_GPU_MACHINE_JSON` | [机器资料模板](acceptance/MACHINE.template.json) 的完整 JSON。用该测试机的实值填好全部 null，记录供电、节能和显示刷新率。 |
| `MIRAGE_GPU_CI_ENABLED` | 首跑后填写 `true`，以后每次 main 推送都会串行验收。手动运行可直接使用前两项变量。 |

首次合入默认分支后，Actions → GPU acceptance → Run workflow 选择需要验收的分支。
GitHub 手动触发要求工作流文件已存在于默认分支。提交 SHA 取本次 Actions 事件的 SHA，checkout 和验收结果必须一致。
已有开发候选需与这份工作流一起进入待测分支。[GitHub 手动运行规则](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow)

## 一次运行的过程

1. 每次 run ID 和 attempt 使用独立目录，先写启动记录，再检出精确提交。官方 Actions 固定到提交 SHA，项目验收固定 Node 22.22.0。
2. 现有 acceptance 归档 HEAD、创建独立源码快照并安装锁定依赖，然后检查硬件 WebGL2。软件渲染器或读回失败会停止本次验收。
3. 继续运行严格类型消费者、CPU／协议检查、七示例、固定步长、触屏、GPU 空闲、静帧、植被／河湾指标及人物图。各阶段复用原入口及阈值。[串行流程](ACCEPTANCE.md)
4. 成功或失败后收集本次已生成的日志、截图、原始指标、单文件 HTML、类型用例和源码归档，上传到 Actions artifacts。保留期为 30 天。

所有分支共用同一 concurrency group，最多一场正在执行，`queue: max` 最多保留 100 场等待任务。运行中的验收会保留至结束。
CI 包装层给验收 300 分钟，正常中断先交给原入口清理当前进程组；后续步骤有独立的证据上传时间。
runner 被强制关机、失去网络或任务被强制终止时，上传可能无法完成；恢复后可从该次 `$RUNNER_TEMP/mirage-gpu-<run-id>-<attempt>` 找回目录。[GitHub 并发配置](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency)

## 下载和读回

Actions 运行页面的 Summary 给出本次状态、证据数量和 artifact 下载链接。
artifact 名称带完整提交、run ID 和 attempt，同一次失败重跑也有独立证据。
解压后主要材料在 `upload/`，根目录另有 CI 启动日志作为收集失败时的备份。

| 文件或目录 | 内容 |
|---|---|
| `EVIDENCE.json` | 状态、提交、runner、工作流版本、文件路径、字节数和 SHA-256、截图索引。 |
| `PERFORMANCE.json` | 各场景原始测量步骤，包括平均／P95 帧时间、绘制调用和三角数；人物显隐对照；单文件字节数。每项保留来源报告路径。 |
| `acceptance/gpu.json` | Chrome 版本、GPU 设备／驱动、WebGL2 状态、实际 renderer 和读回结果。 |
| `acceptance/summary.json`、`acceptance/logs/` | 串行阶段、返回码、耗时和完整日志。 |
| `acceptance/types/` | NodeNext／Bundler 日志、类型消费者配置、锁文件和四包 tarball。 |
| `acceptance/workspace/examples/*/out/` | 原始报告、截图和拼图。 |
| `acceptance/workspace/examples/*/release/` | 本次生成的离线 HTML。 |
| `acceptance/source.tar`、`acceptance/REVIEW.md` | 本次源码和待人工填写的画面／设备验收表。 |

尚未运行到的阶段没有指标或截图，索引会显示已有数量。缺少必需证据、提交不匹配或收集失败时任务返回失败。
`machine-pass-pending-review` 表示该机器上的自动验收通过，`releaseReady` 保持 false。1.0 还需要画面确认、真手机／集显／浏览器矩阵和 A1 证据。

依赖目录和浏览器临时 profile 从上传清单排除，原始验收目录保留到 runner 的临时目录清理阶段。归档前可按 `EVIDENCE.json` 核对下载的证据。
