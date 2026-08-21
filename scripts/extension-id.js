const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

function extensionIdFromManifestKey(key) {
  const publicKey = Buffer.from(String(key || ""), "base64");
  if (!publicKey.length) throw new Error("Manifest key 为空或无效");
  const digest = crypto.createHash("sha256").update(publicKey).digest().subarray(0, 16);
  return [...digest].map((byte) => `${String.fromCharCode(97 + (byte >> 4))}${String.fromCharCode(97 + (byte & 15))}`).join("");
}

function main() {
  const manifest = JSON.parse(fs.readFileSync(path.resolve(__dirname, "..", "manifest.json"), "utf8"));
  console.log(extensionIdFromManifestKey(manifest.key));
}

if (require.main === module) main();

module.exports = { extensionIdFromManifestKey };
