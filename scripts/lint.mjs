import { readFile } from "node:fs/promises";

const files = ["index.html", "styles.css", "app.js"];
const forbidden = ["TODO", "console.log("];
let hasError = false;

for (const file of files) {
  const text = await readFile(new URL(`../${file}`, import.meta.url), "utf8");
  for (const token of forbidden) {
    if (text.includes(token)) {
      console.error(`${file}: forbidden token ${token}`);
      hasError = true;
    }
  }
}

if (hasError) process.exit(1);
console.log("Static lint passed");
