const fs = require("node:fs");
const path = require("node:path");

const EXCLUDED_DIRS = new Set([".git", "node_modules"]);
const EXCLUDED_FILES = new Set([".gitignore", ".watchboard-dev.json", ".watchboard-dev-state.json"]);
const STATE_FILE = ".watchboard-dev-state.json";

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

function getSyncFiles(root) {
  const files = [];
  function walk(directory, prefix = "") {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.isDirectory() && EXCLUDED_DIRS.has(entry.name)) continue;
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(path.join(directory, entry.name), relative);
      else if (!EXCLUDED_FILES.has(entry.name) && !entry.name.endsWith(".zip")) files.push(relative);
    }
  }
  walk(root);
  return files;
}

function safeTargetPath(targetRoot, relative) {
  const resolvedRoot = path.resolve(targetRoot);
  const resolved = path.resolve(resolvedRoot, relative);
  if (resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}${path.sep}`)) throw new Error(`非法同步路径：${relative}`);
  return resolved;
}

function syncExtension(sourceRoot, targetRoot, files = getSyncFiles(sourceRoot)) {
  const source = path.resolve(sourceRoot);
  const target = path.resolve(targetRoot);
  if (source === target) return { copied: 0, removed: 0, targetRoot: target };
  const targetManifest = path.join(target, "manifest.json");
  if (!fs.existsSync(targetManifest)) throw new Error(`目标目录不存在或不是已加载的 Watchboard：${target}`);
  const manifest = JSON.parse(fs.readFileSync(targetManifest, "utf8"));
  if (manifest.name !== "稍后再看工作台") throw new Error(`目标目录不是 Watchboard 扩展：${target}`);

  const statePath = path.join(target, STATE_FILE);
  let previous = [];
  if (fs.existsSync(statePath)) {
    try { previous = JSON.parse(fs.readFileSync(statePath, "utf8")).files || []; } catch {}
  }
  const current = new Set(files);
  let removed = 0;
  for (const stale of previous) {
    if (current.has(stale)) continue;
    const stalePath = safeTargetPath(target, stale);
    if (fs.existsSync(stalePath) && fs.statSync(stalePath).isFile()) { fs.rmSync(stalePath); removed += 1; }
  }
  for (const file of files) {
    const sourceFile = path.join(source, file);
    if (!fs.existsSync(sourceFile)) throw new Error(`源文件不存在：${file}`);
    const targetFile = safeTargetPath(target, file);
    fs.mkdirSync(path.dirname(targetFile), { recursive: true });
    fs.copyFileSync(sourceFile, targetFile);
  }
  fs.writeFileSync(statePath, `${JSON.stringify({ files, syncedAt: new Date().toISOString() }, null, 2)}\n`);
  return { copied: files.length, removed, targetRoot: target };
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
    console.log(`[Watchboard] 已同步 ${result.copied} 个文件、清理 ${result.removed} 个旧文件：${result.targetRoot}`);
  };
  run();
  if (!process.argv.includes("--watch")) return;
  let timer;
  fs.watch(root, { recursive: true }, (_event, filename) => {
    const topLevel = String(filename || "").split(/[\\/]/)[0];
    if (!filename || EXCLUDED_DIRS.has(topLevel) || EXCLUDED_FILES.has(path.basename(filename))) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      try { run(); } catch (error) { console.error(`[Watchboard] 同步失败：${error.message || error}`); }
    }, 120);
  });
  console.log("[Watchboard] 正在监视源码；按 Ctrl+C 停止。界面改动刷新页面，后台/Manifest 改动再点“开发重载”。");
}

if (require.main === module) main();

module.exports = { STATE_FILE, resolveTarget, getSyncFiles, syncExtension, parseTargetArg };
