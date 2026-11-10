# Mirage 1.0 审查报告

审查对象：`main` 3d721eb（package.json 版本 0.2.0，tag `v0.2.0` 之后又合了触屏和触发区），分支
`claude/mirage-1-0-review-ee7e73`。机器：Mac（Apple silicon）、macOS 26、Node 22.23.1、本机 Chrome 156 无头开 GPU。
日期 2026-11-08。

结论先说：**引擎本身能用，五个示例在本机全部端到端通过，画面和测试工具都是真东西；离 1.0 差的主要是"作为一个公开的
npm 库"该有的东西**——接口边界、卸载（dispose）、发布元数据、CI、跨平台，以及一批边角 bug（有一个是导入存档就能执行
脚本，一个是部署命令能删掉当前目录）。P0 里我能独立做的已经在本分支做完并各自带测试，见第 7 节；剩下的 P0 需要 Oscar
定（包名、接口承诺、版本号）。

## 0. 更正：Codex 的分支（2026-11-09）

第一版审查只看了 `main`，**漏看了 Codex 没合并的一整条开发链** `codex/mirage-gpu-ci`：10 个分支，14 个提交，
199 个文件，约 +12,700 行，日期 11 月 4–7 日，没开过 PR。下面第 1–9 节里有几处结论因此过时，例如"没有类型声明""没有
固定步长物理""没有工具包和人物""没有 GPU CI"；已在相应位置标注。Codex 自己写明这批改动是在没有 GPU 的机器上只改了源码，
没有跑任何测试。

按 Oscar 的决定，本分支已经 **rebase 到 Codex 链之上**，并在测试机上第一次把它跑通：

- 两边重复的改动只留一份，以 Codex 的设计为准：
  - 卸载 / 生命周期（`play.dispose()`、`await session.dispose()`、`ctx.onDispose`）；
  - `loadRapier` 的竞态；
  - 挂点"先整体检查再合并"；
  - 脚手架版本；
  - 保留 `"./*"` 子路径导出（Codex 的工具包靠它导入）。
- 我的独有修复叠在上面，在 rebase 后的代码上重新测过：
  - 存档 XSS 和存档身份校验；
  - `addStatic` 遇到奇怪网格；
  - 行走网格的 Object3D / LOD；
  - finalize 失败和同名模块的隔离；
  - 部署删目录；
  - 跨平台找 Chrome；
  - 包元数据和 `test:pack`；
  - `docs/api.md`；
  - 无 GPU 的 CI。
- 验证时发现并修好的 Codex 链问题：
  - `npm test` 失败：角色碰撞过滤器在 Rapier 回调里又调 Rapier，之后 `world.free()` 抛错；
  - 类型消费者 NodeNext / Bundler 各 4 个错误（`createPlay` 丢了自定义 walker 的类型）；
  - GPU 预检查不认识 Chrome 156（没有 `webgl2` 状态键）；
  - garden-quest 通关测试没跟上"开始键只负责开始"的新行为。
- 验收中发现的偶发问题（run-003，约 1 / 9）：读档位置差 14.5 cm。原因是角色悬在亭子台阶边上，起初我误以为是门。已修：不采纳会悬空的上台阶，`place()` 把角色放到台阶上而不是台阶里（`e668558`）。
- 测试机串行验收 run-004 和修复后的 run-005：**全部自动步骤通过**，状态 `machine-pass-pending-review`。通过的步骤有：GPU 预检查、类型消费者、
  `npm test`、七个示例 e2e 29 / 29、固定步长 30–165 Hz、触屏、静帧淡入、GPU 负载、院子五个光照静帧一致、林缘和河湾指标、
  人物 HTTP 和单文件。
- 当前状态以 [STATUS-1.0.md](STATUS-1.0.md) 为准，人工项见 [run-005 REVIEW](acceptance/runs/2026-11-09-run-005/REVIEW.md)。

---

## 1. 现在能做什么

| 能力 | 状态 | 证据 |
|---|---|---|
| 代码生成整片场地：物理天空、材质里的大气透视、日月主光和软阴影、从世界捕获的环境光、子帧累积（抗锯齿/软阴影/SSAO/景深）、走动时 TAA、任意地点时间的昼夜 | 能用 | 五个示例和两个演示；浏览器里实际看过（第 4 节） |
| 世界协议：总平面图是唯一的位置来源，模块各自 build / anchors / finalize，失败隔离，每模块独立随机流 | 能用 | `packages/world/check.mjs`；walled-garden 和 hello-courtyard 各有一个故意失败的模块 |
| 漫游：走 / 飞 / 等距游戏视角 / 环绕；从真实几何烘焙的行走网格；停下后渐进精细化；嵌入 API | 能用 | `packages/play/check.mjs`、五个 playtest |
| 游戏层：Rapier 物理（WASM 懒加载）、角色、门、动作映射（键盘/手柄/触屏）、程序化音频、实体、背包、版本化存档、触发区、无障碍 HTML 界面 | 能用 | `packages/game/check.mjs` 39 项、garden-quest 通关脚本 |
| 工具：playtest（JSON 剧本、闪烁、帧时间、报告和联系表）、单文件打包、快照、静态部署目录（不上传） | 能用 | `npm run test:e2e` |
| Agent 技能包（7 个技能，brief → plan → 并行模块 → playtest → ship） | 能用，有一个会让新世界装不上的 bug（已修，见 P0-6） | `agent/check.mjs`；agent-trial 是三个子 Agent 并行做的 |

### 跑过的测试（基线，未改代码）

- `npm test`：core / game / play / world 检查和 7 个技能全过，约 1 秒。
- `npm run test:e2e`：五个示例 × （构建、dist 的 playtest、打包单文件、file:// 的 playtest）+ garden-quest 通关脚本，
  结果见第 4 节表格。
- 只在本机测；仓库里**没有 CI**（`.github/` 不存在）。

## 2. 缺什么

按"作为 1.0 的公开库"来看：

1. **接口边界没定。** 每个包的 `exports` 是 `"./*": "./src/*.js"`，等于每个源文件都是公开接口，任何内部重构都算破坏性
   变更。`@mirage/game` 自己就在用 `@mirage/core/rng`。
2. **没有卸载。** `createPlay`、`startGame`、`createInput`、`createUI`、`createAudio`、`createPhysics` 都没有
   `dispose()`；`play.stop()` 只停帧循环。单页应用里打开再关掉一个世界，会留下约 15 个 window/document 监听、
   OrbitControls、DOM 节点、渲染目标、AudioContext（浏览器限制数量）和 Rapier 的 WASM 内存，旧的按键处理还在响应。
   `world.dispose()` 只释放几何体，不释放材质、着色器程序和阴影贴图。
3. **没有类型声明（d.ts）**（*更正：Codex 链已有，测试机通过，见第 0 节*），接口文档分散在各包 README，core 有 19 个导出没有任何文档（例如 `createEnv`、`FOG`、
   `pickQuality`、`hash32`），play 3 个、game 5 个。
4. **发布元数据不全。** 包里没有 LICENSE 文件，没有 `repository` / `homepage` / `bugs`；`three` 的 peer 依赖钉死
   `0.186.1`，`@mirage/*` 之间钉死 `0.2.0`，任何补丁版本都会让 npm 报 ERESOLVE。
5. **包名没定。** npm 上 `mirage-engine` 已被别人占用（一个把 DOM 映射到 WebGL 的项目，0.3.23）；`@mirage/*`
   目前查不到包，但 `@mirage` 这个 scope（组织）是否可注册我查不到（npmjs.com 对脚本返回 403），要 Oscar 登录确认。
6. **没有 CI。**（*更正：本分支加了无 GPU 的 CI；Codex 链有 GPU 工作流，缺 runner*） 节点测试、包内容、示例构建都只在作者机器上跑过；GPU 端到端需要带 GPU 的 runner。
7. **只在 macOS 上能跑工具。** Chrome 路径写死 `/Applications/Google Chrome.app/...`，Linux / Windows / CI 上所有
   工具直接失败；`'file://' + path` 在 Windows 和带 `#` 的路径上是坏的；`deploy --multi` 用 `npx`（Windows 是 `npx.cmd`）。
8. **只能在仓库里做世界。** 技能和脚手架都假设世界放在 `examples/<名字>`，工具路径写成 `../../packages/tools/...`；
   装 npm 包、在别的目录新建一个世界的路径不存在（需要一个 `create-mirage` 或等价的说明）。
9. **路线图里还没做的功能**（*更正：固定步长、schema、植被工具包、人物在 Codex 链里已做，见第 0 节*）（`docs/PLAN-0.3.0.md`）：固定步长物理（B6 前半）、总平面图 schema（B15）、植被工具包
   （B11 / C4）、人物（占位方块）、手机真机（A3）、弱 GPU 实测。

## 3. Bug

来源：我自己读代码、一个只读的代码审查子代理（结论我逐条回到代码核对过，标"已复现"的是实际跑出来的）、e2e 和浏览器。
严重度：高 = 安全、丢数据、或常见用法直接崩；中 = 错误结果但有绕法；低 = 体验问题。

| # | 严重度 | 位置 | 问题 | 状态 |
|---|---|---|---|---|
| 1 | 高 | `game/src/ui.js` | 背包名、按键设置、存档摘要用 `innerHTML` 拼进界面；**导入别人给的存档文件就能在页面里执行脚本** | 已修 + 测（浏览器） |
| 2 | 高 | `tools/src/deploy.mjs` | 参数解析把 `--out` 的值当成示例目录，然后无条件 `rmSync(out, recursive)`；`mirage-deploy --out . myworld` **删掉当前目录** | 已修 + 测（已复现：旧代码把沙盒目录清空） |
| 3 | 高 | `agent/mirage-brief-to-plan/assets/skeleton/package.json` | 脚手架要 `@mirage/*@0.1.0`，仓库是 0.2.0，按技能新建世界后 `npm install` **404 失败** | 已修 + 测（已复现） |
| 4 | 高 | `play/src/walkgrid.js` | 烘焙行走网格时把普通 `Object3D`（glTF 的节点）和 `LOD` 当成"不算碰撞的东西"隐藏，**它们下面的实体网格全部没有碰撞**，人直接穿过去（物理那边却有碰撞） | 已修 + 测（浏览器 bake-check） |
| 5 | 高 | `game/src/physics.js` | `loadRapier()` 在 WASM 初始化完成前就把模块交出去；先预加载再 `createPhysics()` 会抛 `rawintegrationparameters_new of undefined` | 已修 + 测（已复现）；Codex 链也修了，rebase 后用 Codex 的实现，测试保留 |
| 6 | 高 | `game/src/physics.js` | `addStatic` 遇到空几何、0 个实例的 InstancedMesh、没有 position 的网格、BatchedMesh 直接抛错，**`startGame` 整个失败** | 已修 + 测（已复现） |
| 7 | 高 | play / game / core | 没有 `dispose()`，见第 2 节第 2 条 | 已修 + 测；rebase 后改用 Codex 的生命周期实现，`world.dispose` 和 `mountWorld` 的补充保留 |
| 8 | 中 | `world/src/loader.js` | 失败隔离有洞：`anchors` 里前面的键已合并、后面的键抛错时，"被跳过"的模块的挂点仍被别人消费；`finalize` 抛错时模块的几何和 `onUpdate` 照样留着，和文档说的"连同它加的东西一起丢掉"不符；两个模块同名会互相覆盖 | 已修 + 测（已复现） |
| 9 | 中 | `game/src/game.js` | 导入存档不检查 `id`：别的游戏同版本的存档会被静默读入；`v: 0.5` 这种版本号能通过 | 已修 + 测 |
| 10 | 中 | `play/src/walkgrid.js` | 总平面图超过 GPU 纹理尺寸（0.125 m 格子下约 512 m，很多安卓 GPU 是 4096）时烘焙出空网格、不报错，人掉下去；烘焙中途抛错会把 `overrideMaterial`、隐藏的物体、`fog = null` 留在场景上 | 已修（报错 + try/finally） |
| 11 | 中 | `tools/src/chrome.mjs` 等 | Chrome 路径写死 macOS；`file://` 拼接在 Windows 上坏 | 已修 + 单元测试 |
| 12 | 中 | `core/src/daynight.js` | 时间或地点写错（`'noon'`、ISO 字符串、只有 `elevation`、地点缺 `lon`）时光照静默变 NaN，画面全黑；`{ time: '18:00' }` 不带日期抛 TypeError | 已修 + 测（`0ffb24f`：抛 `TypeError` 并指出字段；`core/check.mjs`） |
| 13 | 中 | `world/src/plan.js` | 校验不全：`regions: null`、非数组 `viewpoints` 抛裸 TypeError；`rect: [1, 2]`、一个点的 `poly` 能过；`spawn` 不校验但 `startGame` 直接读 `sp.eye` | 已修（Codex 的 schema；2026-11-09 复查 6 个用例都报出字段） |
| 14 | 中 | `game/src/physics.js:body()` | 旋转过的道具：用世界 AABB 建盒子再按物体旋转一次，碰撞盒偏大且歪 | 已修 + 测（`02f7e3d`；旧代码 45° 木板半宽 0.884，新 1.0） |
| 15 | 中 | `tools/src/e2e.mjs` 等 | `mirage-e2e`、`gpu-load`、`still-pop` 作为 bin 发布，但只能在本仓库里跑（`ROOT = '../../..'`） | 已修（`b8cf5d6`：`mirage-e2e` 用当前目录或 `--root`；gpu-load、still-pop 本来就接收路径） |
| 16 | 低 | `game/src/ui.js` | 菜单在"按一个键"时被手柄关掉，之后第一个游戏按键会被吞掉并改绑 | 已修 + 测（`b8e5aa6`：菜单关闭或换面板即取消；`tools/rebind-check.mjs`，旧代码 jump 被绑成 W） |
| 17 | 低 | `play/src/play.js` | 键盘处理不看焦点：宿主页面的输入框里打字会让人走动、触发 R/F/G/O/1–9 | 已修 + 测（`3c33d62`、`cfb33e7`；`dispose-check.mjs`，旧代码按 W 走了 0.75 m） |
| 18 | 低 | `play.js` / `start.js` | 库代码里直接 `location.reload()`（画质下拉框、默认的重新开始） | 已修（`3c33d62`：`onQuality`、`onRestart`，默认仍刷新） |
| 19 | 低 | `game/src/input.js` | 控制面板里方向键显示成 ` L` / ` R` | 已修 |
| 20 | 低 | `game/src/start.js` | `load('auto')` 把任何字符串当 JSON 解析 | 已修（`3c33d62`：只有 JSON 对象字符串才当导入，其余是存档名） |
| 21 | 低 | `core/src/textures.js` | 贴图集名字直接拼进 GLSL 标识符，带 `-` 时着色器编译失败且没有清楚的报错 | 已修 + 测（`7a9a201`：`glslName`） |
| 22 | 低 | `tools/src/chrome.mjs:serve` | `decodeURIComponent` 遇到坏的 `%` 抛错会让测试服务器进程崩；`startsWith(root)` 放过同前缀的兄弟目录（只在本机测试用） | 已修 + 测（`7a9a201`；旧代码 `URIError` 崩溃） |
| 23 | 低 | `game/src/game.js` | 头注释说"能在 node 跑"，但不传 `storage` 时 `save()` 在 node 里抛错 | 已修 + 测（`3c33d62`：没有 localStorage 时存在内存里；沙盒 iframe 同理） |
| 24 | 低 | 文档 | core README 说默认画质 `'high'` 且只有 high / low 两档，实际有 medium，页面默认用 `pickQuality()` 选 medium | 已修（`7a9a201`） |

### 3b. 第二轮：全量代码审查（2026-11-09，分支 `claude/mirage-1.0-finish`）

四个只读审查分别查 world、play、game、core 加 tools，每条发现先复现，再修，再写一个在旧代码上会失败的检查。
四份报告共 34 条（其中 2 条审查时已在本分支修掉），全部已修，提交 `00798e2`、`b8e5aa6`、`cfb33e7`、`83acaf6` 等，清单见 CHANGELOG 1.0.0 的"1.0 code review"一节。第一轮遗留的 #12–#24 也都修了（上表）。较重的几条：

| 位置 | 问题 | 证据 |
|---|---|---|
| `core/geom.js` `taperedTube` | 侧面三角形全部朝内（360 / 360），院子棕榈和花园树干看到的是远侧内壁 | `core/check.mjs`（旧代码 360 / 360 朝内） |
| `world/loader.js` | 一个 `null` 模块、一个没有 position 的网格或一个坏的环境光体积，会让整个 `buildWorld` 失败 | `world/check.mjs`（旧代码：reading 'name' of null） |
| `game/game.js` | 读档会用存档里的设置覆盖玩家的按键和音量；坏存档先改了 flags 再报错 | `game/check.mjs` |
| `play/walkgrid.js` | 一列超过 8 层时丢的是最低的（地面） | `bake-check.mjs`（旧代码走不进去，停在 x −0.25） |
| `play/play.js` | 在地图外从飞行或环绕切回行走，人悬在半空不能动；`dispose()` 不还相机镜头 | `play/check.mjs`、`dispose-check.mjs` |
| `tools/deploy.mjs` | 用 `.nojekyll` 判断"是自己建的目录"，手写的 Pages 目录（带 `.git`）也会被清空 | `tools/unit.mjs` |

## 4. 实际打开看效果（浏览器）

用应用内浏览器（Chrome）通过 `vite preview` 打开构建好的示例，同时用无头 Chrome 跑了全部 playtest。浏览器面板在
后台时 `requestAnimationFrame` 不跑，所以截图前用示例自带的渲染钩子（`__mirage.render` / `play.render`）手动画一帧
静止帧，走动用 `play.step()` 驱动；实时循环和输入由无头 playtest 覆盖。

| 示例 | 看到的 | 结论 |
|---|---|---|
| hello-courtyard，黄金时刻 hero 视角 | 天空、长阴影、棕榈和柏树、尖拱回廊、水池、灯笼、凉棚；角落有画质下拉框和省电按钮 | 和 README 的图一致 |
| hello-courtyard，2026-11-09 21:00 无月夜，步行 | 星空，灯笼亮起并在水面倒影，院子看得清；按 W 2 s 走 3.0 m（步行 1.5 m/s），再走被水池沿挡在 z 2.15（`blocked: true`） | 夜景和碰撞都对 |
| garden-quest | 门、石子路、开始界面、目标面板（Find the key） | 正常 |
| garden-quest，**导入恶意存档** | 旧构建（HEAD）：背包里插进两个 `<img onerror>`，脚本执行了 2 次；本分支：同一个存档原样显示为文字，脚本 0 次；别的游戏 id 的存档被拒（"a save of "someone-else", not of this game"） | bug #1、#9 已修 |
| snow-hut，the porch | 蓝调时刻、飘雪、亮着的窗、松林雾气；18 个静态碰撞体，0 个失败模块 | 正常；松树是叠起来的锥体（B11 记过的占位） |

基线 e2e：**21 / 21 步通过**（五个示例 × 构建 / dist playtest / 打包 / file:// playtest，加 garden-quest 通关），
约 26 分钟。说明：这次基线从 HEAD 开始，跑的过程中我已经在改代码，后面几个示例（hello-courtyard 之后的构建）
带上了部分改动；改完以后的完整复跑见第 8 节。

## 5. API 稳定性、文档和示例

- **接口**：四个包的入口一共导出 68 个名字（core 43、world 7、play 7、game 11）。命名大体一致（`create*` 工厂），
  但也有 `build*` / `mount*` / `start*` / `define*` 和一个类 `Pipeline`。我在 `docs/api.md` 里把每个导出列出来，
  分成 **stable**（1.0 起只在大版本里变）和 **experimental**（小版本可以变，主要是渲染内部和常量），这是**提案**，
  要 Oscar 定。
- **导出表**：本分支把 `"./*"` 去掉，只留入口和两个确实被用到、又不依赖渲染器的子路径（`@mirage/core/rng`、
  `@mirage/world/plan`）。
- **文档**：每个包有 README，`docs/world-protocol.md` 讲协议，技能包讲工作流，整体是够 Agent 用的；缺的是
  一份完整的接口清单（现在有 `docs/api.md`，`npm run test:pack` 会在有导出没写进去时失败）、类型声明、文档站。
  中文 README 和英文同步。
- **示例**：五个示例覆盖了纯漫游、失败隔离、完整小游戏、并行 Agent 构建、室内外和天气，加两个单文件演示，
  示例本身质量高。缺：一个"不在本仓库里、从 npm 安装"的最小示例；一个嵌入宿主页面（`mountWorld`）并卸载的示例
  （hello-courtyard 有 `embed.html`，但没有卸载）。

## 6. 性能和打包

| 示例 | 单文件 | 其中 | 走动帧时间（均值 / p95） | 三角形 | 加载到可玩（dist） | 闪烁（路线上，< 8 为过） |
|---|---|---|---|---|---|---|
| hello-courtyard | 2.14 MB | 贴图 1.30 + 代码 0.84 | 3.36 / 3.5 ms | 12.0 万 | 0.6 s | 4.76 |
| walled-garden | 2.15 MB | 贴图 1.30 + 代码 0.85 | 3.77 / 4.0 ms | 40.6 万 | 1.0 s | 4.23 |
| garden-quest | 4.32 MB | 贴图 1.30 + 代码 3.02（含 Rapier 2.24） | 4.54 / 5.0 ms | 40.9 万 | 1.5 s | 1.84 |
| agent-trial | 3.01 MB | 代码（含 Rapier） | 4.23 / 4.5 ms | 8.6 万 | 1.1 s | 2.53 |
| snow-hut | 3.01 MB | 代码（含 Rapier） | 4.85 / 5.2 ms | 33.4 万 | 1.6 s | 2.13 |

数字来自本次基线 `npm run test:e2e`（无头 Chrome，开 GPU，1440 × 900，medium 画质）；file:// 单文件的数字和 dist
相差在 0.3 ms 以内。都在技能包写的预算里（单文件 ≤ 5 MB，帧时间 8 ms）。

- three.js + Mirage 的代码约 0.9 MB（gzip 0.25 MB）；Rapier 的 compat 构建把 1.57 MB WASM 用 base64 内联成
  2.24 MB JS（gzip 0.83 MB），只在用游戏层时动态加载。单文件 3 MB 的 gzip 后约 1.09 MB。
- 已有的 GPU 负载控制（默认 medium、自动 low、60/30 帧上限、静止 10 秒后不画、标签页隐藏不画）都有测试
  （`test:gpu-load`）。
- 没测过：集成显卡、手机真机、Windows / Linux 的 GPU。帧时间只在一台 M 系芯片上量过。
- 可以做的优化（P2）：Rapier 先 gzip 再内联（B14，约省 1.4 MB）；行走网格在 0.125 m 格子下 80 × 94 m 的花园
  烘焙 0.28 s，大地图会线性变慢。

## 7. 1.0 验收清单

P0 = 不做不能叫 1.0；P1 = 1.0 应该有，可以在 1.0 之后很快补；P2 = 有更好。
"本分支"= 这次在 `claude/mirage-1-0-review-ee7e73` 上做了，证据写在后面。

### P0

| # | 项 | 状态 | 证据 |
|---|---|---|---|
| P0-1 | 修掉高严重度 bug（第 3 节 #1–#7） | **本分支完成** | 每条都有先失败后通过的测试，见第 8 节 |
| P0-2 | 失败隔离名副其实（#8）、存档身份校验（#9） | **本分支完成** | `world/check.mjs`、`game/check.mjs` 新增项 |
| P0-3 | 所有创建的东西都能卸载 | **完成**（采用 Codex 的生命周期设计，补了 `world.dispose` 释放材质和阴影、`mountWorld` 失败时清理） | `dispose-check.mjs`；garden-quest lifecycle 三轮（run-004） |
| P0-4 | 定公开接口：列出每个导出和稳定性 | **提案完成**；`"./*"` 按 Codex 的决定暂时保留，子路径白名单和 stable / experimental 划分**要 Oscar 定** | `docs/api.md`、`docs/API-CANDIDATE.md`；`npm run test:pack` |
| P0-5 | 发布元数据：每个包带 LICENSE、repository / homepage / bugs，peer 依赖用范围 | **本分支完成** | `npm run test:pack`（`npm pack --dry-run` 检查） |
| P0-6 | 技能包脚手架能装上 | **本分支完成** | 新建世界 `npm install` 和 `vite build` 通过；`agent/check.mjs` 防回归 |
| P0-7 | CI：无 GPU 部分在 Ubuntu 和 macOS 上跑；GPU 部分用 Codex 的自托管工作流 | 无 GPU 部分**通过**；GPU 工作流在，**没有 runner** | `.github/workflows/ci.yml`、`gpu-acceptance.yml` |
| P0-8 | 工具跨平台：找 Chrome、`file://` URL | **本分支完成** | `packages/tools/unit.mjs` |
| P0-9 | **包名**：`mirage-engine` 在 npm 上已被占用；`@mirage` scope 能否注册要登录确认，否则换 scope（例如 `@mirage-engine/*`、`@paraldameta/mirage-*`） | **要 Oscar 定** | — |
| P0-10 | **版本号**：是否把这一版叫 1.0.0（还是先 0.3.0，等 P1 做完再 1.0） | **Oscar 定为 1.0.0**（2026-11-08），本分支已改；tag 和发布仍等他 | 所有包和示例 `1.0.0`，peer `^1.0.0` |
| P0-11 | CHANGELOG 记下 0.2.0 之后的所有变化 | **完成**（1.0.0 一节，含 Codex 链） | `CHANGELOG.md` |
| P0-12 | 测试机串行验收全部自动步骤通过 | **完成**（run-005，提交 `e668558`；run-004 也通过） | `docs/acceptance/runs/2026-11-09-run-005/` |
| P0-13 | 所有者看图：林缘、河湾、人物 | **要 Oscar 做** | REVIEW.md 里有截图和初看意见 |

### P1

| # | 项 | 说明 |
|---|---|---|
| P1-1 | 类型声明（d.ts） | **Codex 已写，测试机通过**（NodeNext / Bundler） |
| P1-2 | 总平面图 schema 和输入校验（B15，第 3 节 #12、#13） | 计划 schema 和校验命令 **Codex 已做，测试机通过**；时间 / 地点输入校验（#12）还没做 |
| P1-3 | 不在仓库里也能建世界 | `npm create` 脚手架或文档，工具接收路径而不是假设 `examples/` |
| P1-4 | 嵌入时的键盘焦点（#17）和不强制刷新页面（#18） | 嵌入 API 是 stable 的，这两条会被宿主撞上 |
| P1-5 | 固定步长物理（B6 前半） | **Codex 已做，测试机通过**（30–165 Hz 终点一致） |
| P1-11 | 角色悬在台阶边（run-003，约 1 / 9，读档位置差 14.5 cm） | **已修**（`e668558`） |
| P1-6 | 旋转道具的碰撞盒（#14） | |
| P1-7 | 手机真机、集成显卡各量一次（A3） | 要 Oscar 的设备 |
| P1-8 | 带 GPU 的 CI runner | 工作流 Codex 已写；要 Oscar 配置自托管 runner |
| P1-9 | 技能包让 Codex / Cursor 各盲测一次（A1） | |
| P1-10 | 仓库专用的 bin（`mirage-e2e` 等）不发或改造（#15） | |

### P2

（植被 / 地形 / 水面工具包和人物：Codex 已做，自动检查通过，待看图。）Rapier gzip 内联（B14）；文档站和在线演示；第 3 节的低严重度项
（#16、#18、#20–#24）；声音混响和遮挡（B9）；局部光照探针（B13）。

## 8. 本分支做了什么（每项的证据）

每条都是"先有会失败的测试或复现，再改，再看它通过"。提交按包分开，提交信息里写了数字。

| 改动 | 之前 | 之后 | 测试 / 证据 |
|---|---|---|---|
| 存档文字转义（#1） | 导入的存档在页面里执行脚本 2 次 | 0 次，原样显示为文字 | 浏览器里新旧两个构建对比（第 4 节） |
| 存档身份和版本（#9） | 别的游戏的存档、`v: 0.5` 都能读入 | 拒绝并说明原因 | `game/check.mjs` 新增 2 项（旧代码 FAIL） |
| `loadRapier` 竞态（#5） | 初始化中途调 `createPhysics` 抛错 | 等同一个 Promise | `game/check.mjs`（旧代码 FAIL：`rawintegrationparameters_new of undefined`） |
| `addStatic` 遇到奇怪的网格（#6） | 空几何 / 无实例 / BatchedMesh 抛错，`startGame` 失败 | 跳过，BatchedMesh 给警告 | `game/check.mjs`（旧代码 FAIL：`reading 'count'`） |
| 角色碰撞过滤器 | 过滤回调里调 `c.isSensor()`，碰撞集合被永久标记为借用，`world.free()` 抛错 | 只比 handle（`EXCLUDE_SENSORS` 已排除传感器） | `game/check.mjs` 新增；角色相关的所有数字前后完全一致（逐行 diff） |
| 部署命令删目录（#2） | 沙盒里 `mirage-deploy --out . myworld` 把整个目录清空 | 退出码 2，文件都在 | 实际复现 + `packages/tools/unit.mjs` 10 个用例 |
| 加载器隔离（#8） | 半途失败的模块挂点被消费、finalize 失败的模块还在场景里、同名覆盖 | 都按文档隔离 | `world/check.mjs` 新增 4 项（旧代码 FAIL） |
| 行走网格（#4、#10） | Object3D / LOD 下的墙穿过去（x = 3） | 挡住（x = −0.5）；超出纹理尺寸报错；中途出错恢复场景 | `node packages/tools/bake-check.mjs`（旧代码 2 项 FAIL）；**五个示例新旧烘焙的网格逐字节相同**（哈希一致） |
| 卸载（#7） | 挂载 / 卸载 5 次：window 监听 11 → 55、document 3 → 15、DOM 节点 16 → 76、贴图 5 → 21（游戏层 71 → 135 个监听） | 每次都是 0 / 0 / 1 / 1 | `node packages/tools/dispose-check.mjs`（新旧对比） |
| 脚手架版本（#3） | 新世界 `npm install` 404 | 安装、构建都通过 | 仓库副本里实际复现；`agent/check.mjs` 防回归（旧版本 FAIL） |
| 找 Chrome、`file://`（#11） | 只认 macOS 路径 | macOS / Linux / Windows | `packages/tools/unit.mjs` |
| 包元数据、导出表、接口清单 | 无 LICENSE、无 repository、`./*` 通配、19 个导出没文档 | 全有；`docs/api.md` | `npm run test:pack`（删掉一个 LICENSE、改掉一个导出名都会 FAIL，已验证） |
| CI | 无 | Ubuntu + macOS：`npm test`、`test:pack`、`build:examples`、浏览器工具检查 | `.github/workflows/ci.yml`（在 PR 上看实际结果） |
| CHANGELOG | 0.2.0 之后的触屏、触发区没记 | "Unreleased"一节 | `CHANGELOG.md` |

改完后的完整复跑（同一台机器）：

- `npm test`（core / game / play / world / tools / 7 个技能）：全过。
- `npm run test:pack`：5 个包全过。
- `npm run test:e2e`：**21 / 21 步通过**（五个示例的构建、dist playtest、单文件、file:// playtest，garden-quest 通关），帧时间和基线相差 0.3 ms 以内。
- `npm run test:touch`、`test:gpu-load`、`test:still-pop`：全过（`play.js` 的监听方式改了，所以这三项都重跑了）。
- `bake-check.mjs`、`dispose-check.mjs`：全过。
- CI（本 PR）：Ubuntu 和 macOS 两个 job 都通过，Linux 上实际找到了 `/usr/bin/google-chrome` 并跑了浏览器工具检查。

## 9. 要 Oscar 决定的事

1. **包名和 scope**（P0-9）：`mirage-engine` 被占了；`@mirage` 是否可注册需要你登录 npm 看。
2. **版本号**（P0-10）：**已定 1.0.0**（Oscar，2026-11-08）。本分支已把所有包、示例和脚手架改成 1.0.0，README 的状态、
   CHANGELOG 的 1.0.0 一节也改了；P1 各项作为 1.x 的小版本补。没打 tag、没发布。
3. **接口划分**（P0-4）：`docs/api.md` 里 stable / experimental 的划分是提案，尤其是 `createUI`、`Pipeline`、
   `installFog` 要不要承诺。
4. **子路径白名单**：`"./*"` 按 Codex 的决定暂时保留（工具包从 `@mirage/world/kits/*` 导入）；冻结前要定哪些子路径长期支持。
7. **看图**（P0-13）：林缘、河湾、人物三组截图在 `docs/acceptance/runs/2026-11-09-run-005/`；林缘的地平线灰带要不要改。
8. **"开始键只负责开始"**：Codex 的固定时钟输入让离开开始界面的那个键不再同时触发它的动作（例如按 P / Esc 开始，不会同时打开菜单）。
   我保留了这个行为，确认一下。
5. **合并、发 npm、打 tag**：都没做，等你看完 PR。
6. **GPU CI runner、手机、集成显卡**（P1-7、P1-8）：需要你的设备或账号。
