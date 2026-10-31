#!/usr/bin/env node
// Usage: node bin/demo.js [triage|gate|rank|route] [--provider azure] [--strict]
//   no scenario = all four. --provider overrides DECISION_PROVIDER.
//   Without a key for the chosen provider it falls back to mock and says so (--strict: fail instead).
import { loadEnv } from "../src/env.js";
import { decisionProvider, parseArgs } from "../src/providers/index.js";
import { scenarios } from "../src/scenarios.js";
import { describe, ms } from "../src/format.js";
import { timed, banner, summary } from "../src/timing.js";

loadEnv();
const args = parseArgs();
const which = args.rest[0];
let base;
try { base = decisionProvider(process.env, args); } catch (e) { console.error(`ERROR: ${e.message}`); process.exit(2); }
const provider = timed(base);
const list = which ? [scenarios[which]].filter(Boolean) : Object.values(scenarios);
if (!list.length) { console.error(`Unknown scenario "${which}". Use triage | gate | rank | route`); process.exit(1); }

console.log(banner(base));

try {
  for (const s of list) {
    console.log(`\n=== ${s.title} ===`);
    const items = s.items();
    if (s.key === "rank") {
      // Candidates are independent, so ask about all of them at once.
      const t0 = performance.now();
      const results = await Promise.all(items.map((it) => provider.decide(it.text, s.questions(it))));
      const wall = performance.now() - t0;
      const ranked = items.map((it, i) => ({ it, a: results[i].answers, c: s.composite(results[i].answers) })).sort((x, y) => y.c - x.c);
      for (const { it, a, c } of ranked) {
        console.log(`\nCandidate ${it.id}  composite ${c.toFixed(2)}`);
        console.log(describe("quality", a.quality));
        console.log(describe("games_tests", a.games_tests));
      }
      console.log(`\n-> merge candidate ${ranked[0].it.id}   (${items.length} candidates in parallel, ${ms(wall)} wall time)`);
      continue;
    }
    for (const it of items) {
      const t0 = performance.now();
      const r = await provider.decide(it.text, s.questions(it));
      const took = performance.now() - t0;
      console.log(`\n${it.id}  ${it.text}`);
      for (const [id, a] of Object.entries(r.answers)) console.log(describe(id, a));
      console.log(`  -> ${s.policy(r.answers)}   (${ms(took)})`);
    }
  }
} catch (e) {
  console.error(`\nERROR: ${e.message}`);
  console.log(summary(base, provider));
  process.exit(1);
}
console.log(summary(base, provider));
