import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

/** Must match package.json build.directories.output (not "Build" - on Windows that equals "build" and collides with electron-builder). */
const OUTPUT_DIR = "Distribution";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const buildDir = path.join(root, OUTPUT_DIR);
const distDir = path.join(buildDir, "Distribute");

if (!fs.existsSync(buildDir)) {
  console.error(
    `prepare-distribute: ${OUTPUT_DIR}/ not found (run electron-builder from the project root first).`,
  );
  process.exit(1);
}

fs.rmSync(distDir, { recursive: true, force: true });
fs.mkdirSync(distDir, { recursive: true });

let copied = 0;
for (const name of fs.readdirSync(buildDir)) {
  if (name.endsWith("-Setup.exe") || name.endsWith("-Portable.exe")) {
    fs.copyFileSync(path.join(buildDir, name), path.join(distDir, name));
    copied++;
  }
}

if (copied === 0) {
  console.error(
    `prepare-distribute: No *-Setup.exe or *-Portable.exe found in ${OUTPUT_DIR}/.`,
  );
  process.exit(1);
}

const readme = `ScriptBoard - what to send
============================

These installers are STANDALONE: your friend only needs 64-bit Windows.
They do not need Node.js, this source project, or any other files.

Send ONE of these (same app, two ways to run it):

  *-Setup.exe
    - Double-click to install like a normal Windows app.

  *-Portable.exe
    - Double-click to run with no installer (good for a quick demo).

SmartScreen may warn on first run until the app is code-signed.
`;

fs.writeFileSync(path.join(distDir, "READ-ME-FIRST.txt"), readme, "utf8");
console.log("Distribute folder ready:", distDir);
