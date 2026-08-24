const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const root = path.join(__dirname, "..");

test("tracked files do not expose local home paths or private key material", () => {
  const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" }).split("\0").filter(Boolean);
  const sensitiveExtensions = /\.(?:pem|key|p12|pfx|der)$/i;
  const windowsHome = /[A-Za-z]:\\Users\\[^\\\s]+\\/;
  const unixHome = /\/(?:Users|home)\/[^/\s]+\//;
  const privateKeyMarker = new RegExp(["BEGIN ", "(?:RSA |OPENSSH |EC )?", "PRIVATE KEY"].join(""));
  const findings = [];

  for (const relativePath of tracked) {
    if (sensitiveExtensions.test(relativePath)) findings.push(`${relativePath}: sensitive filename`);
    const absolutePath = path.join(root, relativePath);
    const buffer = fs.readFileSync(absolutePath);
    if (buffer.includes(0)) continue;
    const text = buffer.toString("utf8");
    if (windowsHome.test(text) || unixHome.test(text)) findings.push(`${relativePath}: local home path`);
    if (privateKeyMarker.test(text)) findings.push(`${relativePath}: private key marker`);
  }

  assert.deepEqual(findings, []);
});
