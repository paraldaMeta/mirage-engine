# 运行时生命周期与资源归属（候选）

2026-11-06。描述当前实现，不是新增的销毁机制或 1.0 承诺。相邻声明已写入，**待异机编译及运行验收**。
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
| `world.dispose()` | 后期管线、环境光对象、场景中可遍历到的几何；自行创建的 WebGLRenderer | 先停止所有驱动循环；管理一般材质、纹理、阴影目标及外部监听器；避免释放其他场景仍共用的几何。 |
| 注入 `options.renderer` | world 销毁时保留这台 renderer | 注入方最终释放 renderer；创建世界会改动尺寸、色调映射和阴影设置，销毁不会恢复这些设置。 |
| `Pipeline.dispose()` | 自有渲染目标、后期材质、Bloom、全屏四边形 | 不释放传入 renderer、场景或外部输出 target。 |
| `EnvironmentLight.dispose()` | 捕获目标、PMREM 和混合资源 | 不释放传入 renderer。texture 在首次捕获前为 null。 |
| `TextureLibrary.dispose()` | 库已加载的纹理 | 调用方释放 material() 返回的材质；ready() 失败会记录日志并继续 resolve，不能只凭完成判定纹理都成功。 |
| `MountedWorld.dispose()` | 委托 world.dispose() | 宿主循环和 renderer；宿主放进 root 的几何也在 world 的遍历释放范围内。 |
| `Character.dispose()` | 移除角色 root，释放几何；几何上的监听器同时释放骨骼和角色材质 | 场景中其他对象。直接 dispose 角色几何也会触发这个释放链。 |

这些方法没有承诺可重复销毁、销毁后继续调用，或并发 prepare／dispose 安全。
`installFog()` 修改 Three 的全局 shader chunks，不随某个世界销毁而撤销。
`createLod().reset()` 只是恢复原网格显示，不销毁生成的简化网格。

## 游走与游戏

`createPlay()` 创建 DOM 控件、监听器并立即开始动画循环。`stop()` 只停止循环调度，`start()` 可重新开始；
停止后可用 `step(dt)` 手动驱动。`stop()` 不注销监听器，不清除 UI，不释放渐进渲染目标、人物或 OrbitControls。
**目前没有 play.dispose()、session.dispose()、input.dispose() 或 ui.dispose()。** 类型不会声明这些不存在的方法。

`startGame()` 异步创建物理和控制层，再启动 play；必须提供明确的 plan.spawn。
`ui: false` 时 session.ui 为 null，session.game.ui 仍有无操作的消息接口；setup 执行时 game.ui 尚未赋值。
`createSimulation()` 将角色、物理和 game.tick 放到同一 60 Hz 时钟，viewPosition 仅供显示插值；
reset 清空累计时间和跳跃边沿，并对齐两端位置。它的暂停订阅目前也没有集中注销入口。

`game.on()` 返回可调用的退订函数（返回值是 Set.delete 的 boolean）；自定义事件数据默认 unknown。
`game.reset()` 保留实体、系统和订阅。`input.clear()` 清输入状态，不移除 DOM 监听器。
`audio.ctx` 在用户手势解锁前可能为 null，play() 也可能返回 null；suspend() 不是释放资源。
物理层暴露真实 Rapier 类型，低层调用者自行管理 `physics.world.free()`；不能在仍有模拟回调执行时释放它。
这些分散的入口并不构成可靠的整场景热切换方案，统一销毁与重复挂载仍是 1.0 前的实现工作。

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
声明用例包含生命周期调用和空值误用，但它们不执行这些调用，不能证明资源已被释放。
在后续生命周期实现提交中，需补自动运行用例验证重复创建／销毁、共享 renderer 仍可用、
事件没有重复触发、后台恢复和传送后插值正确，并记录 GPU 资源计数。
当前统一销毁缺口与 Rapier NodeNext 兼容问题均不能用“类型已写”关闭。
