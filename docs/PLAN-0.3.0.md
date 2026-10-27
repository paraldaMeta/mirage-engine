# 0.3.0 和 0.4.0 计划

起点：`main` 32ba9ac（0.2.0，tag `v0.2.0`，GitHub Release 已发，附五个示例的单文件；`v0.1.0` 打在 183614b）。规矩照旧：一个问题一个分支一条提交；先写会失败的测试或测量；静止帧像素必须一致；拿不准的写进报告，不写进代码。

## 进度（2026-10-27）

| # | 任务 | 状态 |
|---|---|---|
| 1 | **B2 走动时随风摆的东西拖影** | 测了，**不复现，不改代码**（见下） |
| 2 | **触屏在浏览模式里能走能看**（B8） | 已做，`fix/b8-touch`，已合进 main |
| 3 | **游戏里触屏能跑**（B8） | 已做，同一分支 `fix/b8-touch` |
| 4 | 开始界面按手柄 A 同时跳一下（B10） | 第一轮已修（`fix/b10-start-jump`，`packages/game/check.mjs` 有测试），去掉 |
| 5 | **B12 无月夜曝光顶到 40 倍** | 看了图，所有者定：**保持现在的样子**，关闭 |
| 6 | **触发区和事件**（B6 后半） | 已做，`feat/zones`，已合进 main |
| 7 | **固定步长物理**（B6 前半） | 没开始，做法见下 |
| 8 | **总平面图的 schema 文件**（B15） | 没开始 |
| 9 | **植被工具包的第一版**（B11、C4） | 没开始 |

`fix/b8-touch` 和 `feat/zones` 已合进 main（a77bde1），合完 `npm test` 和 `npm run test:touch` 五个示例全过。

### `fix/b8-touch`（e3712df）

- 浏览模式（`@mirage/play`，没有游戏输入时）：左半屏按下的手指是以按下点为中心的摇杆，拖过 80 px 就跑；右半屏的手指转视角；第一次触摸（或粗指针设备）时左上角出现 Walk / Orbit 和 View（下一个视点）按钮。院子默认是 orbit，以前手机上根本出不来。
- 轻点会附带一个 mousedown，以前它会去要指针锁定，锁着时 Chrome 拒绝 pointer capture，walled-garden 每次触摸都报错；现在触摸后 1 s 内的 mousedown 不要锁。
- 游戏摇杆推出外圈 1.25 倍半径就跑（外圈变亮）。
- 测试：`npm run test:touch`（`packages/tools/src/touch-check.mjs`，844x390 触屏模拟，真实的 CDP 触摸事件）。之前：院子走 0、转 0；garden-quest 推满 0.999 m 对 70 % 的 0.693 m（没跑）。之后五个示例：40 帧走 0.69 到 0.80 m、跑 2.78 到 2.80 m、转 0.75 到 0.9 rad，抬手不漂，无报错。
- 回归：`npm test`、五个 playtest、garden-quest playthrough（含它自己的触屏步骤）、still-pop 全过。

### `feat/zones`（e878ce4）

- `game.zone({ id, box | sphere, enter, exit, once })`：`startGame` 每帧把 `game.player` 设成角色脚下的位置，`game.tick` 判断进出，调 `enter` / `exit`，发 `'zone'` 事件。存档记住在哪些区里、哪些 once 区已触发，读档不会重复触发。纯状态，不用 Rapier 传感器。
- 测试在 `packages/game/check.mjs`（先失败：`zone is not a function`）。浏览器里在 garden-quest 玩家前方 1.5 m 放一个区，走进去触发 enter 和 zone true / false，无报错。

### B2 的测量（不改代码）

方法：固定 60 Hz 帧、真实按键往前走 40 / 80 帧，取屏幕上的 TAA 帧，和同一时刻、同一相机直接渲染的 16 子帧静止帧比；同一个点再跑一遍、场景时间钉在 0（只有相机动）。只看场景时钟改变了的像素（两张直接渲染图差大于 2，院子 hero 视角约 4 % 的像素，就是棕榈叶）。

| 院子 hero 视角，40 / 80 帧 | 场景时钟走 | 场景时间钉住 |
|---|---|---|
| 叶子像素上的误差（亮度 0 到 255，均值） | 12.24 / 13.0 | 12.31 / 13.1 |
| 风调大 10 倍 | 10.02 / 11.14 | 10.19 / 11.15 |

风带来的额外误差是 0（正负 0.2 以内）。估算也一样：叶尖最快约 8 cm/s，TAA 历史平均约 0.12 s 前（alpha 0.12），落后约 1 cm，5 m 外约 1.5 px，邻域裁剪就去掉了。叶子上那 12 到 14 的误差是走动时 TAA 比静止帧软，相机不动风动它也在，这是 B1 的淡入已经处理的问题。

测量脚本没进仓库：把邻域裁剪去掉再跑，这个量也看不出差别，说明它对真正的拖影也不敏感，不能当回归测试。要的话按上面的方法重写。

顺带发现：agent-trial 走动帧和静止帧的差主要是太阳周围的泛光（静止帧泛光大得多），不是拖影。B1 的淡入把切换盖住了，但两种帧的泛光强度不同可以以后查。

### B12（关闭）

无月夜（院子 night 视角，2026-11-09 21:00）曝光确实一直顶在 40 倍：月亮不在天上时只剩 0.004 的底光。满月夜 4.8 倍，黄昏太阳在地平线下 12 度时 13.7 倍，都没碰上限。渲染出来的无月夜是对的：深蓝的天和星星，灯照亮墙，院子看得清。40 倍的上限就是这张图的调法。所有者 2026-10-27 定：保持不变。

## 剩下的（换到 MacBook 后接着做）

**7. 固定步长物理。** 现在角色每帧一个可变步长（短于 1/90 s 的帧攒起来，修 120 Hz 台阶用的），`physics.step(dt)` 也是可变的。做法：角色和 `physics.step` 都用 1/60 的累加器，一帧走 0 到 N 步；显示用上一步和这一步之间插值的位置（`w.pos` 给相机，碰撞和存档用真实位置），不插值的话 144 Hz 屏上镜头会一顿一顿。验收：同样的按键在 30 / 60 / 144 Hz 下终点误差小于 1 cm；`packages/game/check.mjs` 台阶 38/38；snow-hut 门口 30 到 165 Hz 都能进（方法：Chrome 里把 requestAnimationFrame 换成自己的队列，按目标帧率的时间戳推进）。

**8. 总平面图的 schema。** 现在校验写在 `@mirage/world` 的 loader 代码里。加 `plan.schema.json` 和一个校验命令，五个示例全过，写错的计划报出字段名。

**9. 植被工具包。** 叶片卡片的树冠和实例化的草，放进 `@mirage/world` 的 kits，一个演示；记下单文件体积和帧时间；画面要所有者看。

## 换机器

```bash
git clone https://github.com/paraldaMeta/mirage-engine.git && cd mirage-engine
npm install                     # Node 22（原来那台是 22.23.1）
npm test                        # core / game / play / world / skill 检查
npm run test:e2e                # 五个示例：构建、playtest、单文件，约 20 分钟
```

- 工具用本机的 Chrome（`/Applications/Google Chrome.app`，或设 `$CHROME`），无头、开 GPU。
- 单个示例：`cd examples/<名字> && npx vite build && npm run playtest`；`npm run test:touch`、`test:still-pop`、`test:gpu-load` 都要先有各示例的 `dist/`（`npm run test:e2e` 会构建）。
- Firefox / WebKit：Playwright 不是依赖。`mkdir -p /tmp/pw && cd /tmp/pw && npm i playwright && npx playwright install firefox webkit`，然后 `MIRAGE_PLAYWRIGHT=/tmp/pw/node_modules/playwright/index.js MIRAGE_BROWSER=firefox npm run playtest`（`webkit` 同理）。
- 院子的静帧一致性：`cd examples/hello-courtyard && node scripts/verify.mjs`（sameFrameIndex 应全 0）。
- 写中文文档时注意编码：有的编辑工具会写成 GBK 加 CRLF，提交前用 `file` 看一下，应是 UTF-8 且没有 CRLF。
- 后面的分支基于 main 开。

## 要所有者做的（1.0 之前）

手机真机（A3，触屏现在能用了，正好去试）、集成显卡上量一次、CI 的 GPU runner、npm 包名和接口承诺。见 `docs/PLAN-0.2.0.md` 的 1.0 差距表。
