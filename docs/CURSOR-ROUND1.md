# Cursor 第一轮：查 bug 和测试

> 把下面「给 Cursor 的话」整段粘进 Cursor 的 Agent 对话框（工作区打开本仓库根目录）。

## 给 Cursor 的话

你在 Mirage 仓库里（three.js 0.186，纯代码世界引擎，Node 22+，npm workspaces）。这一轮**只查 bug 和补测试**，不加新功能，不重构。

**先读**：`README.md`、`CONTRIBUTING.md`、`docs/CURSOR-TASKS.md` 的「共同规则」、`docs/world-protocol.md`、各包 README，以及 `docs/M1-notes.md` 到 `docs/M5-notes.md` 里的 open problems / not done。

**做事规则**
- 每个问题开一个分支（`fix/<短名>` 或 `test/<短名>`），一个问题一个提交，提交信息写：现象、原因、改法、怎么验证、数字。
- **不要推 main，不要强制推送，不要改仓库设置**。做完开 Pull Request，或者只在本地留分支，等作者看。
- 代码尽量少：先写能复现问题的测试，再改最少的代码让它通过。故意简化处写 `// ponytail:` 注释。
- 不复制 Golden Temple 的代码；不放任何真实城市或地方特色内容；新素材只收 CC0 并记进 `CREDITS.md`。
- 静止帧像素一致是硬指标：同一机位、同一帧号，两次渲染差值必须是 0。改动渲染相关代码后要验证。

**第一步：跑一遍基线，记下现状**
1. `npm install`，然后 `npm test`。
2. 每个示例（`examples/hello-courtyard`、`walled-garden`、`garden-quest`、`agent-trial`、`snow-hut`）都在示例目录里执行 `npx vite build`、`npm run playtest`。再用 `node packages/tools/src/package.mjs examples/<名字> --out examples/<名字>/release/<名字>.html` 打成单文件，从 `file://` 打开跑一遍 playtest。
3. 把结果写进 `docs/TEST-REPORT.md`，每个示例写：通过 / 失败的步骤、控制台报错、帧时间、单文件体积。

**第二步：按顺序处理（每项都要有能重复跑的测试）**

| 顺序 | 任务 | 完成标准 |
|---|---|---|
| 1 | 把所有示例的 playtest 和 garden-quest 的通关脚本接成一条 `npm run test:e2e`（清单里的 A4） | 一条命令跑完；任何一步失败，退出码非 0 |
| 2 | 关门夹人（A5）：玩家站在门扇转动的范围里关门 | 玩家被推开或门停住，不穿模、不卡死；加进 garden-quest 的通关脚本 |
| 3 | 雪夜小屋门口卡人（B16）：物理角色在 5–13 cm 台阶上卡住 | 在 `@mirage/game` 的角色控制器里修好（不是绕开设计），加节点测试：13 cm 台阶能走上去 |
| 4 | 走动网格漏掉细栏杆、斜墙边滑动卡住（B3） | 写出复现用例（细栏杆、45° 墙），修好或在 `play` 里加最小的修正，节点测试通过 |
| 5 | 按手柄 A 关开始界面时角色同时跳一下（B10 后半） | 关界面那一下不再触发跳跃；手柄模拟测试覆盖 |
| 6 | 延时演示开始时间比设定早约 10 分钟（B19） | 找到原因并修好；演示的开始时间与设定相差不超过 1 分钟 |
| 7 | Safari、Firefox 各跑一遍全部 playtest（A2）；能装 Playwright 的 webkit / firefox 就用，装不了就写清楚 | 结果写进 `docs/TEST-REPORT.md`，报错逐个修或记成问题 |
| 7b | **显卡负载（有用户担心「伤显卡」）**：① 静止画面精细化完成后停止渲染，有输入或时钟变化再恢复；② 走动时限帧，跟随屏幕刷新率，默认不超过 60；③ 标签页不可见时完全暂停（`visibilitychange`）；④ 默认中等画质，检测到笔记本 / 电池供电 / 弱显卡自动降档；⑤ 角落显示画质和帧率，加一键「省电模式」 | 静止 10 秒后 GPU 几乎空闲（量一下停止后的帧数，应为 0 或接近 0）；切走标签页时 0 帧；走动时帧率不超过刷新率；五个示例的 playtest 照样通过，静止帧像素一致不变 |
| 8 | 浏览全部代码，找明显的 bug：未处理的 Promise、资源没释放（`dispose`）、事件监听没移除、除零、NaN、窗口缩放、页面隐藏后回来 | 每个真问题一个提交，配测试；拿不准的写进报告，不改 |

**最后交付**
- `docs/TEST-REPORT.md`：基线结果、每项任务的结果和数字、还没解决的问题。
- 每个修复一个分支或一个提交，标明对应的任务编号（A4、A5、B16……）。
- 不确定要不要改的地方，写进报告让作者决定，不要擅自做大改动。
