#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const serverDirectory = path.join(process.cwd(), "dist", "server");
const worker = `export default {
  async fetch(request, env) {
    const response = await env.ASSETS.fetch(request);
    if (response.status !== 404 || request.method !== "GET") return response;
    const indexUrl = new URL("/index.html", request.url);
    return env.ASSETS.fetch(new Request(indexUrl, request));
  },
};
`;

await mkdir(serverDirectory, { recursive: true });
await writeFile(path.join(serverDirectory, "index.js"), worker, "utf8");
