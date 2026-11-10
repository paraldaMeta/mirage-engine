# Firefox / WebKit 复测 · 2026-11-09

- 提交：`457a880`（分支 `claude/mirage-1.0-finish`），七个示例的 `dist/` 用这个提交重新构建
- 测试机：Mac mini M4 Pro，macOS 26.6.2
- 浏览器：Playwright 1.65.0 的 WebKit（webkit-2388）和 Firefox（firefox-1572），headless
- 跑法：`MIRAGE_BROWSER=webkit|firefox MIRAGE_PLAYWRIGHT=<playwright/index.js>`，在示例目录跑 `playtest.mjs <场景> dist`
- 真 Safari：没测。safaridriver 要求在 Safari 设置的「开发者」里打开「允许远程自动化」，所有者 2026-11-10 决定这次不测真 Safari

| 示例 | WebKit 步骤 · 错误 · 警告 · frameMs | Firefox 步骤 · 错误 · 警告 · frameMs |
|---|---|---|
| hello-courtyard | 14/14 · 0 · 0 · 3.13 | 14/14 · 0 · 18 · 3.01 |
| walled-garden | 18/18 · 0 · 0 · 3.70 | 18/18 · 0 · 23 · 3.30 |
| garden-quest | 9/9 · 0 · 1 · 3.57（见下） | 9/9 · 0 · 23 · 3.59 |
| agent-trial | 17/17 · 0 · 1 · 3.52（复测） | 17/17 · 0 · 24 · 3.51 |
| snow-hut | 19/19 · 0 · 1 · 4.44 | 19/19 · 0 · 27 · 3.71 |
| river-ford | 8/8 · 0 · 0 | 8/8 · 0 · 14 |
| woodland-path | 8/8 · 0 · 0 | 8/8 · 0 · 16 |

- 和 0.2.0 比：Firefox 的 agent-trial 和 snow-hut 当时各有两步失败（playtest 把警告算进 `errors`），这次都通过，错误为 0。
  Firefox 的警告还是那几类，不是引擎能修的：three.js 着色器信息日志、`KHR_parallel_shader_compile` 不支持、
  `WEBGL_debug_renderer_info` 已弃用。WebKit 唯一的警告是 Rapier 初始化参数的弃用提示。
- agent-trial 在 WebKit 第一次量到 10.61 ms（这个场景的门槛是 < 8 ms），当时同机有别的 GPU 工作；GPU 空闲时复测 3.52 ms，通过。

## 已知问题：WebKit 下 garden-quest 偶发「走不动」（不是这次的回归）

`walkTo: stuck … (no progress for 2.5 s)`。同一份构建、同一个 playtest 工具，main（`d50cd3f`）和分支交替跑：

| 构建 | 次数 | 卡住 | 位置 |
|---|---|---|---|
| main `d50cd3f` | 15 | 2 | 亭子台阶 (0, 1.67, −5.71)；亭子门前 (0, 3.31, −18.09) |
| 分支 `457a880` | 19 | 2 | 去钥匙的路上 (−12.78, 0.07, 16.64)；亭子台阶 (−0.01, 1.67, −5.71) |
| Chrome（分支） | 2 + e2e 全部 | 0 | — |

main 和分支在同一个台阶位置卡住过，所以是之前就有的问题，不是第二轮修改引入的。卡住时画面正常（61 fps），前方没有障碍物。
还没查清是 WebKit 下帧间隔不同、让角色偶尔卡在台阶边上（真实 Safari 用户也可能遇到），还是 headless WebKit 停顿超过 2.5 s 被工具误判。
单列为后续问题。
