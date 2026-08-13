# KiwiVM 流量监控配置

Control Center 的网络概览通过 KiwiVM `getServiceInfo` 只读接口显示搬瓦工 VPS 的流量状态。它不会修改、重启或重装 VPS，也不会更改 Xray/VLESS。

## 本地凭据

项目已经创建被 Git 忽略的本地文件：

```text
.private/kiwivm.env
```

把两个占位值替换为 KiwiVM 控制面板提供的真实值：

```dotenv
KIWIVM_VEID=replace_me
KIWIVM_API_KEY=replace_me
```

确认权限仅允许当前用户读取和写入：

```bash
chmod 600 .private/kiwivm.env
```

`.private/` 整体位于 `.gitignore` 中。不要把真实 Key 复制到模板、日志、测试、文档或聊天中。

## 查询与缓存

服务端使用 HTTPS POST 请求：

```text
https://api.64clouds.com/v1/getServiceInfo
```

`veid` 和 `api_key` 只出现在表单请求体中。成功结果在 Control Center 进程内缓存五分钟；并发查询共享同一个上游请求。浏览器只收到经过白名单筛选的主机名、位置、流量、重置时间和告警字段。

## 当前计算口径

初始实现采用交接文档中的候选 A：

```text
used      = data_counter * monthly_data_multiplier
total     = plan_monthly_data
remaining = max(total - used, 0)
```

第一次填入真实凭据后，需要同时打开 KiwiVM 面板，对照面板的已用流量、总流量和使用率。如果 `monthly_data_multiplier` 大于 `1` 且结果不一致，再校准总量是否也需要乘以倍率。在完成核对前，Control Center 会把非 `1` 倍率标记为待校准。
