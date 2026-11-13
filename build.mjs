import { build } from "esbuild";

const harness = process.argv.includes("--harness");
const smoke = process.argv.includes("--smoke");

const common = {
  bundle: true,
  logLevel: "info",
  target: "es2020",
  legalComments: "none",
};

if (harness) {
  await build({
    ...common,
    entryPoints: ["dev/harness.js"],
    outfile: "dev/harness.bundle.js",
    format: "iife",
    platform: "browser",
  });
} else if (smoke) {
  await build({
    ...common,
    entryPoints: ["dev/smoke.js"],
    outfile: "dev/smoke.bundle.js",
    format: "iife",
    platform: "browser",
    alias: { obsidian: "./dev/stub-obsidian.js" },
  });
} else {
  await build({
    ...common,
    entryPoints: ["src/main.js"],
    outfile: "main.js",
    format: "cjs",
    platform: "node",
    external: ["obsidian", "child_process", "fs", "path"],
    // Obsidian 取插件类的方式在不同版本里是 require() 或 require().default，两种都兜住
    footer: { js: "module.exports = module.exports.default || module.exports;" },
  });
}
