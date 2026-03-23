#!/usr/bin/env node
import "dotenv/config";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { authService } from "./service/auth-service.js";

function initServer(): McpServer {
  return new McpServer({
    name: "walmart-mcp-server",
    version: "0.1.0",
  });
}

function checkEnvironmentVariables(): void {
  const errors = authService.getStartupErrors();
  if (errors.length > 0) {
    console.error(errors.join("\n"));
    process.exit(1);
  }
}

async function main(): Promise<void> {
  console.error("Starting Walmart MCP Server...");
  checkEnvironmentVariables();

  const server = initServer();
  const { registerWalmartTools } = await import("./service/walmart-tools.js");
  await registerWalmartTools(server);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Walmart MCP Server running on stdio transport");
}

main().catch((error) => {
  console.error("Fatal error:", error instanceof Error ? error.message : String(error));
  console.error("Stack trace:", error instanceof Error ? error.stack : "No stack trace available");
  process.exit(1);
});
