const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { extensionIdFromManifestKey } = require("../scripts/extension-id.js");

const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "manifest.json"), "utf8"));

test("manifest public key produces a stable Chrome extension ID", () => {
  assert.match(manifest.key, /^[A-Za-z0-9+/]+={0,2}$/);
  const publicKey = crypto.createPublicKey({ key: Buffer.from(manifest.key, "base64"), format: "der", type: "spki" });
  assert.equal(publicKey.asymmetricKeyType, "rsa");
  const firstRoot = fs.mkdtempSync(path.join(os.tmpdir(), "watchboard-id-a-"));
  const secondRoot = fs.mkdtempSync(path.join(os.tmpdir(), "watchboard-id-b-"));
  fs.writeFileSync(path.join(firstRoot, "manifest.json"), JSON.stringify(manifest));
  fs.writeFileSync(path.join(secondRoot, "manifest.json"), JSON.stringify(manifest));
  const first = extensionIdFromManifestKey(JSON.parse(fs.readFileSync(path.join(firstRoot, "manifest.json"))).key);
  const second = extensionIdFromManifestKey(JSON.parse(fs.readFileSync(path.join(secondRoot, "manifest.json"))).key);
  assert.match(first, /^[a-p]{32}$/);
  assert.equal(second, first);
});
