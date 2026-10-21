import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const { default: handler } = await import("../api/account.js");
const { default: orderingHandler } = await import("../api/ordering.js");
const server = createServer((req, res) => {
  if (new URL(req.url, "http://localhost").pathname === "/api/account")
    return handler(req, res);
  if (new URL(req.url, "http://localhost").pathname === "/api/ordering")
    return orderingHandler(req, res);
  res.writeHead(404);
  res.end("Not found");
});
server.listen(5174, "127.0.0.1");
const vite = spawn(
  process.execPath,
  [
    "node_modules/vite/bin/vite.js",
    "--host",
    process.env.EXPRESS_DEV_HOST || "127.0.0.1",
  ],
  { stdio: "inherit" },
);
function stop() {
  server.close();
  vite.kill();
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
vite.on("exit", (code) => {
  process.exitCode = code ?? 0;
  server.close();
});
