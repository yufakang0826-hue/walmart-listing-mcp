# Walmart Listing MCP 接入说明

这份文档只覆盖 `listing` 相关功能接入。

当前支持的工具范围：

- seller profile / 凭证管理
- item 查询
- item status / retire
- taxonomy / departments
- feed 提交与查询
- inventory 查询与更新
- price 更新
- listing 范围内的通用 API 调用

不包含：

- orders
- returns
- WFS
- Walmart Connect
- 财务报表

## 1. 本地准备

在仓库根目录执行：

```bash
npm install
npm run build
```

编译产物是：

```text
dist/index.js
```

你这台机器当前仓库路径是：

```text
C:/Users/Fakang/Desktop/乐好智能ERP/walmart listing MCP
```

对应入口文件是：

```text
C:/Users/Fakang/Desktop/乐好智能ERP/walmart listing MCP/dist/index.js
```

## 2. 推荐的环境变量方式

不要依赖 MCP 宿主进程的当前工作目录去加载 `.env`。

更稳妥的做法是：

1. 在 MCP 配置里直接写 `env`
2. 把 `WALMART_SELLER_PROFILE_STORE` 设成绝对路径

推荐环境变量：

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
WALMART_SANDBOX=false
WALMART_SELLER_PROFILE_STORE=C:/Users/Fakang/Desktop/乐好智能ERP/walmart listing MCP/.walmart-seller-profiles.json
```

## 3. 接入 Codex

你本机当前的 Codex 配置文件是：

```text
C:/Users/Fakang/.codex/config.toml
```

把下面这段加进去即可：

```toml
[mcp_servers.walmart_listing]
command = "C:/nvm4w/nodejs/node.exe"
args = ["C:/Users/Fakang/Desktop/乐好智能ERP/walmart listing MCP/dist/index.js"]
env = { WALMART_CLIENT_ID = "your_client_id", WALMART_CLIENT_SECRET = "your_client_secret", WALMART_MARKETPLACE = "US", WALMART_SANDBOX = "false", WALMART_SELLER_PROFILE_STORE = "C:/Users/Fakang/Desktop/乐好智能ERP/walmart listing MCP/.walmart-seller-profiles.json" }
```

说明：

- `command` 也可以写成 `node`，前提是 `node` 已在 PATH 中
- 如果你后面要切多店铺，建议保留 `WALMART_SELLER_PROFILE_STORE`
- 如果你不想把凭证写死在 `config.toml`，可以先写空壳配置，再通过 `walmart_upsert_seller_profile` 存到 profile 文件里

## 4. 接入 Claude

### 4.1 Claude Code 项目内配置

你现有项目里已经在用这种格式：

```json
{
  "mcpServers": {
    "walmart-listing": {
      "command": "C:/nvm4w/nodejs/node.exe",
      "args": [
        "C:/Users/Fakang/Desktop/乐好智能ERP/walmart listing MCP/dist/index.js"
      ],
      "env": {
        "WALMART_CLIENT_ID": "your_client_id",
        "WALMART_CLIENT_SECRET": "your_client_secret",
        "WALMART_MARKETPLACE": "US",
        "WALMART_SANDBOX": "false",
        "WALMART_SELLER_PROFILE_STORE": "C:/Users/Fakang/Desktop/乐好智能ERP/walmart listing MCP/.walmart-seller-profiles.json"
      }
    }
  }
}
```

如果你要按项目维度启用，可以放到项目根目录：

```text
.claude/settings.json
```

### 4.2 Claude Desktop 全局配置

如果你用的是 Claude Desktop，也可以把同样的 `mcpServers` 片段写进它的全局配置文件。

核心结构不变：

```json
{
  "mcpServers": {
    "walmart-listing": {
      "command": "C:/nvm4w/nodejs/node.exe",
      "args": [
        "C:/Users/Fakang/Desktop/乐好智能ERP/walmart listing MCP/dist/index.js"
      ],
      "env": {
        "WALMART_CLIENT_ID": "your_client_id",
        "WALMART_CLIENT_SECRET": "your_client_secret",
        "WALMART_MARKETPLACE": "US",
        "WALMART_SANDBOX": "false",
        "WALMART_SELLER_PROFILE_STORE": "C:/Users/Fakang/Desktop/乐好智能ERP/walmart listing MCP/.walmart-seller-profiles.json"
      }
    }
  }
}
```

## 5. 首次验证流程

接入后，建议按这个顺序验证：

1. `walmart_get_token_status`
2. `walmart_verify_credentials`
3. `walmart_get_departments`
4. `walmart_get_items`

如果你想走多店铺模式，再执行：

1. `walmart_upsert_seller_profile`
2. `walmart_set_active_seller_profile`
3. `walmart_get_token_status`

## 6. 常用工具建议

### 商品与状态

- `walmart_get_items`
- `walmart_get_item`
- `walmart_get_item_status`
- `walmart_retire_item`

### feed

- `walmart_submit_feed`
- `walmart_get_feed_status`
- `walmart_get_feeds`

### 分类与属性定位

- `walmart_get_taxonomy`
- `walmart_get_departments`

### 库存与价格

- `walmart_get_inventory`
- `walmart_get_bulk_inventory`
- `walmart_update_inventory`
- `walmart_update_price`

### 兜底调用

- `walmart_invoke_listing_api`

这个工具只允许以下路径前缀：

- `/v3/items`
- `/v3/inventory`
- `/v3/price`
- `/v3/feeds`
- `/v3/utilities/taxonomy`

## 7. 常见问题

### 7.1 `.env` 明明写了，MCP 还是读不到

大多数情况是因为 MCP 宿主启动服务时的工作目录不是仓库根目录。

解决办法：

- 直接把凭证写进 MCP 配置的 `env`
- 或者至少把 `WALMART_SELLER_PROFILE_STORE` 设成绝对路径

### 7.2 想配置多店铺

推荐做法：

1. 保留一个固定的 `WALMART_SELLER_PROFILE_STORE`
2. 用 `walmart_upsert_seller_profile` 写入多个店铺
3. 用 `walmart_set_active_seller_profile` 切换当前店铺

### 7.3 想调用 listing 之外的接口

当前版本故意限制为 listing-only。

如果后面要扩展到：

- orders
- returns
- WFS
- Walmart Connect

建议单独开新版本，不要继续把 listing MCP 做成全能型。
