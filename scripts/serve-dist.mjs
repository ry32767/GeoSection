import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";

const root = resolve("dist");
const port = Number.parseInt(process.env.PORT ?? "4173", 10);
const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent((request.url ?? "/").split("?")[0]);
    const relative = pathname === "/" ? "/index.html" : pathname;
    const filePath = resolve(join(root, relative));
    if (!filePath.startsWith(root)) {
      response.writeHead(403);
      response.end("forbidden");
      return;
    }
    const body = await readFile(filePath);
    response.writeHead(200, { "Content-Type": types[extname(filePath)] ?? "application/octet-stream" });
    response.end(body);
  } catch {
    response.writeHead(404);
    response.end("not found");
  }
}).listen(port, "127.0.0.1", () => {
  console.log(`http://127.0.0.1:${port}`);
});
