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
| 1 | **B1 停下时清晰度突变**：抗锯齿帧切到静止精细帧那一下 | 量出切换前后的差（均值、最大值），给出能重复跑的测量脚本；改了以后差明显变小，静止帧像素不变 |
| 2 | **B5 走动时风和钟恢复**：走动用真实时间，停下冻结 | 走动时树和水在动；停下后的静止帧和现在逐像素一致；显卡负载测试照样通过 |
| 3 | **B17 雪不再让 snow-hut 一直算「在动」** | 静止精细化能完成（B21 的闲置停绘已经兜住显卡，这条是画质） |
| 4 | **Firefox 警告**：已做，`fix/playtest-warnings`（警告单独计数，只有错误判失败） | 四个示例在 Firefox 上全过；snow-hut 见第 7 条 |
| 5 | **细栏杆**：已做，`fix/thin-railings`（作者加至少 0.2 m 厚的 `ctx.collider` 代理，写进文档，`bake-check.mjs`） | 5 cm 栏杆：无代理穿过，有代理停在 x −0.375 |
| 6 | **A3 手机真机**（需要所有者拿手机） | 记机型、帧率、自动选的画质、触屏问题 |
| 7 | **Firefox 里 snow-hut 卡在门口**：新发现，行走者停在 (1.3, 1.2) 进不了门；纯 `test/a2-browsers` 和加上 `fix/a5-door-pinch` 都复现，Chrome 不复现。A2 测的那次没出现 | 先查是不是 Firefox 的帧时间（走路时 fps 记为 0）让 walkTo 判成卡住，还是门的碰撞在 Firefox 里不同 |

## 第 3 步：发版

- `CHANGELOG.md` 加 0.2.0 一节。写明行为变化：**默认画质从 high 改成 medium**，要原来的画面用 `quality: "high"`；角落多了画质和帧率（`?hud=0` 关掉）。
- 六个 `package.json` 改成 0.2.0，重新生成锁文件。
- 打 tag、Release 由所有者做（见 `docs/RELEASE.md`）。

## 要所有者定的

已定：Firefox 警告分开计数；细栏杆用碰撞代理；先发 0.1.0，这一轮做完再发 0.2.0。

## 不放进 0.2.0

植被工具包、人物、触发区和碰撞事件、npm 发包、体积光、中文界面、室内局部光照、单文件里 Rapier 再压缩。这些是离 1.0 还差的，见 `docs/RELEASE.md` 第 4 节。
