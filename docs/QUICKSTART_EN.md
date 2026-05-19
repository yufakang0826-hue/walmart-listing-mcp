# Quickstart (5 minutes)

Shortest path from zero to calling Walmart tools from Claude Desktop / Codex.

## Prerequisites

- Node.js ≥ 20
- A Walmart Developer Portal account for `client_id` + `client_secret` — sandbox first

## 1. Clone and build (1 min)

```bash
git clone https://github.com/yufakang0826-hue/walmart-listing-mcp.git
cd walmart-listing-mcp
npm install && npm run build
```

## 2. Note two absolute paths (30 sec)

```bash
# Repo path
pwd                # Mac/Linux example: /Users/you/walmart-listing-mcp
# (Windows PowerShell) Get-Location

# Node binary path (skip if `node` is on PATH — then just use "node")
which node         # Mac/Linux: /usr/local/bin/node
where node         # Windows  : C:\Program Files\nodejs\node.exe
```

## 3. Configure your MCP client (2 min)

### Claude Desktop

Paste the JSON below into the right file for your OS:

| OS | Config file path |
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
        "WALMART_CLIENT_ID": "your_client_id",
        "WALMART_CLIENT_SECRET": "your_client_secret",
        "WALMART_MARKETPLACE": "US",
        "WALMART_SANDBOX": "true",
        "WALMART_SELLER_PROFILE_STORE": "/ABS/PATH/TO/walmart-listing-mcp/.walmart-seller-profiles.json"
      }
    }
  }
}
```

Replace `/ABS/PATH/TO/walmart-listing-mcp` with the `pwd` output from step 2.

### Claude Code (CLI)

Put the same JSON in `.mcp.json` at the root of any project where you want the server available.

### Codex

Open `~/.codex/config.toml` and add:

```toml
[mcp_servers.walmart_listing]
command = "node"
args = ["/ABS/PATH/TO/walmart-listing-mcp/dist/index.js"]
env = { WALMART_CLIENT_ID = "your_client_id", WALMART_CLIENT_SECRET = "your_client_secret", WALMART_MARKETPLACE = "US", WALMART_SANDBOX = "true", WALMART_SELLER_PROFILE_STORE = "/ABS/PATH/TO/walmart-listing-mcp/.walmart-seller-profiles.json" }
```

## 4. Restart and verify (1 min)

1. Fully quit and relaunch your MCP client (not just close the window)
2. Ask the assistant to call: `walmart_verify_credentials`
3. You should see `tokenType: "Bearer"` returned — you're wired up

If something fails:
- `command not found` → replace `command` with the absolute path from `which node` / `where node`
- `Cannot find module` → check the `args` path actually points at `dist/index.js`
- `WALMART_CLIENT_ID is required` → verify the `env` block, no stray whitespace in the secret

## 5. Next

- See [`docs/MCP_SETUP_CN.md`](./MCP_SETUP_CN.md) for the full tool catalog (18 tools)
- **Required before going production**: [`docs/PRODUCTION_VALIDATION.md`](./PRODUCTION_VALIDATION.md)
- If something breaks: run `node scripts/smoke-test.mjs` (no credentials needed) to verify the server itself works

## Four-sentence security note

1. Credential files (`.env`, `.walmart-seller-profiles.json`) are already in `.gitignore` — never override that
2. **`WALMART_SANDBOX=true` is the default** in all examples — sandbox writes are mock-like, no side effects
3. Before switching to production: read `docs/PRODUCTION_VALIDATION.md` and run the minimal validation pass
4. MCP clients will prompt for confirmation on any tool with `destructiveHint: true` — don't develop the habit of clicking "always allow"
