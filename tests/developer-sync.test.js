const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { resolveTarget, getSyncFiles, syncExtension, parseTargetArg } = require("../scripts/dev-sync.js");

test("developer mode defaults to the repository itself when no target is configured", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "watchboard-direct-dev-"));
  assert.equal(resolveTarget(root, "", {}), path.resolve(root));
});

test("developer sync excludes key material from discovery and rejects explicit key files", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "watchboard-dev-keys-"));
  const source = path.join(temp, "source");
  const target = path.join(temp, "target");
  fs.mkdirSync(source); fs.mkdirSync(target);
  const manifest = JSON.stringify({ name: "稍后再看工作台" });
  fs.writeFileSync(path.join(source, "manifest.json"), manifest);
  fs.writeFileSync(path.join(target, "manifest.json"), manifest);
  fs.writeFileSync(path.join(source, "private.pem"), "secret");
  fs.writeFileSync(path.join(source, "public.der"), "public");

  assert.deepEqual(getSyncFiles(source), ["manifest.json"]);
  assert.throws(() => syncExtension(source, target, ["manifest.json", "private.pem"]), /key material/i);
  assert.equal(fs.existsSync(path.join(target, "private.pem")), false);
});

test("developer sync copies only the requested extension files", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "watchboard-dev-sync-"));
  const source = path.join(temp, "source");
  const target = path.join(temp, "target");
  fs.mkdirSync(source); fs.mkdirSync(target);
  fs.writeFileSync(path.join(source, "manifest.json"), JSON.stringify({ name: "稍后再看工作台", version: "1" }));
  fs.writeFileSync(path.join(target, "manifest.json"), JSON.stringify({ name: "稍后再看工作台", version: "0" }));
  fs.writeFileSync(path.join(source, "newtab.js"), "const updated = true;\n");

  const result = syncExtension(source, target, ["manifest.json", "newtab.js"]);
  assert.equal(result.copied, 2);
  assert.equal(fs.readFileSync(path.join(target, "newtab.js"), "utf8"), "const updated = true;\n");
  assert.equal(parseTargetArg(["--watch", "--target", target]), target);
});

test("developer sync removes only files recorded by a previous sync", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "watchboard-dev-sync-"));
  const source = path.join(temp, "source"); const target = path.join(temp, "target");
  fs.mkdirSync(source); fs.mkdirSync(target);
  const manifest = JSON.stringify({ name: "稍后再看工作台" });
  fs.writeFileSync(path.join(source, "manifest.json"), manifest); fs.writeFileSync(path.join(target, "manifest.json"), manifest);
  fs.writeFileSync(path.join(source, "old.js"), "old"); fs.writeFileSync(path.join(target, "keep.txt"), "keep");
  syncExtension(source, target, ["manifest.json", "old.js"]);
  fs.rmSync(path.join(source, "old.js"));
  const result = syncExtension(source, target, ["manifest.json"]);
  assert.equal(result.removed, 1);
  assert.equal(fs.existsSync(path.join(target, "old.js")), false);
  assert.equal(fs.readFileSync(path.join(target, "keep.txt"), "utf8"), "keep");
});

test("developer sync refuses to overwrite an unrelated extension", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "watchboard-dev-sync-"));
  const source = path.join(temp, "source");
  const target = path.join(temp, "target");
  fs.mkdirSync(source); fs.mkdirSync(target);
  fs.writeFileSync(path.join(source, "manifest.json"), JSON.stringify({ name: "稍后再看工作台" }));
  fs.writeFileSync(path.join(target, "manifest.json"), JSON.stringify({ name: "别的扩展" }));
  assert.throws(() => syncExtension(source, target, ["manifest.json"]), /不是 Watchboard/);
});

test("developer sync refuses a missing target instead of creating a typo path", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "watchboard-dev-sync-"));
  const source = path.join(temp, "source"); fs.mkdirSync(source);
  fs.writeFileSync(path.join(source, "manifest.json"), JSON.stringify({ name: "稍后再看工作台" }));
  assert.throws(() => syncExtension(source, path.join(temp, "typo"), ["manifest.json"]), /目标目录不存在/);
});
