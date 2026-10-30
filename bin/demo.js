#!/usr/bin/env node
// Usage: node bin/demo.js [triage|gate|rank|route]   (no argument = all four)
import { loadEnv } from "../src/env.js";
import { decisionProvider } from "../src/providers/index.js";
import { scenarios } from "../src/scenarios.js";
import { describe, ms } from "../src/format.js";

loadEnv();
const which = process.argv[2];
const provider = decisionProvider();
const list = which ? [scenarios[which]].filter(Boolean) : Object.values(scenarios);
if (!list.length) { console.error(`Unknown scenario "${which}". Use triage | gate | rank | route`); process.exit(1); }

console.log(`Decision model: ${provider.name}`);
if (provider.mock) console.log("MOCK MODE: keyword stand-in, latency simulated. Set DECISION_PROVIDER (see .env.example) for a real model.");

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
