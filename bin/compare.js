#!/usr/bin/env node
// Same questions, two kinds of model: a decision model vs a generative LLM that has to
// write JSON we then parse. Prints accuracy against the labels in data/, median latency,
// parse failures and whether you get a probability to gate on.
import { loadEnv } from "../src/env.js";
import { decisionProvider, llmBaseline, parseArgs } from "../src/providers/index.js";
import { scenarios } from "../src/scenarios.js";
import { table, median, ms } from "../src/format.js";

loadEnv();
// Usage: node bin/compare.js [--provider azure] [--strict]
const args = parseArgs();
let contenders;
try { contenders = [decisionProvider(process.env, args), llmBaseline()]; } catch (e) { console.error(`ERROR: ${e.message}`); process.exit(2); }
for (const p of contenders) {
  console.log(`${p.mock ? "SIMULATED" : "LIVE     "}  ${p.name}`);
  if (p.fallbackReason) console.log(`NOTE: ${p.fallbackReason}`);
}
console.log("");
const rows = [];
let anyMock = false;

for (const p of contenders) {
  anyMock ||= !!p.mock;
  for (const s of [scenarios.triage, scenarios.gate, scenarios.route]) {
    const times = []; let ok = 0, parseErrors = 0, errors = 0, withProb = 0;
    for (const it of s.items()) {
      const t0 = performance.now();
      try {
        const r = await p.decide(it.text, s.questions(it));
        times.push(performance.now() - t0);
        if (r.parseError) { parseErrors++; continue; }
        const first = Object.values(r.answers)[0];
        if (first && (first.probabilities && Object.keys(first.probabilities).length)) withProb++;
        if (s.check(it, r.answers, s.policy(r.answers))) ok++;
      } catch (e) { errors++; console.error(`${p.name} / ${s.key} / ${it.id}: ${e.message}`); }
    }
    const n = s.items().length;
    rows.push({ model: p.name.slice(0, 44), scenario: s.key, correct: `${ok}/${n}`, "median latency": times.length ? ms(median(times)) : "-", "parse errors": parseErrors, errors, "probabilities?": withProb ? "yes" : "no", latency: p.mock ? "simulated" : "measured" });
  }
}

console.log(table(rows));

// Agents chain decisions: each one waits for the previous. Latency adds up.
const med = (name) => median(rows.filter((r) => r.model === name).map((r) => parseFloat(r["median latency"])).filter((x) => !Number.isNaN(x)));
const [d, l] = contenders.map((p) => med(p.name.slice(0, 44)));
if (d && l) console.log(`\nAn agent step that chains 20 decisions: about ${(20 * d / 1000).toFixed(1)} s with ${contenders[0].name}, ${(20 * l / 1000).toFixed(1)} s with ${contenders[1].name}.`);
const failed = rows.reduce((n, r) => n + r.errors, 0);
const simulated = contenders.filter((p) => p.mock).map((p) => p.name);
if (anyMock && simulated.length < contenders.length) console.log(`\nMixed run: ${simulated.join(", ")} is SIMULATED, the other row is measured live. Set LLM_BASE_URL / LLM_API_KEY / LLM_MODEL to measure the LLM too.`);
if (anyMock) console.log("\nMOCK MODE rows use a keyword stand-in and SIMULATED latency (defaults: 130 ms vs 1400 ms, the medians Artificial Analysis published 2026-10-13 for Jev 1.13 and Claude Haiku 5.5). Configure real providers in .env to measure.");
if (failed && process.env.DEMO_STRICT === "1") process.exit(1);
