# Walmart Listing MCP 接入说明

完整接入文档。**首次使用请先看 [`QUICKSTART.md`](./QUICKSTART.md)**（5 分钟版）；这份文档覆盖所有细节。

## 工具范围

支持：

- seller profile / 凭证管理
- item 查询
- item status / retire
- taxonomy / departments
- feed 提交与查询
- inventory 查询与更新
- price 更新

不包含：

- orders
- returns
- WFS
- Walmart Connect
- 财务报表

## 1. 本地准备

```bash
git clone https://github.com/yufakang0826-hue/walmart-listing-mcp.git
cd walmart-listing-mcp
npm install
npm run build
```

编译产物：`dist/index.js`。

记下本仓库的绝对路径（后面 MCP 配置要用）：

```bash
pwd                  # Mac / Linux
Get-Location         # Windows PowerShell
```

下面所有 `<ABSOLUTE_PATH_TO_REPO>` 都替换成这个值。

示例：

| 平台 | `<ABSOLUTE_PATH_TO_REPO>` 形如 |
|---|---|
| Mac / Linux | `/Users/yourname/walmart-listing-mcp` |
| Windows | `C:/Users/yourname/walmart-listing-mcp` |

## 2. 推荐的环境变量方式

不要依赖 MCP 宿主进程的当前工作目录去加载 `.env`。

更稳妥的做法：

1. 在 MCP 配置里直接写 `env`
2. 把 `WALMART_SELLER_PROFILE_STORE` 设成绝对路径

需要的环境变量：

```text
WALMART_CLIENT_ID
WALMART_CLIENT_SECRET
WALMART_MARKETPLACE
WALMART_SANDBOX
WALMART_SELLER_PROFILE_STORE
```

示例：

```text
WALMART_CLIENT_ID=your_client_id
WALMART_CLIENT_SECRET=your_client_secret
WALMART_MARKETPLACE=US
WALMART_SANDBOX=true
WALMART_SELLER_PROFILE_STORE=<ABSOLUTE_PATH_TO_REPO>/.walmart-seller-profiles.json
```

> **默认 sandbox**：在跑过 [`PRODUCTION_VALIDATION.md`](./PRODUCTION_VALIDATION.md) 之前请保持 `WALMART_SANDBOX=true`。

## 3. 接入 Codex

Codex 的全局配置在 `~/.codex/config.toml`（Windows: `%USERPROFILE%/.codex/config.toml`）。

加入：

```toml
[mcp_servers.walmart_listing]
command = "node"
args = ["<ABSOLUTE_PATH_TO_REPO>/dist/index.js"]
env = { WALMART_CLIENT_ID = "your_client_id", WALMART_CLIENT_SECRET = "your_client_secret", WALMART_MARKETPLACE = "US", WALMART_SANDBOX = "true", WALMART_SELLER_PROFILE_STORE = "<ABSOLUTE_PATH_TO_REPO>/.walmart-seller-profiles.json" }
```

说明：

- `command = "node"` 前提是 `node` 已在 PATH 里。否则写绝对路径（`which node` / `where node` 输出）。
- 不想把凭证写死，可以先填占位空字符串，再通过 `walmart_upsert_seller_profile` 把多店铺存到 profile 文件。
- 切多店铺时，保留固定的 `WALMART_SELLER_PROFILE_STORE`。

## 4. 接入 Claude

### 4.1 Claude Code（CLI）—— 项目内挂载

Claude Code 通过项目根目录的 **`.mcp.json`** 挂载 MCP server（不是 `.claude/settings.json`）。

在项目根创建 `.mcp.json`：

```json
{
  "mcpServers": {
    "walmart-listing": {
      "command": "node",
      "args": [
        "<ABSOLUTE_PATH_TO_REPO>/dist/index.js"
      ],
      "env": {
        "WALMART_CLIENT_ID": "your_client_id",
        "WALMART_CLIENT_SECRET": "your_client_secret",
        "WALMART_MARKETPLACE": "US",
        "WALMART_SANDBOX": "true",
        "WALMART_SELLER_PROFILE_STORE": "<ABSOLUTE_PATH_TO_REPO>/.walmart-seller-profiles.json"
      }
    }
  }
}
```

在该项目里启动 `claude`，启动时会提示是否信任 `.mcp.json` —— 选信任即生效。

### 4.2 Claude Desktop —— 全局挂载

Claude Desktop 的配置文件位置随系统：

| 平台 | 路径 |
|---|---|
| Mac | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Windows | `%APPDATA%\Claude\claude_desktop_config.json` |
| Linux | `~/.config/Claude/claude_desktop_config.json` |

用同样的 `mcpServers` JSON 片段（结构与 4.1 完全一样）写入或合并进去。

写入后**完全退出** Claude Desktop（不是只关窗口）再重启。

### 4.3 多客户端共存

同一个 walmart-listing-mcp 仓库可以同时被 Codex / Claude Code / Claude Desktop 引用 —— 它们各自 spawn 一个独立的 node 子进程，互不影响。共享的 `.walmart-seller-profiles.json` 会让 seller profile 在 3 个客户端之间保持一致。

## 5. 首次验证流程

接入后，建议按这个顺序在对话里让 LLM 调用：

1. `walmart_get_token_status` —— 读 env 是否生效
2. `walmart_verify_credentials` —— OAuth 是否通
3. `walmart_get_departments` —— 真实 API 是否可达
4. `walmart_get_items` —— 是否能看到您的 SKU

或者直接命令行跑：

```bash
node scripts/smoke-test-api.mjs
```

预期 10 / 10 PASS。

如果走多店铺模式，再执行：

1. `walmart_upsert_seller_profile`
2. `walmart_set_active_seller_profile`
3. `walmart_get_token_status`

## 6. 工具总览

### 凭证 / Profile
- `walmart_upsert_seller_profile`
- `walmart_list_seller_profiles`
- `walmart_set_active_seller_profile`
- `walmart_get_token_status`
- `walmart_verify_credentials`

### 商品（卖家侧元数据）
- `walmart_get_items`
- `walmart_get_item` —— 注意：只返发布状态（publishedStatus / wpid 等），**不返商品描述/图片/品牌**
- `walmart_get_item_status`
- `walmart_retire_item`

### Walmart 公共目录（产品内容）—— v0.3.0 新增
- `walmart_search_walmart_catalog` —— 按 query / gtin / upc / asin 查 Walmart 公共目录，返回 title / description (HTML) / images / brand / price / properties。专门补 `walmart_get_item` 拿不到的字段。
- `walmart_search_my_catalog` —— 按 lifecycle / publish / inventory 状态过滤查您的卖家目录

### Feed
- `walmart_submit_feed`
- `walmart_get_feed_status`
- `walmart_get_feeds`

### 分类
- `walmart_get_taxonomy`
- `walmart_get_departments`

### 库存
- `walmart_get_inventory`
- `walmart_get_bulk_inventory`
- `walmart_update_inventory`

### 价格
- `walmart_update_price`

> v0.2.0 起，原 wildcard 工具 `walmart_invoke_listing_api` 已移除。所有操作都通过专用工具调用——这样可以让 LLM 用错路径的概率降到 0，也避免 prompt injection 把它诱导到任意端点。

## 7. 常见问题

### 7.1 `.env` 明明写了，MCP 还是读不到

大多数情况是因为 MCP 宿主启动服务时的工作目录不是仓库根目录。

解决办法：

- 直接把凭证写进 MCP 配置的 `env`（推荐）
- 或者至少把 `WALMART_SELLER_PROFILE_STORE` 设成绝对路径

### 7.2 想配置多店铺

1. 保留一个固定的 `WALMART_SELLER_PROFILE_STORE`（绝对路径）
2. 用 `walmart_upsert_seller_profile` 写入多个店铺
3. 用 `walmart_set_active_seller_profile` 切换当前店铺

### 7.3 想调用 listing 之外的接口

当前版本故意限制为 listing-only。

如果要扩展到 orders / returns / WFS / Walmart Connect，建议单独开新仓库或新版本，不要继续把 listing MCP 做成全能型——会破坏 LLM 的工具选择准确度。

### 7.4 重启 MCP 客户端后还是看不到工具

- Claude Desktop：必须 Cmd+Q（Mac）/ 右键退出（Win）完全退出，不是只关窗口
- Claude Code：重新 `claude` 启动，或在会话内 `/mcp` 查看挂载状态
- Codex：重新打开 codex 窗口

如果还是不行，跑 `node scripts/smoke-test.mjs` 确认服务器本身能工作，然后查客户端日志看 MCP 启动出错信息。
