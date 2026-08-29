import { access, readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";

const requiredFiles = [
  "index.html",
  "assets/styles.css",
  "assets/app.js",
  "assets/core.js",
  "assets/serial.js",
  "assets/vendor/qrcode.js",
  "assets/vendor/jsQR.js",
  "assets/vendor/LICENSE-qrcodejs.txt",
  "assets/vendor/LICENSE-jsQR.txt",
  "manifest.webmanifest",
  "sw.js",
  "docs/CURRENT_AND_TARGET.md",
  "docs/SERIAL_PROTOCOL.md",
  "docs/PERSONAL_GLASS.md",
  "docs/THIRD_PARTY_NOTICES.md",
  "firmware/Kai_Zapfanlage_V4_4.ino",
  "firmware/Kai_PersonalGlass_Controller_POC.ino",
  "firmware/PersonalGlassController.h"
];

for (const file of requiredFiles) await access(file);

const html = await readFile("index.html", "utf8");
const requiredIds = [
  "main-content",
  "carousel-ring",
  "start-cycle",
  "stop-cycle",
  "history-body",
  "view-personal",
  "glass-token-input",
  "register-glass",
  "open-qr-scanner",
  "qr-code-preview",
  "achievement-grid",
  "admin-dialog",
  "connect-button"
];

for (const id of requiredIds) {
  if (!html.includes(`id="${id}"`)) throw new Error(`Required element #${id} is missing.`);
}

for (const source of ["./assets/styles.css", "./assets/app.js", "./manifest.webmanifest"]) {
  if (!html.includes(source)) throw new Error(`Reference ${source} is missing from index.html.`);
}

for (const file of ["assets/app.js", "assets/core.js", "assets/serial.js", "sw.js"]) {
  const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`Syntax check failed for ${file}:\n${result.stderr}`);
}

console.log(`Validated ${requiredFiles.length} files and application entry points.`);
