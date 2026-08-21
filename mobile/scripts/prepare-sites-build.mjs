#!/usr/bin/env node
import { copyFileSync, cpSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildSync } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
const index = path.join(dist, "client", "index.html");
const worker = path.join(root, "worker", "index.js");
const hosting = path.join(root, ".openai", "hosting.json");
const migrations = path.join(root, "drizzle");

for (const file of [index, worker, hosting]) {
  if (!existsSync(file)) throw new Error("Missing Sites build input: " + file);
}

mkdirSync(path.join(dist, "server"), { recursive: true });
mkdirSync(path.join(dist, ".openai"), { recursive: true });
buildSync({
  entryPoints: [worker],
  outfile: path.join(dist, "server", "index.js"),
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  minify: false,
  sourcemap: false,
});
copyFileSync(hosting, path.join(dist, ".openai", "hosting.json"));
if (existsSync(migrations)) cpSync(migrations, path.join(dist, ".openai", "drizzle"), { recursive: true });

console.log("Prepared Sites build: worker, hosting config, and D1 migrations");
