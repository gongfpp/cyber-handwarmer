# 部署到腾讯云 EdgeOne

正式域名：<https://warm.gongfpp.icu/>。

EdgeOne 默认访问地址：<https://cyber-handwarmer-a0z0axp0.edgeone.dev/>。项目名 `cyber-handwarmer`，采用直接上传，当前发布区域为海外。

正式域名的 CNAME 为 `warm.gongfpp.icu.pages.dnsoe5.com`，已配置自动验证的免费 HTTPS 证书。实际访问应以域名与证书检查结果为准。

项目是纯静态网站，不需要服务器、数据库或环境变量。先运行：

```sh
npm run build
```

`dist/` 里包含网站所需的 HTML、CSS、JavaScript 和图标。构建会给资源文件名加入内容指纹，并同步更新模块与 Worker 路径，避免发布后混入旧版边缘缓存。源代码、README 与截图不需要上传到托管目录。

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

如果服务器单独配置了 CSP，应允许同源模块与 Worker：`script-src 'self'`、`worker-src 'self'` 与 `style-src 'self'`。JavaScript 文件需要正确的 MIME 类型。

## 发布后检查

- 页面初次打开为关闭状态，样式与图标完整加载。
- 主动开启能倒计时，切换档位和定时会给出反馈，停止后线程释放。
- 切换标签 / 应用后停止，返回时不自动重启。
- 仅看炉火模式不创建计算 Worker。
- 手机没有横向溢出，HTTPS 正常。

官方资料：[EdgeOne CLI](https://pages.edgeone.ai/document/edgeone-cli)、[部署流程](https://pages.edgeone.ai/document/deployment-overview)、[域名说明](https://pages.edgeone.ai/document/domain-overview)。
