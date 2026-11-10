# 开发说明

原生 HTML / CSS / JavaScript modules，无运行依赖。生产构建为样式、模块、Worker 和图标生成内容指纹，更新相互引用；`asset-manifest.json` 用于核对产物。

## 页面

北欧壁炉为默认皮肤，保留复古暖炉切换。主界面只显示皮肤、档位、倒计时、定时、CPU / GPU 和电源；说明与运行详情放在帮助面板。炉火使用 SVG / CSS，停止计算立即生效，视觉余晖可短暂淡出。支持减少动态效果。

## CPU

| 档位 | 每个线程的工作占空比 | 线程数上限 |
| --- | --- | --- |
| 轻柔 | 30% | 2 |
| 温暖 | 65% | 4 |
| 热烈 | 92% | 8 |

实际线程数为 `max(1, min(档位上限, hardwareConcurrency - 2))`。例如浏览器报告 8 个逻辑处理器时，三档分别使用 2、4、6 个线程；未知并发数按 4 处理。百分比是目标计算工作时长，**不代表整机 CPU 使用率**。

每个 Worker 每 100ms 周期执行目标工作时长，单片约不超过 8ms，使用 MessageChannel 让出事件循环，避免嵌套计时器的最小间隔压低高档负载。主线程不忙等；切换档位时调整线程数并保持原截止时间。

## GPU

独立 Worker 内创建 OffscreenCanvas + WebGL2，优先请求高性能 GPU。片段着色器反复执行数学计算，并在两张 RGBA8 纹理间交替读写。每次只提交一个批次，使用 `fenceSync` / `clientWaitSync` 非阻塞检查完成，再提交下一批，避免积压命令。

| 档位 | 调度目标 | 着色器迭代 | 分辨率上限 |
| --- | --- | --- | --- |
| 轻柔 | 35% | 96 | 768² |
| 温暖 | 65% | 192 | 1280² |
| 热烈 | 90% | 384 | 2048² |

从 512² 开始，按已完成批次的耗时调整分辨率，每秒不超过 60 批；调度目标与批次等待时间均不是实测 GPU 利用率。最多两张 2048² RGBA8 工作纹理，约 32MiB，不含浏览器与驱动开销。

检测到 SwiftShader、llvmpipe 等已知软件渲染器时拒绝 GPU 加热。浏览器或驱动未暴露渲染器详情时，以 WebGL2 的能力与性能限制为准；网页无法控制操作系统选择哪块独立或集成显卡。

GPU 关闭默认不创建上下文；主动开启时才初始化。GPU 不可用时取消 GPU 选中并提示，CPU 可继续。CPU 与 GPU 均未选中时只播放炉火。

## 生命周期

CPU 与 GPU 分别每 250ms 接收心跳，独立检查单调时钟截止时间；约 1.4 秒没有心跳会自行退出。页面隐藏、失去焦点、离开、冻结或到点时停止，返回不自动启动。系统冻结期间浏览器可能暂停全部执行，恢复后再检查。

CPU 直接终止 Worker。GPU 先发送停止消息以释放 GL 上下文，最多等待 80ms 后强制终止；已提交的单个 GPU 批次可能由驱动完成，不再提交后续批次。最长可选时间 5 分钟，用户可主动修改并重新计时。

## 验证

```sh
npm install --no-save --package-lock=false playwright
npx playwright install chromium webkit
npm run build
npm run preview
# 另一个终端
npm run verify
```

`TEST_URL` 可指定目标地址，`PLAYWRIGHT_MODULE` 可指定已有 Playwright 安装。macOS 可通过 `TEST_GPU_BACKEND=metal` 验证实际 Metal GPU；默认软件环境只验证 GPU 不可用路径，不能当作硬件 GPU 验收。

参考：[OffscreenCanvas](https://developer.mozilla.org/en-US/docs/Web/API/OffscreenCanvas)、[WebGLSync](https://developer.mozilla.org/en-US/docs/Web/API/WebGLSync)、[WebGL 实践](https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices)。
