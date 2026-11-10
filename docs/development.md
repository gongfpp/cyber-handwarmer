# 开发说明

小暖使用原生 HTML、CSS、JavaScript modules 和同源 Web Workers。运行与构建不需要第三方依赖。生产构建会给样式、脚本、Worker 和图标生成内容指纹，首页引用对应的版本；`asset-manifest.json` 用于核对产物和独立 Worker 检查。

## 目录

- `public/index.html`：页面与使用手册。
- `public/style.css`：暖炉造型与响应式布局。
- `public/motion.css`：开关机炉光、选档滑块、数字变化与按钮动效。
- `public/app.js`：交互、倒计时、页面生命周期与指针反馈。
- `public/load-controller.js`：Worker 池、错误处理与心跳。
- `public/load-worker.js`：有上限的实际算术计算。
- `public/icon.svg`：项目图标。
- `scripts/`：本地预览、构建与浏览器检查。
- `docs/desktop.png`、`docs/mobile.png`：真实运行截图；界面修改后同步更新。

## 计算与停止

| 档位 | 每个 Worker 的目标工作占空比 |
| --- | --- |
| 轻柔 | 12% |
| 温暖 | 30% |
| 热烈 | 55% |

线程数为 `max(1, min(2, hardwareConcurrency - 2))`；未知硬件并发数时使用 1 个。这些百分比是每 100ms 周期内的目标计算时长，不是整机 CPU 使用率，实际值受浏览器调度影响。每次 Worker 忙等切片约不超过 8ms，主线程不执行忙等。

主页面每 250ms 发送心跳；页面隐藏、失去窗口焦点、离开、冻结或计时结束时直接终止全部 Worker。Worker 自身也检查单调时钟截止时间，超过约 1.4 秒没有心跳会自行关闭。系统冻结时可能暂停所有执行，恢复后再检查。

最长可选定时为 5 分钟。用户主动修改定时会重新计时；改档保留剩余时间。仅看炉火模式不启动 Worker。停止计算立即生效，炉光淡出只是短暂的视觉动效。

## 动效与交互

炉芯使用伪元素透明度完成逐根亮起与关机淡出，避免依赖不可插值的背景渐变。档位选中块通过 transform 滑动，数字只在变化时触发短动画；进度条按时间持续更新。桌面指针倾斜限制在很小的角度，触屏和减少动态效果模式均不启用。

所有动效使用本地 CSS，没有额外 GPU 负载循环、声音、图片、字体或第三方动画库。负载启动和停止不依赖动画完成。

## 检查

可选安装 Playwright 来复现浏览器检查；它不是网站运行依赖。

```sh
npm install --no-save --package-lock=false playwright
npx playwright install chromium webkit
npm run build
npm run preview
# 另开一个终端
npm run verify
```

使用 `TEST_URL` 指定目标地址，或使用 `PLAYWRIGHT_MODULE` 指向已有 Playwright。

检查覆盖默认不运行、真实 Worker 启停、档位和定时切换、模拟页面隐藏与离开、到点停止、独立 Worker 心跳失效、加载失败、快速取消启动、七种视口宽度与 WebKit 基本启停。真实手机锁屏、整机 CPU、电池消耗和机身温度仍需实机检查。
