const fs = require("node:fs");
const path = require("node:path");

const EXTENSION_FILES = [
  "background.js", "bilibili-content.js", "collector-runtime.js", "collectors.js", "core.js", "db.js",
  "manifest.json", "newtab.css", "newtab.html", "newtab.js", "options.css", "options.html", "options.js",
  "popup.css", "popup.html", "popup.js", "service.js", "youtube-content.js", "README.md", "package.json",
  "scripts/dev-sync.js"
];

function resolveTarget(root, explicitTarget) {
  if (explicitTarget) return path.resolve(explicitTarget);
  if (process.env.WATCHBOARD_CHROME_DIR) return path.resolve(process.env.WATCHBOARD_CHROME_DIR);
  const configPath = path.join(root, ".watchboard-dev.json");
  if (!fs.existsSync(configPath)) {
    throw new Error("缺少 Chrome 加载目录：请创建 .watchboard-dev.json，内容为 {\"targetDir\":\"绝对路径\"}");
  }
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  if (!config.targetDir) throw new Error(".watchboard-dev.json 缺少 targetDir");
  return path.resolve(config.targetDir);
}

function syncExtension(sourceRoot, targetRoot, files = EXTENSION_FILES) {
  if (path.resolve(sourceRoot) === path.resolve(targetRoot)) return { copied: 0, targetRoot };
  const targetManifest = path.join(targetRoot, "manifest.json");
  if (fs.existsSync(targetManifest)) {
    const manifest = JSON.parse(fs.readFileSync(targetManifest, "utf8"));
    if (manifest.name !== "稍后再看工作台") throw new Error(`目标目录不是 Watchboard 扩展：${targetRoot}`);
  }
  fs.mkdirSync(targetRoot, { recursive: true });
  for (const file of files) {
    const source = path.join(sourceRoot, file);
    if (!fs.existsSync(source)) throw new Error(`源文件不存在：${file}`);
    const target = path.join(targetRoot, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
  }
  return { copied: files.length, targetRoot };
}

function parseTargetArg(args) {
  const index = args.indexOf("--target");
  return index >= 0 ? args[index + 1] : "";
}

function main() {
  const root = path.resolve(__dirname, "..");
  const target = resolveTarget(root, parseTargetArg(process.argv.slice(2)));
  const run = () => {
    const result = syncExtension(root, target);
    console.log(`[Watchboard] 已同步 ${result.copied} 个扩展文件到 ${result.targetRoot}`);
  };
  run();
  if (!process.argv.includes("--watch")) return;
  let timer;
  for (const file of EXTENSION_FILES) fs.watch(path.join(root, file), () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      try { run(); } catch (error) { console.error(`[Watchboard] 同步失败：${error.message || error}`); }
    }, 120);
  });
  console.log("[Watchboard] 正在监视源码；按 Ctrl+C 停止。界面改动刷新页面，后台/Manifest 改动再点“开发重载”。");
}

if (require.main === module) main();

module.exports = { EXTENSION_FILES, resolveTarget, syncExtension, parseTargetArg };
