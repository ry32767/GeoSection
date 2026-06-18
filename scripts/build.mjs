import { cp, mkdir, rm } from "node:fs/promises";

const dist = new URL("../dist/", import.meta.url);
const files = ["index.html", "styles.css", "app.js", "package.json", ".nojekyll"];
const data = new URL("../data/", import.meta.url);

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

for (const file of files) {
  await cp(new URL(`../${file}`, import.meta.url), new URL(file, dist));
}
await cp(data, new URL("data/", dist), { recursive: true });

console.log("Built static site into dist/");
