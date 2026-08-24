# BO Console

macOS 本地运维首页 —— 替换 Chrome 新标签页，打开即看本机与服务器状态。

## 功能

- **Docker 容器**：实时显示运行中/已停止容器，CPU 与内存占用
- **TCP 端口监听**：关注指定端口的监听状态，未监听端口醒目告警
- **远程服务器**：通过哪吒监控 V2 API 展示服务器在线状态、CPU/内存/磁盘和网络流量
- **快捷入口**：常用网站图标导航，支持拖拽排序
- **异常聚合**：端口未监听、服务器离线、资源超阈值统一汇总到 Attention 面板

## 架构

```
Chrome 新标签页 (Manifest V3)
      │ HTTP 只读请求
      ▼
127.0.0.1:17321 本地 Helper (Node.js)
      ├── Docker CLI / Docker socket
      ├── lsof：TCP LISTEN 端口
      └── 哪吒 REST API
```

- Chrome 扩展：纯 HTML/CSS/JS，无框架，无构建
- 本地 Helper：Node.js 22+，绑定 `127.0.0.1`，仅接受指定扩展 Origin + 安装时生成的随机令牌
- 哪吒 PAT 仅存于 `helper/.env`（权限 600），不经过扩展、页面或日志

## 快速开始

### 前置条件

- macOS
- Node.js ≥ 22
- Chrome（Developer Mode）
- Docker / OrbStack（可选，用于容器状态）
- 哪吒监控 V2（可选，用于服务器状态）

### 安装

```bash
# 1. 运行测试
npm test

# 2. 在 Chrome 中加载扩展
#    chrome://extensions → 开启开发者模式 → 加载已解压的扩展程序 → 选择 extension/ 目录
#    复制扩展 ID（32 位字母）

# 3. 安装 Helper（替换 YOUR_EXTENSION_ID）
export EXTENSION_ID="YOUR_EXTENSION_ID"
./scripts/install-helper.sh "$EXTENSION_ID"

# 4. 配置哪吒（可选）
#    编辑 helper/.env，填入 NEZHA_PAT（哪吒 PAT 仅需 nezha:inventory:read 权限）

# 5. 重启 Helper
launchctl kickstart -k gui/$UID/com.bo.console.helper

# 6. 打开新标签页，进入设置页配置关注端口、哪吒地址和快捷入口
```

### 卸载

```bash
# 移除 launch agent
launchctl bootout gui/$UID/com.bo.console.helper
mv ~/Library/LaunchAgents/com.bo.console.helper.plist ~/.Trash/

# 在 chrome://extensions 中移除扩展
# helper/.env 保留凭证，按需手动删除
```

## 技术栈

| 组件 | 技术 |
|------|------|
| 扩展 | Chrome Manifest V3, 原生 HTML/CSS/JS ES Modules |
| Helper | Node.js 22+ 原生模块, `node:http` |
| 安装脚本 | Zsh, macOS `launchd` |
| 测试 | `node:test`, 零外部依赖 |

## 安全设计

- Helper 仅监听 `127.0.0.1`，拒绝非指定 Origin
- 每次请求需携带安装时生成的随机令牌
- 只读接口：无容器启停、无进程终止、无远程执行
- 哪吒 PAT 不出现在扩展代码、页面 DOM、日志或浏览器存储中

## 版本

v0.1.0 — 只读模式，首版不做：历史趋势、账号系统、云同步、移动端适配。

## License

MIT
