// 校验 src/playbooks/*.json：node scripts/validate-playbooks.mjs
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { validatePlaybook } from "../src/playbook-loader.js";

const dir = join(dirname(fileURLToPath(import.meta.url)), "../src/playbooks");
let failed = 0;
for (const name of readdirSync(dir).filter(n => n.endsWith(".json"))) {
  const pb = JSON.parse(readFileSync(join(dir, name), "utf8"));
  const result = validatePlaybook(pb);
  console.log(`${name}: ${result.ok ? "OK" : `FAIL ${result.error}`}`);
  if (!result.ok) failed++;
}
process.exit(failed ? 1 : 0);
