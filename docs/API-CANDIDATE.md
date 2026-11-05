# 1.0 接口盘点与候选边界

2026-11-06。这里记录当前源码实际暴露的接口，以及声明覆盖范围；**不是 1.0 稳定性承诺**。
没有改名、移除导出或发布 npm。当前包仍为 0.2.0，新增声明与异机验收源码尚未执行。

## 当前入口

| 包／入口 | 暴露内容 | 类型状态 |
|---|---|---|
| `@mirage/world` | `definePlan`、`contains`、`bbox`、`pathLength`、`along`、`buildWorld`、`LAYER` | 已写声明，待异机编译；含 PlanInput、WorldModule、ModuleContext、BuildReport 等类型。 |
| world `/plan`、`/loader`、`/plan-validation` | 同名实现模块；额外有 `planProblems(unknown)` | 已写声明，待验证。 |
| world `/kits/vegetation`、`/kits/terrain`、`/kits/water` | `addTreeCanopies`、`addGrass`、`addTerrain`、`addWater` | 已写声明，待验证。 |
| world `/plan.schema.json` | 编辑器与校验器共用的 JSON Schema | 保持 JSON 导出；消费者用 resolveJsonModule 读取。 |
| core `/rng`、`/geom`、`/materials`、`/env` | 随机流、几何辅助、材质钩子和环境 uniforms | 已写相邻声明，供模块上下文与工具包使用，待验证。 |
| `@mirage/core` 根入口与其他子路径 | 渲染器、天空／昼夜、大气、雾、星空、后期、材质、随机、LOD、纹理、环境光、设备画质、geom 命名空间 | 根入口、渲染生命周期等尚未声明，不能称为 core 全包有类型。 |
| `@mirage/play` | `createPlay`、`createCharacter`、`bakeWalkGrid`、`makeGrid`、`MAXL`、`createWalker`、`BODY`、`mountWorld` | 尚未声明；后续需覆盖人物、相机与宿主销毁接口。 |
| `@mirage/game` | `startGame`、`createPhysics`、`loadRapier`、`createGame`、`createInput`、输入常量、`createAudio`、`SURFACES`、`createUI` | 尚未声明；后续需覆盖保存格式、实体／触发区、固定步长与输入消费。 |
| `@mirage/tools` | 场景校验、试玩、打包、截图、性能、静态交付和回归命令 | CLI 参数／返回状态为文档约定；无运行时库入口。 |

四个运行时包目前都有 `./* → ./src/*.js` 通配导出，因此许多实现文件也可被消费者导入。
例如 `@mirage/game/simulation`、`@mirage/play/character-model` 与 `/play` 的 `frameGate` 已能被访问，
但尚未决定是否长期支持。**本轮不收窄通配符**，避免使现有项目失去入口；冻结前要列出保留子路径和迁移说明。

## 已写进声明的边界

- 计划输入与补全默认值后的计划分开；`seed: null` 会换成名称，walk、axes 和集合默认项可读。泛型保留自定义字段。
- 坐标用固定长度元组；形状只允许 rect／circle／poly 之一。有限数值、端点顺序、半径、最少点数仍由运行时校验负责。
- build 与 finalize 可异步，anchors 与 ambientVolumes 回调是同步的。挂点在 build 期间可能缺失，声明不把 required 名称当作已经存在。
- 第三方模块的返回值和自定义挂点字段用 unknown，读取前收窄；没有把整个上下文或输出声明为 any。
- grass 可能为 null，空树列表的三个实例批次均为 null，terrain.heightAt 范围外为 null；随机 pick 空列表为 undefined。
- `WorldHost` 只是 loader 使用的结构契约。它不冒充完整 renderer，也不把未声明的 core／play／game 包变成已类型化。

声明随现有 src 一起进入包，JavaScript 默认出口保持原指向。root world 显式给出 types 条件；
已有子路径通过同目录的 `.d.ts` 解析。设计依据见 TypeScript 的[模块解析](https://www.typescriptlang.org/docs/handbook/modules/reference.html)
与[声明发布](https://www.typescriptlang.org/docs/handbook/declaration-files/publishing.html)说明。实际解析要通过[打包消费者验收](TYPES.md)。

## 到冻结前仍要完成

1. 补齐 core 渲染生命周期、play 和 game 的声明，包含资源归属、销毁、事件、存档迁移和低层物理步进的边界。
2. 每批声明通过真实打包后的消费者编译，并在完整运行时回归中确认包出口没有改变行为。
3. 根据 A1、设备实测和使用反馈修正接口；逐项说明哪些字段可变、哪些默认值属于兼容承诺。
4. 决定最终 npm 包名、Three 类型依赖的交付方式、子路径白名单与发布文件；补新项目安装和升级示例。
5. 项目所有者确认后再冻结 1.0、签版本和发布。已有冻结分支与 A1 输入保持原样供比较。
