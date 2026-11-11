# Mirage 人工验收记录 · run-006

自动检查通过只代表当前桌面环境；不要据此将手机、其他浏览器或 1.0 标为通过。

- 提交 SHA：`f05ccca`（分支 `claude/mirage-1.0-finish`：main `d50cd3f` + 林缘地平线 + 第二轮全量代码审查的修复）
- summary.json 路径：本目录 `summary.json`（完整证据目录在测试机 `~/mirage-acceptance/run-006`，未入库）
- 机器代号与浏览器版本：racso-mac-mini-m4pro（Mac mini Mac16,11，Apple M4 Pro，64 GB，macOS 26.6.2，交流电，120 Hz）；Chrome 156.0.8078.80，ANGLE Metal
- 评审人／日期：Claude Code 初看 2026-11-09；**所有者确认：待**
- 本次判定：自动检查 `machine-pass-pending-review`（全部 18 步通过）；人工项待所有者
- 跑法：从同一提交的干净 detached checkout 运行（源 checkout 里有未跟踪的 `.claude/`，验收器按规定拒绝）

| 项目 | 实际观察／截图或录像路径 | 结论（待验收／通过／失败） |
|---|---|---|
| 林缘：草可穿过、树干阻挡并可绕行；草叶近景与侧光树冠 | `woodland-path.jpg`。playtest 8 / 8。**地平线已改**：草地外是一片逐渐没入雾气的树林（760 棵远树，26–170 m），原来那条生硬的灰带没有了。medium 3.68 ms，356,862 三角（预算 400,000），32 次绘制 | 待验收（初看：通过） |
| 河湾：两岸与河床贴地，水面不阻挡，水岸交线与透底合理 | `river-ford.jpg`。playtest 8 / 8；medium 3 ms，31 次绘制，180,722 三角 | 待验收（初看：通过） |
| 旅行者：自然比例，夹克／围巾／背包可辨，手臂不严重穿肩带 | `traveller.jpg`：正面、侧面、背面、走、跑、上升、下落、站回 | 待验收 |
| 旅行者：八种姿势、步态、跳落地、脚底接地、切换视角显隐 | 八张图齐；显隐：游戏视角显示，走、飞、环绕隐藏（report.visibility） | 待验收 |
| 人物显隐同机对照：平均／P95 帧时间、绘制调用、三角数 | 河湾 medium：隐藏 2.16 / 2.3 ms、31 次、180,722 三角；显示 2.22 / 2.3 ms、33 次、186,138 三角（+0.06 ms，+2，+5,416） | 待验收（初看：开销可以忽略） |
| 暂停恢复、切回标签页、传送／读档不飞移；快速点按不丢跳跃／重复交互 | 固定步长：雪屋门口 30 / 60 / 90 / 120 / 144 / 165 Hz 终点完全相同，镜头误差 0，存档误差 3e-6 m | 待验收 |
| 七示例 HTTP 与单文件的画面和操作 | e2e 29 / 29（七个示例 × 构建、dist、单文件、file://，加 garden-quest 通关的 main / pad / touch / lifecycle）。单文件 0.89–4.55 MB，都 ≤ 5,000,000 字节 | 待验收 |
| 院子五个光照静帧一致（still-identity） | golden、golden-dof、dusk-lanterns、night 等：同一帧号逐像素一致（max 0）。`taperedTube` 朝向修正后棕榈树干画面会变，但这一步比较的是同一构建内的重复渲染，不是旧截图 | 通过（自动） |

## 本轮新增的浏览器检查（不在验收器里，单独运行，都在本机通过）

- `node packages/tools/bake-check.mjs`：十层叠放时地面仍保留（旧代码走不进去）
- `node packages/tools/dispose-check.mjs`：在宿主页面的输入框里打字不会让人走；`dispose()` 还回相机镜头（旧 play.js 两项都失败）
- `node packages/tools/rebind-check.mjs examples/garden-quest/dist`：菜单关闭后不再残留"按一个键"的等待（旧 UI：jump 被绑成 W）

## 另外的 1.0 门槛

| 门槛 | 测试环境／提交／证据与观察 | 结论 |
|---|---|---|
| 手机真机 | 没有设备（所有者决定这次不做） | 待验收 |
| 集显 | 没有设备（同上） | 待验收 |
| Firefox、WebKit 与真 Safari | 见 STATUS-1.0 | 待验收 |
| A1 | 见 STATUS-1.0 | 待验收 |
| GPU CI | 工作流在；所有者决定暂不注册自托管 runner（公开仓库的安全考虑） | 待验收 |
| API 与发布 | 类型消费者 NodeNext / Bundler 都通过；`npm run test:pack` 通过；包名定为 `@miragekit/*`（scope 能否注册待所有者登录 npm 确认） | 待验收 |
