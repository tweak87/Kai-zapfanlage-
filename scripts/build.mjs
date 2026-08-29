import { cp, mkdir, rm } from "node:fs/promises";

const rootFiles = ["index.html", "manifest.webmanifest", "sw.js", ".nojekyll"];
await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });

for (const file of rootFiles) await cp(file, `dist/${file}`);
for (const directory of ["assets", "docs"]) await cp(directory, `dist/${directory}`, { recursive: true });

console.log("Static GitHub Pages artifact built in dist/.");
