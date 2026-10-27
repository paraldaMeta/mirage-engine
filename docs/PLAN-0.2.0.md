# 0.2.0 计划：真机上稳着玩，不再一直烧显卡

起点：`main` 183614b（0.1.0，还没公开）。第一轮的修复都在各自的分支上，已推到 origin，`test/round1-integration` 把它们合在一起跑过：e2e 21 / 21。详情见 `docs/TEST-REPORT.md`（分支 `docs/test-report`）。

规矩照旧：一个问题一个分支一条提交；先写会失败的测试；不推 main、不强推、不改仓库设置；静止帧像素必须一致；拿不准的写进报告，不写进代码。

## 第 1 步：把第一轮合进 main（所有者来做）

按这个顺序合，冲突已经在合并分支上解过一遍（`play.js` 的帧循环、示例的 `createPlay` 参数、根 `package.json` 的脚本）：

1. `fix/tools-audio-output`、`test/a4-e2e`、`test/a2-browsers`（测试工具）
2. `fix/a5-door-pinch`、`fix/b16-small-risers`、`fix/b10-start-jump`、`fix/save-error-shown`（游戏）
3. `fix/b3-walk-grid`、`fix/resize`、`fix/b19-day-night-clock`
4. `fix/b21-gpu-load`（三条提交，含审查修复）
5. `fix/lockfile-version`、`docs/test-report`
6. `fix/playtest-warnings`、`fix/thin-railings`（0.2.0 第 2 步里已做完的两条）

合完跑 `npm test`、`npm run test:e2e`、`npm run test:gpu-load`、院子的 `verify.mjs`。

## 第 2 步：0.2.0 的新工作（Cursor 来做，按顺序）

| # | 任务 | 验收 |
|---|---|---|
| 1 | **B1 停下时清晰度突变**：已做，`fix/b1-still-pop`（10 帧淡入静止帧，`npm run test:still-pop`） | 之前静止第 2 帧一跳均值 2.53 / 最大 71；之后每帧 ≤ 0.38 / 7.6，最后一帧和直接渲染逐像素一致 |
| 2 | **B5 走动时风和钟恢复**：已做，`fix/b5-walk-clock`（场景时钟只在玩家走动、转身、拖视角时前进，`place()` 归零） | 走 1.5 s 时钟 1.5，停下冻结；`verify.mjs` 五个光照 sameFrameIndex 全 0 |
| 3 | **B17 雪不再让 snow-hut 一直算「在动」**：已做，`fix/b17-snow-still`（只加检查：B21 闲置 10 s 后不再把场景动画算移动） | snow-hut 11 s 时 still 61、refined 2；在 main 上这条检查失败 |
| 4 | **Firefox 警告**：已做，`fix/playtest-warnings`（警告单独计数，只有错误判失败） | 四个示例在 Firefox 上全过；snow-hut 见第 7 条 |
| 5 | **细栏杆**：已做，`fix/thin-railings`（作者加至少 0.2 m 厚的 `ctx.collider` 代理，写进文档，`bake-check.mjs`） | 5 cm 栏杆：无代理穿过，有代理停在 x −0.375 |
| 6 | **A3 手机真机**（需要所有者拿手机） | 记机型、帧率、自动选的画质、触屏问题 |
| 7 | **Firefox 里 snow-hut 卡在门口**：已做，`fix/high-hz-steps`。原因不是 Firefox，是 120 Hz 屏：每帧移动短于控制器的 2 cm 偏移时 Rapier 的自动上台阶不触发。角色每次至少积累 1/90 s 再移动 | Chrome 里 120/144/165 Hz 之前卡在 z 1.18，之后 30–165 Hz 都进门；60 Hz 终点和之前完全一样；`packages/game/check.mjs` 38/38 |

### 0.2.0 候选的回归（`chore/v0.2.0`，2026-10-27）

`npm test`、`npm run test:e2e` 21 / 21、`test:gpu-load`、`test:still-pop`、院子 `verify.mjs`（五个光照 sameFrameIndex 全 0）、garden-quest playthrough 都过；五个示例在 Firefox 和 WebKit 的 playtest 10 / 10 全过（Firefox 里 snow-hut 进门了）。单文件体积：hello-courtyard 2.24 MB、walled-garden 2.25、garden-quest 4.53、agent-trial 3.16、snow-hut 3.15，和 0.1.0 相差不到 0.01 MB。

## 第 3 步：发版

已做，`chore/v0.2.0`：CHANGELOG 的 0.2.0 一节（行为变化：**默认画质从 high 改成 medium**，要原来的画面用 `quality: "high"`；角落的画质和帧率，`?hud=0` 关掉；静止、帧率上限、隐藏标签页时不绘制；场景时钟；静止淡入），全部 11 个 `package.json` 和内部依赖改成 0.2.0，锁文件重新生成，README 状态行，tools 的 `mirage-still-pop` 命令。

所有者的顺序：

1. 先在现在的 `main`（183614b）上打 `v0.1.0`。
2. **压缩历史要么跳过，要么放到最后。** `docs/RELEASE.md` 第 1 节的 `--orphan` + `push -f` 会让 main 和所有修复分支没有共同祖先，之后这些分支都合不进去了。
3. 合并：`test/v0.2.0-candidate` 已经包含第 1 步的所有分支和第 2 步的 1、2、3、5、7 条（按第 1 步的顺序合过、冲突解过），`chore/v0.2.0` 在它上面再加一条版本提交。直接把 `chore/v0.2.0` 合进 main 就是完整的 0.2.0；要一条条审，就按第 1 步的顺序，再接 `fix/b1-still-pop`、`fix/b5-walk-clock`、`fix/b17-snow-still`、`fix/high-hz-steps`（后四条基于 `test/round1-integration`，因为 B21 重写了帧循环）。
4. 合完跑上面那组回归，打 `v0.2.0`，Release 正文用 CHANGELOG 的 0.2.0 一节。

## 要所有者定的

已定：Firefox 警告分开计数；细栏杆用碰撞代理；先发 0.1.0，这一轮做完再发 0.2.0。

## 不放进 0.2.0

植被工具包、人物、触发区和碰撞事件、npm 发包、体积光、中文界面、室内局部光照、单文件里 Rapier 再压缩。

## 离 1.0 还差什么（对照 `docs/RELEASE.md` 第 4 节，0.2.0 之后）

| 项 | 状态 | 谁 |
|---|---|---|
| Safari / Firefox | 0.2.0 已测（Playwright WebKit 26、Firefox），五个示例全过 | 完成；真 Safari 再看一眼由所有者 |
| 手机真机、触屏（A3） | 没测；触屏能不能走没人试过 | 所有者拿手机，Cursor 修 |
| 弱 GPU 的预算档 | 0.2.0 默认 medium、帧率上限、闲置停绘；没有在集成显卡上量过 | 所有者的机器 |
| 一条命令端到端（A4） | 有 `npm run test:e2e` | 完成 |
| 接进 CI | 没有；要带 GPU 的 Chrome 的 runner | 所有者定 runner，Cursor 写配置 |
| 地形、植被、水面工具包（B11、C4） | 没有，每个世界自己写 | 新功能，大，要先定接口 |
| 人物 | 占位方块 | 新功能，大，要美术方向和 CC0 资源 |
| 碰撞 | 小台阶（A5、B16）和高刷新率已修；细栏杆用代理；走动网格只在加载时烘焙；没有触发区和碰撞事件（B3、B6） | 触发区是新接口，要先定 |
| 移动画质（B1、B2、B5） | B1、B5 已修；B2 移动拖影没动 | Cursor |
| 夜里无月的曝光（B12） | 没动 | Cursor，要所有者定想要的亮度 |
| 总平面图 schema、挂点声明（B15） | 没有 | 要先定格式 |
| 技能包盲测（A1） | 只有 Claude 跑过 | 要 Codex / Cursor 各跑一次 |
| npm 发包 | 包名、导出、d.ts、稳定接口、文档站都没定 | 所有者定包名和接口承诺 |

所以 1.0 不是一晚上能到的：一半要所有者的设备和决定，另一半是要先定接口的新功能。比较现实的路线是 0.3.0 做 B2、B12 和触屏，0.4.0 定触发区和工具包接口，1.0 在 npm 接口定下来以后。
