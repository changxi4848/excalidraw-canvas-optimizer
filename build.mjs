import { build } from "esbuild";

const harness = process.argv.includes("--harness");
const smoke = process.argv.includes("--smoke");
const withHelper = process.argv.includes("--with-helper"); // 默认不带外部 Python

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
  // --market：市场版，剥离依赖本地 Python 的数位板助手（审核不接受拉起外部进程）
  const marketStub = {
    name: "market-stub",
    setup(b) {
      b.onResolve({ filter: /focus\.js$/ }, (args) => (args.path.includes("focus") ? { path: "focus-stub", namespace: "stub" } : null));
      b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({
        contents: "export class FocusHelper { constructor(){} async start(){} async stop(){} helperProc = null; }",
        loader: "js",
      }));
    },
  };
  await build({
    ...common,
    entryPoints: ["src/main.js"],
    outfile: "main.js",
    plugins: withHelper ? [] : [marketStub],
    format: "cjs",
    platform: "node",
    external: ["obsidian", "child_process", "fs", "path"],
    // Obsidian 取插件类的方式在不同版本里是 require() 或 require().default，两种都兜住
    footer: { js: "module.exports = module.exports.default || module.exports;" },
  });
}
