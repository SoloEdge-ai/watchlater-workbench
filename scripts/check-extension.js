const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
if (manifest.version !== packageJson.version) throw new Error(`Version mismatch: manifest ${manifest.version}, package ${packageJson.version}`);
if (!/^[A-Za-z0-9+/]+={0,2}$/.test(manifest.key || "")) throw new Error("Manifest key is missing or invalid");
function* walkFiles(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === ".git" || entry.name === "node_modules") continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) yield* walkFiles(fullPath);
    else yield fullPath;
  }
}
function rejectKeyMaterial(directory) {
  for (const file of walkFiles(directory)) {
    if (/\.(?:pem|der)$/i.test(file)) throw new Error(`Key material must not be present in the extension tree: ${path.relative(root, file)}`);
  }
}
rejectKeyMaterial(root);
const required = [manifest.background.service_worker, manifest.action.default_popup, manifest.chrome_url_overrides.newtab, manifest.options_page];
for (const entry of manifest.content_scripts) required.push(...entry.js);
for (const file of required) if (!fs.existsSync(path.join(root, file))) throw new Error(`Manifest references missing file: ${file}`);
function checkJavaScript(directory) {
  for (const file of walkFiles(directory)) {
    if (!file.endsWith(".js")) continue;
    const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
    if (result.status !== 0) throw new Error(`${path.relative(root, file)}: ${result.stderr}`);
  }
}
checkJavaScript(root);
console.log(`Extension check passed (${required.length} manifest entries, ${manifest.version}).`);
