# 运行时生命周期与资源归属（候选）

2026-11-07。会话销毁实现和声明均已写入，**待异机编译及运行验收**。
本轮没有执行 WebGL、浏览器、测试、编译、打包或依赖安装。

## 渲染器

`createWorldRenderer(options)` 立即创建 GPU 相关对象；之后向 scene 添加内容，等待纹理加载，
调用 `await world.prepare()`，再由宿主驱动 `tick(dt)` 和 `renderFrame(seconds, options)`。
`prepare()` 会编译材质并捕获环境光，属于测试机操作。

创建后 `world.light` 和 `world.state` 为 null；`setTime()`、`prepare()` 或第一次 `renderFrame()` 才初始化它们。
手工调用 `captureEnv()` 前先初始化光照。`setTime(time, { ease: true })` 需要后续 tick 才推进曝光与环境光过渡。
`ctx.onUpdate(fn)` 在每个渲染子帧调用，参数为场景时间；不是物理时钟，返回数字计数而非取消函数。
碰撞、触发区和保存位置应继续使用游戏层的真实角色位置。

`resize()` 更新渲染尺寸、主相机和后期目标，并清除时域历史。`renderFrame()` 支持透视或正交相机，
输出到 WebGLRenderTarget，传 null 则输出到画布。宿主需保证销毁时没有仍在执行的 prepare 或渲染回调。

| 对象／方法 | 当前释放内容 | 宿主仍需负责 |
|---|---|---|
| `world.dispose()` | 后期管线、环境光对象、场景中可遍历到的几何和材质（及其着色器程序）、太阳的阴影贴图；自行创建的 WebGLRenderer | 先停止所有驱动循环；管理纹理及外部监听器；要保留的对象先移出场景，避免释放其他场景仍共用的几何和材质。 |
| 注入 `options.renderer` | world 销毁时保留这台 renderer | 注入方最终释放 renderer；创建世界会改动尺寸、色调映射和阴影设置，销毁不会恢复这些设置。 |
| `Pipeline.dispose()` | 自有渲染目标、后期材质、Bloom、全屏四边形 | 不释放传入 renderer、场景或外部输出 target。 |
| `EnvironmentLight.dispose()` | 捕获目标、PMREM 和混合资源 | 不释放传入 renderer。texture 在首次捕获前为 null。 |
| `TextureLibrary.dispose()` | 库已加载的纹理 | 调用方释放 material() 返回的材质；ready() 失败会记录日志并继续 resolve，不能只凭完成判定纹理都成功。 |
| `MountedWorld.dispose()` | 先把宿主的 root 移出场景，再委托 world.dispose()；挂载中途失败时也会释放已建的世界再抛错 | 宿主循环和 renderer；宿主放进 root 的对象由宿主释放。 |
| `Character.dispose()` | 移除角色 root，释放几何；几何上的监听器同时释放骨骼和角色材质 | 场景中其他对象。直接 dispose 角色几何也会触发这个释放链。 |

这些方法没有承诺可重复销毁、销毁后继续调用，或并发 prepare／dispose 安全。
`installFog()` 修改 Three 的全局 shader chunks，不随某个世界销毁而撤销。
`createLod().reset()` 只是恢复原网格显示，不销毁生成的简化网格。

## 游走与游戏

单独使用 `createPlay()` 时，`stop()` 暂停自动帧，仍可手动 `step(dt)` 或 `start()`。
`play.dispose()` 同步取消帧、解绑控制器与监听、移除 HUD、帮助和人物，释放自有渐进渲染目标。
可以重复调用。传入的世界、画布、renderer、walker 和 simulation 归宿主。

使用 `startGame()` 时，整段会话只需要一个出口。销毁开始时立即停止输入和模拟，
取消待绑定的按键（以 null 完成），移除菜单和实体根节点，释放 Rapier 世界及已登记的资源。
返回的 Promise 等待已解锁的 AudioContext 关闭；重复调用返回同一 Promise。等待完成后即可在同一个世界启动下一场。

```js
const session = await startGame(world, { built, setup({ onDispose }) {
  // Register resources at allocation, including objects later removed by gameplay.
  const material = world.mat.std({ color: 0xbaa071 });
  onDispose(() => material.dispose());
} });
await session.dispose();
// Only when the host itself is finished:
world.dispose();
```

`setup(ctx)` 可以用 `ctx.onDispose(fn)` 登记**同步**清理。回调按登记的逆序执行；
即使 setup、prepare 或后续挂载失败，也会清理已取得的资源并让 startGame 拒绝。
由 setup 创建的材质、纹理、几何和外部订阅需自行登记。借用的资源由原所有者管理。
切换时先等待旧会话销毁，再创建新会话。底层 Rapier 刚体和控制器只在所属世界存活时有效。

独立创建的 input、ui、simulation、physics、game 均有同步 `dispose()`；audio 使用 `await audio.dispose()`。
`game.on()` 返回退订函数。游戏数据、输入状态和浏览器存档各有自己的生存期，销毁不会删除存档。

## 存档边界

`snapshot(extra)` 与 `save(slot, extra)` 保留 extra 的字段类型；extra 最后展开，甚至可以覆盖 time／v 等标准字段。
声明准确反映覆盖行为，但建议只放自定义字段。`game.load()` 空槽位返回 null；
`session.load()` 空槽位抛错，数字代表槽位，字符串始终视为 JSON 文本。
`session.save('export')` 返回字符串，数字槽位返回含 player 的快照。

restore/importJSON 目前只检查版本号，不进行完整内容校验，因此返回的额外数据为 unknown；
loadSettings 也返回 unknown。读取前用应用的校验与类型守卫收窄。
声明不是 JSON 校验器，不保证非法存档不会在恢复过程中改变游戏状态。

## 测试机需要补的证据

先按 [TYPES.md](TYPES.md) 运行消费者编译，再按 [ACCEPTANCE.md](ACCEPTANCE.md) 运行串行验收。
garden-quest 的 playthrough 新增 lifecycle，连续三次销毁同一世界上的会话，覆盖菜单打开、按键捕获中、音频已解锁／尚未解锁、同一 renderer 再次出图及旧循环停止。
每次记录 renderer.info.memory 的几何与纹理计数供同机比较。game 的 Node 用例覆盖异步 setup 失败回滚。
