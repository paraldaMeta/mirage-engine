# Mirage → 1.0 当前状态

更新：2026-11-10（第二轮）。版本号已由所有者定为 1.0.0。Codex 的累计链和第一轮审查修复已合入 main（PR #1、#2）。
第二轮在分支 `claude/mirage-1.0-finish` 上：林缘地平线、全量代码审查（34 条全部修掉，每条带在旧代码上会失败的检查）、
第一轮遗留的 #12–#24。测试机 Mac mini M4 Pro、Chrome 156、ANGLE Metal。证据：[run-006](acceptance/runs/2026-11-09-run-006/REVIEW.md)，
提交 `f05ccca`，状态 `machine-pass-pending-review`：18 个自动步骤全部通过，人工项待所有者确认。

| 工作 | 当前状态 | 证据／下一步 |
|---|---|---|
| 60 Hz 固定物理、镜头插值与输入保留 | **测试机通过** | `fixed-step`：雪屋门口 30–165 Hz 终点完全相同（修复台阶边悬空后多走进 19 cm），镜头误差 0，存档误差 3e-6 m；台阶 38 / 38 两种路径，最慢一条从 93 % 提到 98–99 %。离开开始界面的那个键现在只负责开始（行为变化，已写进 CHANGELOG）。 |
| 场景 schema 与校验 CLI | **测试机通过** | `npm test`：7 个示例布局都通过，所有无效字段都按字段报出。 |
| 模块必需／可选挂点 | **测试机通过** | `world/check.mjs`；审查补了 finalize 失败的隔离和同名模块。 |
| 共用植被、林缘小径 | **自动通过，画面待看** | playtest 8 / 8，medium 3.68 ms、35.7 万三角，单文件 0.89 MB。地平线的灰带已改成没入雾气的远处树林（run-006）。 |
| 地形、水面、河湾浅滩 | **自动通过，画面待看** | playtest 8 / 8，medium 3.17 ms、18.1 万三角，单文件 0.88 MB。 |
| 自然比例旅行者 | **自动通过，画面待看** | 八张图齐；显示和隐藏人物差 +0.04 ms、+2 次绘制、+5,416 三角。 |
| 统一生命周期与重复挂载 | **测试机通过** | garden-quest lifecycle 三轮：几何 49、贴图 33 不增长，旧循环不再响应；`npm test` 覆盖启动回滚。修了 Rapier 释放时抛错（角色过滤器回调 Rapier），这个 bug 让 Codex 链的 `npm test` 失败。 |
| 四个运行时包类型声明 | **测试机通过** | `types-consumer`：NodeNext 和 Bundler 打包消费者编译通过。之前各有 4 个错误（`createPlay` 丢了自定义 walker 的类型），已修。 |
| Rapier NodeNext 类型兼容 | **测试机通过** | 同上。 |
| 测试机串行验收与证据目录 | **测试机通过** | run-001 到 run-005；预检查适配 Chrome 156（没有 `webgl2` 状态键）。 |
| e2e 七个示例 | **测试机通过** | 29 / 29（run-004、run-005、run-006）。run-003 偶发的"读档位置差 14.5 cm"是角色悬在台阶边上：自动上台阶抬起却没送上去，`place()` 也会把圆柱放进旁边更高的台阶。已修（`e668558`），节点用例 84 个终点从 17 个悬空降到 0；场景里 30 个终点都落在地面；通关脚本连跑 4 次加 run-005 都通过。 |
| 触屏模拟、静帧淡入、GPU 负载、院子五个光照静帧一致 | **测试机通过** | `touch`、`still-pop`、`gpu-load`、`still-identity`。 |
| Codex / Cursor 从零造景 A1 | **A 场已跑、复核 machine-pass；B 场未跑** | 两边用同一引擎快照 `c8adb66`。A 场用时 14 分钟（上限 120），没有人工介入，`examples/rain-post/` 以外零改动。`replay.mjs`（控制器 `457a880`）复核结果：HTTP 和 file 都通过，medium 3.40 / 3.32 ms，单文件 3.19 MB，离线冷启动通过。与规程的偏差（同一 OS 账户、客户端沙箱关闭）记在主持人私有记录里。A／B 和客户端的对应在评分前保密。下一步：B 场 → 匿名视觉评审 → `decide.mjs`。 |
| 手机真机与集成显卡 | 待实测 | 没有设备；所有者决定这次不做。 |
| Firefox / WebKit / Safari | **Firefox、WebKit 通过；真 Safari 不测** | [复测记录](acceptance/runs/2026-11-09-browsers/README.md)，`457a880`：七个示例两种引擎全部通过，错误为 0。已知问题：WebKit 下 garden-quest 偶发台阶处「走不动」，main 15 次里 2 次、分支 19 次里 2 次，不是这次的回归，单列为后续问题。真 Safari 由所有者决定这次不测；只测了 Playwright 自带的 WebKit，它和 Safari 不完全相同。 |
| GPU CI | 工作流在，仓库没有 runner | 所有者决定暂不注册自托管 runner（公开仓库的安全考虑）。 |
| 公开 API、npm 包名与发布文档 | 稳定性划分已写（[api.md](api.md)），包名暂定 `@mirage/*` | `npm run test:pack` 通过；`"./*"` 子路径白名单未定；npm 上 `mirage-engine` 已被占用。`@mirage` scope 能不能用，要所有者登录 npm 后确认，不行再换。 |

还要做的：所有者看图（林缘、河湾、人物）→ A1 的 B 场和匿名评审 → 确认 `@mirage` scope 和子路径白名单 → 打 tag。手机真机、集显、真 Safari 和 GPU CI 由所有者决定这次不做。
每一条"待验收"只能用同一修订的报告和实际观察来关闭。
