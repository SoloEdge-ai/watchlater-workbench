const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { syncExtension, parseTargetArg } = require("../scripts/dev-sync.js");

test("developer sync copies only the requested extension files", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "watchboard-dev-sync-"));
  const source = path.join(temp, "source");
  const target = path.join(temp, "target");
  fs.mkdirSync(source);
  fs.writeFileSync(path.join(source, "manifest.json"), JSON.stringify({ name: "稍后再看工作台", version: "1" }));
  fs.writeFileSync(path.join(source, "newtab.js"), "const updated = true;\n");

  const result = syncExtension(source, target, ["manifest.json", "newtab.js"]);
  assert.equal(result.copied, 2);
  assert.equal(fs.readFileSync(path.join(target, "newtab.js"), "utf8"), "const updated = true;\n");
  assert.equal(parseTargetArg(["--watch", "--target", target]), target);
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
