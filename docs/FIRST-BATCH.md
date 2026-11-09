# Mirage 第一批异机验收

开发分支为 `codex/mirage-first-batch`，基线为 `3d721eb`。三笔提交依次交付物理、场景校验、植被与林缘小径。
截至 2026-11-04，状态为**已实现，待异机验证**。本批在 MacBook Air 上只进行了源码编辑和差异审阅。

后续累计分支另提供[串行验收入口](ACCEPTANCE.md)，包含地形、水面、人物及当前七示例。本页命令继续供冻结的第一批六示例分支对照使用。

## 在测试机串行执行

准备 Node 22.12 或更高的 22.x 版本，以及能使用 GPU 的桌面 Chrome。工具默认使用 macOS 的 Chrome；其他位置通过
`CHROME` 环境变量指定浏览器可执行文件。以下命令从开发分支的仓库根目录执行。保持一次只运行一个 GPU 检查，失败时保留报告。

```sh
npm ci
npm test
node packages/tools/src/validate-plan.mjs examples/garden-quest/plan.js
npm run test:e2e
npm run test:fixed-step
npm run test:touch
npm run test:still-pop
npm run test:gpu-load
npm run verify -w hello-courtyard -- out/verify
npm run metrics -w woodland-path
```

| 项目 | 验收依据 |
|---|---|
| 固定步长 | 两条物理调用路径的 38 组台阶均通过。雪屋脚本在 30、60、90、120、144、165 Hz 下穿过同一门口，终点相对 60 Hz 均小于 1 cm。短按跳跃、一次性交互、触发区、暂停、可见性、传送和读档检查均通过。 |
| 场景协议 | CLI 自动读取所有示例的默认导出，包括继承布局的 garden-quest，以及临时 JSON。错误样例在一次调用中列出边界、形状、路径和视点的具体字段；命令行和引擎给出相同诊断。 |
| 林缘小径 | 网页版与离线 HTML 都能穿草、被树干阻挡并绕过树干。查看近景草叶、侧光树冠和树干转角截图，由项目所有者确认画面。记录中档平均与 P95 帧时间、绘制调用数、三角数和文件字节数。离线 HTML 的上限为 5,000,000 字节。 |
| 整包回归 | 六个示例的构建和试玩、garden-quest 通关、六个单文件及其试玩全部通过。已有触屏、停止移动、GPU 负载检查通过；院子五个光照机位的同帧像素差为零。 |

整包摘要写入 `out/e2e/summary.json`。林缘小径的合并指标写入 `examples/woodland-path/out/acceptance.json`；
其中 `sheet` 字段是相对该示例目录的拼图路径，逐步截图和报告也在同一目录。雪屋脚本直接输出各刷新率终点和重置结果。
交回测试机型号、GPU、Chrome 版本、以上报告和截图，再安排地形、水面、人物及 1.0 后续工作。
