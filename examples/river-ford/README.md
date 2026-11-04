# River Ford · 河湾浅滩

这条路线从西岸下坡，穿过水下河床，再登上东岸。地形和水面分别使用 `@mirage/world/kits/terrain` 和
`@mirage/world/kits/water`。碎石、树木和岸草用地形的 `heightAt` 定位。水面的法线随世界时钟变化，碰撞由河床提供。

## 测试机验收

状态为**源码已实现，画面与性能待异机验证**。在配备 GPU 和桌面 Chrome 的测试机从仓库根目录依次执行以下命令。

```sh
npm ci
npm test -w @mirage/world
npm test -w @mirage/game
npm run test:e2e -- --only river-ford
npm run metrics -w river-ford
```

- CPU 检查将地形查询值和向下射线的网格交点比对，覆盖两片三角形、对角线、边界和范围外坐标。水面检查覆盖凹多边形、液面高度和碰撞标记。游戏层另用 Rapier 射线穿过不透明水面，核对河床高度和表面材质。
- 浏览器分别打开 HTTP 网页和离线 HTML，沿同一路线检查双脚高度。两岸约 1.15 米，浅滩中央约 −0.65 米，水面为 0 米。
- 对照西岸、贴水视角、东岸碎石和河湾全景四张固定机位图。观察水岸交线、岸草是否贴地、浅水的透底效果和侧光下的波纹。
- 中档指标包括平均与 P95 帧时间、绘制调用数、三角数及离线文件字节数。文件目标为 ≤ 5,000,000 字节。报告在本示例的
  `out/acceptance.json`，两套拼图在 `out/playtest/sheet.png` 和 `out/playtest-file/sheet.png`。请一并记录机型、GPU、Chrome 版本。

要把林缘小径和本场景一起验收，可改用 `npm run test:e2e -- --only woodland-path,river-ford`，然后依次执行
`npm run metrics -w woodland-path` 和 `npm run metrics -w river-ford`。
