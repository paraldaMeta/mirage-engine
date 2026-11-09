# 旅行者人物 · 异机验收

累计分支可用[串行验收入口](ACCEPTANCE.md)统一留存本页和其他功能的证据；下列命令供单项定位使用。

状态为**源码已实现，画面与性能待异机验证**。人物接在默认等距游戏视角。手动体验时打开河湾浅滩，按 G 显示旅行者，WASD 行走，Shift 奔跑，空格跳跃。正面看围巾和夹克轮廓，背面看背包与肩带，侧面看膝部和鞋底。

在有 GPU 与桌面 Chrome 的测试机上，从开发分支根目录依次执行。每次只运行一个浏览器检查。

```sh
npm ci
npm test
npm run test:e2e -- --only woodland-path,river-ford
node packages/tools/src/character-review.mjs examples/river-ford/dist
node packages/tools/src/character-review.mjs examples/river-ford/release/river-ford.html
npm run metrics -w woodland-path
npm run metrics -w river-ford
```

- 人物检查覆盖蒙皮权重、左右腿交替、行走／奔跑、起跳／下落、落地收势、停止后姿势一致，以及按行进距离重放步态。
- 浏览器检查使用实际玩家模型，各输出八张截图，包括正面、侧面、背面、走、跑、上升、下落和跳后站立。切换飞行、环绕、第一人称和等距模式时核对人物显隐。
- 中档、1280 × 800、同机位同路线，分别显示和隐藏人物，记录绘制调用数、三角数、整帧及渲染部分的平均与 P95 时间。计时包含 GPU 同步。两组均执行骨骼更新，以便单独比较显示人物的渲染开销。
- 图片与 `report.json` 在 `examples/river-ford/out/character-http/` 和 `character-file/`（同级）。报告包含浏览器、GPU、动作状态、模型数据和显隐两组指标。结合截图确认人物比例、肩带与手臂的穿插、鞋底接地及动作辨识度，再定画面。
- 林缘与河湾的现有 `out/acceptance.json` 继续记录场景的单文件大小和中档游走开销，便于同机对照。
