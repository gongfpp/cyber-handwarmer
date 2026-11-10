# 部署到腾讯云 EdgeOne

正式域名：<https://warm.gongfpp.icu/>。

EdgeOne 默认访问地址：<https://cyber-handwarmer-a0z0axp0.edgeone.dev/>。项目名 `cyber-handwarmer`，采用直接上传，当前发布区域为海外。

正式域名的 CNAME 为 `warm.gongfpp.icu.pages.dnsoe5.com`，已配置自动验证的免费 HTTPS 证书。实际访问应以域名与证书检查结果为准。

网页使用静态托管，累计统计使用同项目的 EdgeOne 边缘函数与 Blob 存储，无需自建服务器或配置密钥。先运行：

```sh
npm ci
npm run build
```

`dist/` 里包含网页资源、`edge-functions/api/warmth.js` 和供平台安装函数依赖的 `package.json`。部署时保留完整目录结构，平台会编译函数并注入 Blob 的项目认证。只上传 HTML 等静态文件仍可使用暖炉，但不会显示累计统计。构建给资源文件名加入内容指纹，避免发布后混入旧版缓存。README 与截图不需要上传。

## 使用 EdgeOne CLI

安装并登录官方 CLI：

```sh
npm install -g edgeone@1.7.1
edgeone login
edgeone whoami
```

在工程目录上传到自己的项目：

```sh
edgeone makers deploy dist/ -n cyber-handwarmer -e production --area overseas
```

CLI 使用本机登录状态，不要把 Token 放进代码、提交记录或公开文档。若已有同名项目，应先确认该项目属于自己且用于小暖；换一个名称可以创建独立项目。

## 使用控制台

在 EdgeOne Makers / Pages 中新建项目，选择直接上传，将 `dist/` 内的全部文件上传。也可以导入自己的 GitHub 仓库，框架选 Other，构建命令 `npm run build`，输出目录 `dist`。

在项目的域名管理中添加自己的域名，按控制台给出的实际 CNAME 配置 DNS。只修改对应子域名记录，不替换其他网站的解析。待解析验证和 HTTPS 证书签发完成后，再使用自己的域名访问。

如果服务器单独配置了 CSP，应允许同源模块与 Worker：`script-src 'self'`、`worker-src 'self'`、`connect-src 'self'` 与 `style-src 'self'`。JavaScript 文件需要正确的 MIME 类型。

## 累计统计

`GET /api/warmth` 返回 `{ visitors, sessions, litMs, scope }`。主动开启后 `POST` 随机 `visitorId`、`runId` 与本次累计 `litMs`，每 30 秒和停止时报告；隐藏或离开时尝试发送最后一份。异常关闭或网络失败可能丢失最后一个间隔的数据，不回填猜测值。展示时间换算为整秒并向下取整。

Blob 的 `little-warmth-live-v1` 命名空间保存正式域名和项目默认域名的数据；其他预览域名使用 `little-warmth-preview-v1`。部署不清空存储。没有历史埋点，不导入或补造旧数字。正式站自动化验收不写入统计。

存储键为 `runs/<visitor>/<run>/<累计毫秒>`，汇总取每次开启的最大值，再按浏览器标识去重。这个方法不依赖读后加一，重试、乱序和并发上报不会重复累加时长。实例内读取缓存 30 秒，写入后失效；当前小站按键列表聚合，大规模增长后应另做汇总。该匿名统计不是防刷或严格人数认证。

本地临时内存统计（重启清零，不连接正式存储）：

```sh
npm run build
STATS_LOCAL=1 PORT=4174 node scripts/serve.mjs dist
```

自动化测试使用 `TEST_URL=http://127.0.0.1:4174 npm run verify:community`；浏览器写入验证仅对非正式域名的 `?stats_test=1` 且 API 确认 `preview` 时启用。正式域名始终排除自动化上报。

## 发布后检查

- 页面初次打开为关闭状态，样式与图标完整加载。
- 主动开启能倒计时，切换档位和定时会给出反馈，停止后线程释放。
- 切换标签 / 应用后停止，返回时不自动重启。
- 仅看炉火模式不创建计算 Worker。
- 手机没有横向溢出，HTTPS 正常。
- `/api/warmth` 返回 JSON 与正确 scope，累计小字可见；失败时不显示占位数字。

官方资料：[EdgeOne CLI](https://pages.edgeone.ai/document/edgeone-cli)、[Blob 存储](https://pages.edgeone.ai/document/blob-storage)、[边缘函数](https://pages.edgeone.ai/document/edge-functions)、[域名说明](https://pages.edgeone.ai/document/domain-overview)。统计展示参考了 [eo-counter](https://github.com/weigo6/eo-counter) 对访问量与独立访客的区分，页面只保留用户需要的一行累计信息。
