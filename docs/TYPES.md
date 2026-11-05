# 场景作者类型声明 · 第一批

状态：**已实现，待异机验证**。MacBook Air 未运行编译、npm pack、安装或测试。
覆盖 `@mirage/world` 的计划、模块、挂点和三种 kits，以及 core 的 rng／geom／materials／env 子路径。
core 根入口、play 和 game 的类型仍待补，见[完整边界盘点](API-CANDIDATE.md)。

## 怎样编写模块

现有 main.js 可以继续调用引擎，模块逐步改为 TypeScript 或开启 JavaScript 类型检查。
此候选要求消费者提供 Three.js 类型；异机验收固定使用 `typescript@5.9.3`、`@types/three@0.186.0` 和 `three@0.186.1`。
最终的类型依赖打包方式尚未冻结。以下是模块文件，不是完整的渲染器启动代码：

```ts
import { definePlan, type WorldModule } from '@mirage/world';
import { addTerrain } from '@mirage/world/kits/terrain';
import { addGrass } from '@mirage/world/kits/vegetation';

export const plan = definePlan({
  name: 'trail', bounds: [-8, -8, 8, 8],
  ground: { slope: 0.04 },
});

export const terrain: WorldModule<typeof plan> = {
  name: 'ground',
  build(ctx) {
    const land = addTerrain(ctx, {
      bounds: ctx.plan.bounds,
      sample: (x, z) => x * ctx.plan.ground.slope,
    });
    addGrass(ctx, {
      bounds: ctx.plan.bounds, count: 200,
      heightAt: (x, z) => land.heightAt(x, z) ?? 0,
    });
    return land;
  },
};
```

`definePlan` 推导自定义字段；需要显式输入类型时使用 `interface TrailPlan extends PlanInput`，或
`satisfies PlanInput & { ground: { slope: number } }`。由 JSON 等读入的 unknown 仍需运行时校验与收窄。
这些声明不保证有限数值、地形坡度、路径长度或跨模块挂点已经存在。

`WorldModule<Plan, Shared>` 的第二项指定 shared 数据；第三项可描述自定义 loader 宿主上下文。
动态模块结果和自定义挂点字段没有静态关联，默认 unknown。使用 typeof、属性检查或项目自己的类型守卫再读取。
`anchors.required` 的运行时检查发生在所有模块构建之后；在 build 阶段不能直接假设必需挂点存在。

## 测试机编译验收

在累计分支 `codex/mirage-world-types` 的仓库根目录，Node 22.12+ 的 22.x 和 npm 可用后执行。
目标父目录须先存在，最终目录必须是新目录且位于 checkout 外。此检查会联网取得依赖，编译 noEmit，且不启动浏览器。

```sh
mkdir -p "$HOME/mirage-type-review"
npm run test:types -- --out "$HOME/mirage-type-review/run-001"
```

流程是：分别打包 core 与 world → 检查 tarball 文件列表中的 JS／d.ts 配对 → 在新消费者目录安装两个实际 tarball
和固定的编译器／Three 版本 → 分别用 NodeNext、Bundler 解析方式编译。
没有 paths 别名、没有仓库软链接、`skipLibCheck: false`、`strict`、严格可选属性和越界索引检查全部开启。
安装忽略包脚本；不会执行示例 TS／JS 的内容，也不会发包。

正例覆盖自定义字段、默认值、模块共享参数、异步 build、挂点、材质、几何、工具包、JSON Schema 和 JS 检查。
负例用 `@ts-expect-error` 明确要求错误：坐标长度、未知视角、双重形状、异步挂点、未收窄输出与空值误用；
错误若意外消失，编译也必须失败。

`summary.json` 记录返回码、耗时、工具链、tarball SHA-256、打包文件清单和安装锁文件 SHA-256。
同目录保留每步日志、两个配置、源码用例、tarball、消费者 package.json 和 package-lock.json。
顶层工具版本已固定；其传递依赖在首次测试机安装时才生成锁文件，需随证据保存，后续发布候选再采用审核后的固定锁文件。
`passed` 只代表本批声明通过，两种解析均为 0 才成立；不代表引擎或完整 API 已验收。

累计分支的[整包串行验收](ACCEPTANCE.md)已在运行时检查之前接入此项，证据保存在整包目录下 `types/`。
本批源码没有新增运行时依赖，也没有将编译器放进世界的单文件 HTML。
