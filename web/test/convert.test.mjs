/* Parity test: run the browser convert.js logic over the real export.xml in
 * Node and diff the generated CSVs against the Python CLI's golden output in
 * ../../garmin_import/. Exercises the exact aggregate/split/format code the site
 * uses (only the input source differs: Node readline instead of a byte stream).
 *
 *   node web/test/convert.test.mjs
 */
import { createReadStream, existsSync, readFileSync, readdirSync } from "node:fs";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { aggregate, buildYearlyCsvs, summarize } from "../src/convert.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", ".."); // project root
const xmlPath = join(root, "export.xml");
const goldenDir = join(root, "garmin_import");

if (!existsSync(xmlPath) || !existsSync(goldenDir)) {
  console.error("Need export.xml and garmin_import/ in the project root first.");
  console.error("Generate golden files with: python health_to_garmin_fitbit.py");
  process.exit(2);
}

async function* lines(path) {
  const rl = readline.createInterface({
    input: createReadStream(path, "utf8"),
    crlfDelay: Infinity,
  });
  for await (const line of rl) yield line;
}

const t0 = Date.now();
console.log("Streaming export.xml through convert.js …");
const result = await aggregate(lines(xmlPath));
const { files } = buildYearlyCsvs(result, { includeExisting: false });
const summary = summarize(result);
console.log(
  `Parsed in ${((Date.now() - t0) / 1000).toFixed(1)}s — ` +
    `${summary.totalSteps.toLocaleString()} steps, ${summary.dayCount} days ` +
    `(${summary.firstDay} → ${summary.lastDay})\n`
);

let fail = 0;

// 1) File set matches
const got = [...files.keys()].sort();
const golden = readdirSync(goldenDir).filter((f) => f.endsWith(".csv")).sort();
if (got.join() !== golden.join()) {
  fail++;
  console.log("✗ file set differs");
  console.log("  JS    :", got.join(", "));
  console.log("  golden:", golden.join(", "));
} else {
  console.log(`✓ file set matches (${got.length} files)`);
}

// 2) Byte-for-byte content per file
for (const name of got) {
  if (!golden.includes(name)) continue;
  const a = files.get(name);
  const b = readFileSync(join(goldenDir, name), "utf8");
  if (a === b) {
    console.log(`✓ ${name} identical`);
  } else {
    fail++;
    const al = a.split("\n"), bl = b.split("\n");
    let i = 0;
    while (i < al.length && i < bl.length && al[i] === bl[i]) i++;
    console.log(`✗ ${name} differs at line ${i + 1}`);
    console.log(`   JS    : ${JSON.stringify(al[i])}`);
    console.log(`   golden: ${JSON.stringify(bl[i])}`);
  }
}

// 3) Spot-check the known value
const csv2015 = files.get("fitbit_activities_2015.csv") || "";
const oct10 = csv2015.split("\n").find((l) => l.startsWith('"2015-10-10"'));
const steps = oct10 && oct10.split(",")[2].replace(/"/g, "");
if (steps === "30146") {
  console.log("✓ spot-check: 2015-10-10 = 30146 steps");
} else {
  fail++;
  console.log(`✗ spot-check: 2015-10-10 expected 30146, got ${steps}`);
}

console.log(fail === 0 ? "\nPASS — byte-for-byte parity with the Python CLI." : `\nFAIL — ${fail} issue(s).`);
process.exit(fail === 0 ? 0 : 1);
