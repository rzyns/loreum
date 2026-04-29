import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { api } from "./api.js";
import { registerTools } from "./tools.js";

const server = new McpServer({
  name: "loreum",
  version: "0.1.0",
});

registerTools(server, api);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Loreum MCP server running on stdio");
}

main().catch(console.error);
