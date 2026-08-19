import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createVisualForgeMcp } from "./mcp.js";
import { prepare } from "./app.js";

prepare();
const server = createVisualForgeMcp();
const transport = new StdioServerTransport();
await server.connect(transport);
console.error("VisualForge MCP stdio");
