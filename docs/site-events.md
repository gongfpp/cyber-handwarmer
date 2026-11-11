# 自建网页事件

已登记正式域名使用 stats.gongfpp.icu 的独立 site-events 接口；服务端依站点和 Origin 标记发布渠道，不相信客户端声明。仅记录 page_view、控件类型/页面区域枚举的 ui_click、可见时长 page_engagement。不发送文字、输入、查询参数、hash、referrer 或游戏业务数据。页面会话不等于跨页完整旅程。

复用本站90天随机浏览器标识，尊重 DNT/GPC 和原有统计关闭开关。累计人数与原脚注共用去重，事件次数不能当人数；新网页报表与原产品/玩法事件分开展示，不相加。历史不回填。

客户端契约验收：node tools/test-site-events.cjs。QA仅显式注入 siteEventsQaRunId（UUID），使用内存身份并写独立QA表，必须同时拦截旧计数器及其它产品上报。QA不绕过任何隐私选择，不支持URL自动测试模式。生产验收另核实际脚本SHA与服务端QA回执。

当前客户端 SHA256：fc1953ec845b25ba5017fd3889c2426b2e3b4c6f87fbe9cb40eb8e69819009af。
