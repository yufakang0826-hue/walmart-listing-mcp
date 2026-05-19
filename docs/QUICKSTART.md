# Quickstart (5 分钟)

最短路径：从 0 到能在 Claude Desktop / Codex 里调用 Walmart 工具。

## 前置要求

- Node.js ≥ 20
- 一个 Walmart Developer Portal 账号（拿 `client_id` + `client_secret`）—— 推荐先用 sandbox

## 1. Clone + build (1 分钟)

```bash
git clone https://github.com/yufakang0826-hue/walmart-listing-mcp.git
cd walmart-listing-mcp
npm install && npm run build
```

## 2. 记下两个绝对路径 (30 秒)

```bash
# 仓库路径
pwd                # Mac/Linux 示例输出：/Users/you/walmart-listing-mcp
# (Windows PowerShell) Get-Location

# Node 路径（如果 `node` 已在 PATH 就跳过这步，下面 command 写 "node"）
which node         # Mac/Linux：/usr/local/bin/node
where node         # Windows：C:\Program Files\nodejs\node.exe
```

## 3. 配置 MCP 客户端 (2 分钟)

### Claude Desktop

把下面的 JSON 写进对应配置文件：

| 平台 | 配置文件路径 |
|---|---|
| Mac | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Windows | `%APPDATA%\Claude\claude_desktop_config.json` |
| Linux | `~/.config/Claude/claude_desktop_config.json` |

```json
{
  "mcpServers": {
    "walmart-listing": {
      "command": "node",
      "args": ["/ABS/PATH/TO/walmart-listing-mcp/dist/index.js"],
      "env": {
        "WALMART_CLIENT_ID": "你的_client_id",
        "WALMART_CLIENT_SECRET": "你的_client_secret",
        "WALMART_MARKETPLACE": "US",
        "WALMART_SANDBOX": "true",
        "WALMART_SELLER_PROFILE_STORE": "/ABS/PATH/TO/walmart-listing-mcp/.walmart-seller-profiles.json"
      }
    }
  }
}
```

把 `/ABS/PATH/TO/walmart-listing-mcp` 替换成第 2 步 `pwd` 的输出。

### Claude Code（CLI）

把同样的 JSON 放在项目根的 `.mcp.json` 里 —— Claude Code 读这个文件来按项目挂载 MCP 服务器。

### Codex

打开 `~/.codex/config.toml`，加：

```toml
[mcp_servers.walmart_listing]
command = "node"
args = ["/ABS/PATH/TO/walmart-listing-mcp/dist/index.js"]
env = { WALMART_CLIENT_ID = "你的_client_id", WALMART_CLIENT_SECRET = "你的_client_secret", WALMART_MARKETPLACE = "US", WALMART_SANDBOX = "true", WALMART_SELLER_PROFILE_STORE = "/ABS/PATH/TO/walmart-listing-mcp/.walmart-seller-profiles.json" }
```

## 4. 重启 + 验证 (1 分钟)

1. 完全重启 MCP 客户端（Quit + 重开，不是只关窗口）
2. 在对话里让 LLM 调用：`walmart_verify_credentials`
3. 应该看到返回 `tokenType: "Bearer"` —— 接入成功

如果失败：
- `command not found` → `command` 改成 `which node` / `where node` 的绝对路径
- `Cannot find module` → 检查 `args` 里的路径有没有写错，是否真的指到 `dist/index.js`
- `WALMART_CLIENT_ID is required` → 检查 `env` 是否正确写入，且 secret 没有空格 / 换行

## 5. 接下来

- 看 [`docs/MCP_SETUP_CN.md`](./MCP_SETUP_CN.md) 了解所有 18 个工具
- 上生产之前必看 [`docs/PRODUCTION_VALIDATION.md`](./PRODUCTION_VALIDATION.md)
- 出问题时跑 `node scripts/smoke-test.mjs`（无凭证）确认服务器本身工作正常

## 安全 4 句话

1. 任何凭证文件（`.env`、`.walmart-seller-profiles.json`）都已经被 `.gitignore` 屏蔽 —— 别绕过它
2. **`WALMART_SANDBOX=true` 是默认**，写工具在沙箱是 mock，无副作用
3. 切到 production 之前必须读 `docs/PRODUCTION_VALIDATION.md` 做一次最小验证
4. MCP 客户端（Claude Desktop / Codex）会对 `destructiveHint: true` 的工具弹用户确认 —— 别养成 always-allow 的习惯
