import { cp, mkdir, rm } from "node:fs/promises";

const dist = new URL("../dist/", import.meta.url);
const files = ["index.html", "styles.css", "app.js", "package.json", ".nojekyll"];

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

for (const file of files) {
  await cp(new URL(`../${file}`, import.meta.url), new URL(file, dist));
}

console.log("Built static site into dist/");
