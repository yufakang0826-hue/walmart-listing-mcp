#!/usr/bin/env node
import "dotenv/config";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerWalmartOrdersTools } from "./service/walmart-tools.js";

function initServer(): McpServer {
  return new McpServer({
    name: "walmart-mcp-orders-server",
    version: "0.1.0",
  });
}

async function main(): Promise<void> {
  console.error("Starting Walmart MCP Orders Server...");

  const server = initServer();
  await registerWalmartOrdersTools(server);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Walmart MCP Orders Server running on stdio transport");
}

main().catch((error) => {
  console.error("Fatal error:", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
