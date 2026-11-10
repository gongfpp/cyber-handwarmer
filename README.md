<p align="center"><img src="public/icon.svg" width="72" alt="小暖图标：奶油白复古暖炉与三根橙色发热管"></p>
<h1 align="center">小暖 · 赛博暖手宝</h1>
<p align="center">把冬天，调暖一点。</p>

一个可直接部署的纯静态网站：奶油白圆角机身、陶土橙炉芯、深棕数码屏和实体感按钮。主动开机后，通过 Web Workers 执行可调计算；也可选择「仅看炉火」，只享受视觉效果。

![桌面浏览器中实际运行的小暖，已启用仅看炉火，显示倒计时、三档按钮与定时按钮](docs/desktop.png)

## 开始使用

需要 Node.js 18 或更新版本；不需要安装运行依赖。

```sh
npm start
```

打开终端显示的 `http://127.0.0.1:4173`。也可以运行 `python3 -m http.server 4173 --directory public`。请通过 HTTP 或 HTTPS 访问；直接双击 HTML 的 `file://` 方式不能可靠加载 JavaScript 模块与 Worker。

1. 选择轻柔、温暖或热烈档，以及 1、3 或 5 分钟。
2. 按「开启暖手」，才会创建计算线程。网页初次打开始终关闭。
3. 电源键和「停止运行」都能立即停止。运行中改档保留倒计时；更改定时则从所选新时长重新计时。
4. 「仅看炉火」会先关闭当前运行。再次按「点亮炉火」后，仅播放轻量 CSS 动效，不启动计算线程。
5. 页面隐藏、离开、冻结或计时结束时关闭；恢复页面不会自动开机。

显示屏展示剩余时间与档位，**不读取或推测设备真实温度**。计算会增加耗电，实际发热取决于设备、散热与浏览器调度，不能保证暖手效果。明显发烫或不适时立即停止，不要遮挡散热口。

<details><summary>手机视口实际截图（390 × 844 的浏览器视口，完整页面）</summary>

![390 像素手机视口中，小暖以单列布局展示标题、完整暖炉、演示开关和停止按钮](docs/mobile.png)

</details>

## 腾讯云静态托管

```sh
npm run build
```

输出在 `dist/`。它与 `public/` 的内容相同，仅包含六个网站文件，无需后端、数据库、API Key、CDN 字体或第三方脚本。所有路径均为相对路径，可部署到根目录或子目录。

**CloudBase 控制台：**进入自己的环境 → 静态网站托管，将 `dist/` **里面的文件**上传到网站根目录，让首页路径为 `/index.html`，默认索引文档设为 `index.html`。也可解压交付的 `cyber-handwarmer-static.zip` 上传。首次试用建议使用独立环境或独立目录，避免覆盖已有网站。

**CloudBase CLI：**已安装并登录腾讯云 CLI 时，在本项目目录执行下面的命令；把环境 ID 替换成自己的真实值。

```sh
npm install -g @cloudbase/cli
tcb login
tcb hosting deploy dist/ -e YOUR_ENV_ID
```

**COS：**上传同样的静态文件，开启静态网站功能，索引文档设为 `index.html`。该项目使用独立同源 Worker 文件，不需要跨域隔离设置。托管服务器应把 `.js` 作为 JavaScript MIME 类型返回，并允许同源 Worker；如果配置 CSP，至少允许 `worker-src 'self'`、`script-src 'self'` 与 `style-src 'self'`。本项目没有使用 Blob Worker、eval 或外部资源。

部署后通过实际托管域名访问，检查所有六个文件返回成功，再验证开机、停止与切换后台。**本交付完成了本地构建与浏览器验证，没有上传至腾讯云，也没有替换任何线上网站。**

官方部署说明：[CloudBase 快速开始](https://docs.cloudbase.net/hosting/quick-start)、[纯静态项目部署](https://docs.cloudbase.net/hosting/web-hosting-static)、[腾讯云 COS 静态网站](https://cloud.tencent.cn/document/product/436/32670)。

## 文件结构

```text
cyber-handwarmer/
├── public/                  # 可直接上传的源文件
│   ├── index.html
│   ├── style.css            # 暖炉造型、响应式与动效
│   ├── app.js               # 交互、状态、计时与页面生命周期
│   ├── load-controller.js   # Worker 池与心跳管理
│   ├── load-worker.js       # 有时间上限的实际计算
│   └── icon.svg             # 原创项目图标
├── scripts/                 # 本地预览、静态打包、浏览器验证
├── docs/                    # 两张实际运行截图
├── dist/                    # npm run build 生成，可直接托管
└── package.json
```

## 负载与停止机制

| 档位 | 每个 Worker 的目标工作占空比 | 线程数 |
| --- | --- | --- |
| 轻柔 | 12% | 最多 2 个 |
| 温暖 | 30% | 最多 2 个 |
| 热烈 | 55% | 最多 2 个 |

线程数为 `max(1, min(2, hardwareConcurrency - 2))`，未知硬件并发数时使用 1 个线程。占空比是每 100ms 周期内的目标计算时长，**不是实测整机 CPU 百分比**；浏览器调度会影响实际负载。每次计算切片不超过约 8ms，之后让出 Worker 线程。主线程不执行忙等计算。

主页面每 250ms 发送心跳。隐藏与离开事件会直接 `terminate()` 全部 Worker；每个 Worker 也独立检查单调时钟截止时间与心跳，超过约 1.4 秒没有心跳就自行关闭。系统冻结期间浏览器可能暂停所有执行，恢复后再检查。最长单次定时为 5 分钟；用户主动修改定时可重新计时。Worker 加载失败时关闭运行并给出提示。

动画使用 CSS，无额外 GPU 压力循环。支持系统减少动态效果偏好；按钮有键盘焦点、选中状态和操作播报，使用手册支持 Escape 关闭。没有分析统计、Cookie、持久化存储或后台网络请求。

## 验证与维护

浏览器验证为可选开发工具，不是运行依赖。若要复现：

```sh
npm install --no-save --package-lock=false playwright
npx playwright install chromium webkit
npm run build
npm run preview
# 在另一个终端中执行
npm run verify
```

可通过 `TEST_URL` 指定预览地址，或用 `PLAYWRIGHT_MODULE` 指向已安装的 Playwright。本次 Chromium 的 15 项检查、WebKit 启停及真实 1 分钟到期均已通过；完整验证范围及限制见工程包附带的 [验收记录](../verification-2026-11-10.md)。改动 `public/` 后重新构建并上传全部六个文件，避免模块版本不一致；界面变动后应更新两张真实截图。

视觉与代码为本项目重新制作；产品形式参考 [云游君的便携小空调](https://ac.yunyoujun.cn/)，未复制其代码、图像或音频。图标与暖炉均由本地 SVG / CSS 构成，不包含外部素材。
