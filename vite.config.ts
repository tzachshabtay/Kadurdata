import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

function localContentReview(): Plugin {
  return {
    name: "kadurdata-local-content-review",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/__content-review", async (_request, response) => {
        try {
          const directory = path.resolve(process.cwd(), "src", "content", "review");
          const filenames = (await readdir(directory)).filter((filename) => filename.endsWith(".json"));
          const articles = await Promise.all(filenames.map(async (filename) => (
            JSON.parse(await readFile(path.join(directory, filename), "utf8"))
          )));
          response.writeHead(200, {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
          });
          response.end(JSON.stringify(articles));
        } catch (error) {
          response.writeHead(500, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
          response.end(JSON.stringify({ error: error instanceof Error ? error.message : "Unable to load local review candidates" }));
        }
      });
    },
  };
}

export default defineConfig({
  base: process.env.GITHUB_ACTIONS ? "/Kadurdata/" : "/",
  plugins: [react(), localContentReview()],
});
