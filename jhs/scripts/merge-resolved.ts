// resolve-channel-ids 의 출력 JSON 들을 data/seed-channels.json 에 머지.
//
//   npx tsx scripts/merge-resolved.ts /tmp/a.json /tmp/b.json ...
//
// - id 기준 중복 제거 (기존 우선)
// - 기존 파일의 메타(_comment/_sources/_warning) 객체는 그대로 유지
// - _searchedAs 같은 디버깅 필드는 그대로 보존 (사람이 봤을 때 추적 가능)

import fs from "node:fs";
import path from "node:path";

const SEED_PATH = path.resolve("data/seed-channels.json");
const inputs = process.argv.slice(2);
if (inputs.length === 0) {
  console.error("usage: tsx scripts/merge-resolved.ts <json> [<json> ...]");
  process.exit(1);
}

type Entry = { id: string; [k: string]: unknown };
type AnyRow = Record<string, unknown>;

function load(p: string): AnyRow[] {
  const raw = fs.readFileSync(p, "utf8");
  const arr = JSON.parse(raw);
  if (!Array.isArray(arr)) throw new Error(`${p}: expected array`);
  return arr as AnyRow[];
}

const existing = load(SEED_PATH);
const meta: AnyRow[] = [];
const channels = new Map<string, Entry>();

for (const row of existing) {
  if (typeof row.id === "string" && row.id.startsWith("UC")) {
    channels.set(row.id, row as Entry);
  } else {
    meta.push(row);
  }
}

let added = 0;
let dup = 0;
for (const p of inputs) {
  for (const row of load(p)) {
    const id = row.id;
    if (typeof id !== "string" || !id.startsWith("UC")) continue;
    if (channels.has(id)) {
      dup++;
      continue;
    }
    channels.set(id, row as Entry);
    added++;
  }
}

const out = [...meta, ...channels.values()];
fs.writeFileSync(SEED_PATH, JSON.stringify(out, null, 2) + "\n");

console.log(
  `📦 merged: +${added}  dup=${dup}  total=${channels.size}  → ${SEED_PATH}`,
);
