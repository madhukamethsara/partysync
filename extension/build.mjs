import { build } from "esbuild";
import { copyFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

await mkdir(new URL("./dist/", import.meta.url), { recursive: true });
await Promise.all(["content", "worker", "options"].map((entry) => build({
  entryPoints: [fileURLToPath(new URL(`./src/${entry}.ts`, import.meta.url))],
  outfile: fileURLToPath(new URL(`./dist/${entry}.js`, import.meta.url)),
  bundle: true,
  platform: "browser",
  target: "chrome116",
  format: entry === "worker" ? "esm" : "iife",
  minify: true,
  sourcemap: true,
})));
await Promise.all(["manifest.json", "options.html"].map((file) => copyFile(
  new URL(`./${file}`, import.meta.url), new URL(`./dist/${file}`, import.meta.url),
)));
console.log("Extension built in extension/dist. Load this folder in chrome://extensions.");
