// 校验 src/playbooks/*.json：node scripts/validate-playbooks.mjs
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { validatePlaybook } from "../src/playbook-loader.js";

const dir = join(dirname(fileURLToPath(import.meta.url)), "../src/playbooks");
const files = readdirSync(dir).filter(n => n.endsWith(".json"));
let failed = 0;
for (const name of files) {
  let pb;
  try {
    pb = JSON.parse(readFileSync(join(dir, name), "utf8"));
  } catch (error) {
    console.error(`${name}: JSON 解析失败 - ${error.message}`);
    failed++;
    continue;
  }
  const result = validatePlaybook(pb);
  console.log(`${name}: ${result.ok ? "OK" : `FAIL ${result.error}`}`);
  if (!result.ok) failed++;
}
console.log(`共校验 ${files.length} 个 playbook，失败 ${failed}`);
process.exit(failed ? 1 : 0);