# 开发说明

原生 HTML / CSS / JavaScript modules，无运行依赖。生产构建按内容为资源生成文件名，同步更新模块和 Worker 引用；`asset-manifest.json` 用于核对产物。

## 硬件信息的边界

`adaptive-policy.js` 使用浏览器提供的逻辑处理器数量、可选的近似内存档位，GPU 开启后再查询实际 WebGL 渲染器和纹理限制。浏览器可能少报核心数，不一定提供内存或精确显卡型号；网页不能读取机身温度、整机 CPU / GPU 利用率或完整硬件清单。

信息仅用于本页调度，不持久化、不上传。未知核心数按 4 处理，调度上限为 64 线程；报告内存不超过 1GiB 时上限为 4 线程，不超过 2GiB 时上限为 8 线程。

## CPU：校准、渐进升载、按响应降载

| 档位 | 目标线程数 | 每线程目标工作比例 |
| --- | --- | --- |
| 轻柔 | 可用逻辑处理器的 25%，向上取整 | 40% |
| 温暖 | 可用逻辑处理器的 65%，向上取整 | 82% |
| 热烈 | 可用逻辑处理器全部 | 99% |

例如浏览器报告 8 核且没有低内存限制时，目标分别为 2、6、8 线程。表中的工作比例是调度目标，不是整机利用率。

首次主动开始后，在一个 Worker 内用同一算术内核进行 14 个约 6ms 的短切片：前 2 片预热 JIT，后 12 片测量迭代速度。按每批约 0.35ms 选择 128–8192 次迭代的检查间隔。每个工作切片约 6ms，使用 MessageChannel 让出事件循环，不在主线程忙等。

温暖和热烈从目标线程数减一、最高 75% 工作比例开始。每 750ms 检查一次：

- 连续两个窗口主线程延迟低于 30ms、Worker 平均周期超时低于 90ms：增加一个线程、工作比例增加 8 个百分点，直到目标。
- 连续两个窗口主线程延迟超过 80ms，或 Worker 平均周期超时超过 180ms：减少一个线程、工作比例减少 12 个百分点。
- 单次抖动不直接降载；中间状态保持。切换档位立即应用新上限并保留截止时间。

Worker 计时反映其自身工作时间和调度延迟，不是操作系统 CPU 计数器。调度器用于尽量增加本页负载并保持响应，不能识别所有温度、系统功耗或其他应用的性能状态。

## GPU：优先硬件计时

独立 Worker 内创建 OffscreenCanvas + WebGL2，优先请求高性能 GPU。片段着色器执行数学计算，结果在两张 RGBA8 纹理之间交替读写。始终只有一个 GPU 批次在途，使用 fence 非阻塞等待，避免命令积压。

支持 `EXT_disjoint_timer_query_webgl2` 时记录 GPU 命令的实际耗时，丢弃 disjoint / 无效样本；不支持时回退到完成等待时间，并明确标记测量方式。GPU 时间和等待时间分开，不冒充整机 GPU 利用率。

| 档位 | 调度目标 | 初始迭代次数 | 目标单批 GPU 时间 | 分辨率上限 |
| --- | --- | --- | --- | --- |
| 轻柔 | 35% | 96 | 8ms | 768² |
| 温暖 | 75% | 192 | 18ms | 1536² |
| 热烈 | 99% | 384 | 35ms | 2048² |

从 512² 开始，每 6 个完成批次根据 GPU 时间调整分辨率。达到分辨率上限仍偏轻时增加迭代次数，最多 768 次。取消与画面无关的 60fps 计算限额；高档在一个批次完成后尽快提交下一个。主线程延迟超过 80ms 时降低批次目标和调度强度。

分辨率还受实际 WebGL 限制及内存提示约束，低内存设备不超过 1024²；最多两张 2048² RGBA8 工作纹理，约 32MiB，不含驱动开销。

已知软件渲染器（如 SwiftShader、llvmpipe）被拒绝。浏览器未暴露渲染器详情时依赖可用 WebGL 能力，不能保证操作系统选择某块独立显卡。GPU 初次主动开启时才创建上下文；不可用时取消选中并提示，CPU 可继续。两种设备都关闭时只播放炉火。

## 可见性与停止

**失去焦点不等于页面隐藏。**网页仍可见时切换到活动监视器继续运行；可以把两个窗口并排查看。切换标签、最小化或被浏览器判定隐藏时立即停止，返回不自动重启。

CPU 与 GPU 每 250ms 接收心跳，独立检查单调时钟截止时间；约 1.4 秒没有心跳会自行退出。离开页面、冻结或到点也停止。系统冻结可能暂停所有执行，恢复后再检查。

CPU 直接终止 Worker。GPU 先请求释放 GL 上下文，最多等 80ms 后终止；已提交的单批可能由驱动完成，不再提交后续批次。最长可选时间 5 分钟，修改定时会重新计时。

## 验证

```sh
npm install --no-save --package-lock=false playwright
npx playwright install chromium webkit
npm run build
npm run preview
# 另一个终端
TEST_GPU_BACKEND=metal npm run verify
```

macOS 使用 Metal 验证硬件 GPU；其他环境省略 `TEST_GPU_BACKEND`。`TEST_URL` 可指定站点，`PLAYWRIGHT_MODULE` 可复用已有 Playwright。

策略检查覆盖不同核心数、信息缺失、低内存、升降载及切档边界；浏览器检查覆盖实际 Worker、GPU 硬件计时、停止与界面。整机占用需通过操作系统工具或开发测试的进程 CPU 时间差来测量，普通网页无权直接读取。

资料：[逻辑处理器提示](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/hardwareConcurrency)、[可见性与焦点](https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API)、[GPU 计时扩展](https://developer.mozilla.org/en-US/docs/Web/API/EXT_disjoint_timer_query)、[Chrome 进程 CPU 时间接口](https://chromedevtools.github.io/devtools-protocol/tot/SystemInfo/)。
