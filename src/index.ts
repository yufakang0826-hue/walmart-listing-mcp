#!/usr/bin/env node
import "dotenv/config";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

function initServer(): McpServer {
  return new McpServer({
    name: "walmart-mcp-server",
    version: "0.2.1",
  });
}

async function main(): Promise<void> {
  console.error("Starting Walmart MCP Server...");

  const server = initServer();
  const { registerWalmartTools } = await import("./service/walmart-tools.js");
  await registerWalmartTools(server);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Walmart MCP Server running on stdio transport");
}

main().catch((error) => {
  console.error("Fatal error:", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
