# 发布清单（只列步骤，**都还没做**）

下面每一步都要**仓库所有者本人确认后**才执行；Agent 不推送、不改可见性、不登录任何账号、不发帖。

## 1. 公开前

- [ ] 最后一轮回归：`npm test`，五个示例的 playtest（dist 和单文件各一次），garden-quest 的 playthrough，院子的静帧一致性检查（`ONLY=golden node scripts/verify.mjs out/verify`），各单文件体积（见 `docs/M5-notes.md`）。
- [ ] 通读 README.md / README.zh-CN.md，在 GitHub 网页预览里看一遍图片和链接。
- [ ] 确认仓库里没有：具体城市或地方内容的代码、Golden Temple 的代码、密钥、令牌、个人信息（`git grep -i -E 'token|secret|api[_-]?key'`）。展示图只在 `docs/media/showcase/`，且图注不点地名。
- [ ] **压缩历史**（需要所有者同意，会强制推送）：把现有提交压成一个干净的初始提交，例如
      `git checkout --orphan clean && git add -A && git commit -m "Mirage 0.1.0" && git branch -M clean main && git push -f origin main`。
      执行前备份：`git branch backup-before-squash main`（或打一个本地 tag）。

## 2. 公开

- [ ] 把 GitHub 仓库改成 public（所有者在 Settings → General → Danger Zone 里操作）。
- [ ] 设置 Description：「A code-only world engine for AI agents: build whole places in three.js as code, in parallel, and ship them as one file.」
- [ ] 设置 Topics：`threejs`、`webgl`、`game-engine`、`procedural-generation`、`ai-agents`、`agent-skills`、`claude-code`、`world-building`。
- [ ] 打 tag `v0.1.0`，GitHub Release 正文用 `CHANGELOG.md` 的 0.1.0 一节，附上 `examples/demos/release/*.html` 和五个示例的单文件。

## 3. 礼节和传播

- [ ] 发布前给 Leon Lin（Golden Temple 作者）发一条消息：说明 Mirage 的渲染技术思路学自 Golden Temple、没有复制代码、NOTICE 里保留了许可和致谢；问他是否愿意被列为致谢。
- [ ] 录一段短的延时视频：几个 Agent 并行各建一个模块（终端分屏 + 每个模块的联系表 + 最后合成的世界），1 分钟以内。
- [ ] 把演示部署成静态链接（`node packages/tools/src/deploy.mjs examples/demos/day-night` 之类，生成的文件夹由所有者自己上传到 GitHub Pages / Netlify / Cloudflare Pages），然后在 README 里补上链接，再发帖。

## 4. 离 1.0 还差什么

- 浏览器和设备：Safari、Firefox、手机真机都没测（CURSOR-TASKS A2、A3）；触屏不能跑；没有弱 GPU 的预算档。
- 一条命令跑完全部端到端测试（A4），并接进 CI（需要带 GPU 的 Chrome）。
- 共用的地形、植被、水面工具包（现在每个世界自己写；B11、C4）；人物还是占位方块。
- 碰撞：走动网格只在加载时烘焙一次；Rapier 角色在几厘米的小台阶上会卡（snow-hut 遇到过）；没有触发区和碰撞事件（B3、B6）。
- 移动时的拖影和清晰度突变（B1、B2、B5）；夜里无月时的曝光（B12）。
- 总平面图的 schema 文件、模块声明自己消费的挂点（B15）。
- 技能包需要更多轮盲测，包括 Codex 和 Cursor 实际跑一次（A1）。
- 发到 npm：确定包名、导出、类型声明（d.ts）和稳定的公开接口；文档站。
