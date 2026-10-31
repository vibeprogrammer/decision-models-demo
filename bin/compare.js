#!/usr/bin/env node
// Same questions, two kinds of model, both called for real: a decision model vs a
// general-purpose LLM (GPT-6 Luna by default) that has to write JSON we then parse.
// Prints accuracy against the labels in data/, measured latency, tokens, parse failures
// and whether you get a probability to gate on. No simulated rows: without live models
// configured it says what to set and stops.
import { loadEnv } from "../src/env.js";
import { decisionProvider, parseArgs } from "../src/providers/index.js";
import { llmBaseline } from "../src/providers/llm-baseline.js";
import { scenarios } from "../src/scenarios.js";
import { table, median, ms } from "../src/format.js";

loadEnv();
// Usage: node bin/compare.js [--provider azure] [--strict]
const args = parseArgs();
const strict = !!args.strict || process.env.DEMO_STRICT === "1";
let contenders;
try {
  const d = decisionProvider(process.env, args);
  if (d.mock) throw new Error(`${d.fallbackReason ? d.fallbackReason.replace(/ Falling back to MOCK mode\.$/, "") : "No live decision model configured"}`);
  contenders = [d, llmBaseline()];
} catch (e) {
  console.log(`compare needs both live models: ${e.message}.`);
  console.log("Set AZURE_DECISION_ENDPOINT + AZURE_DECISION_KEY (+ AZURE_LLM_DEPLOYMENT, default dep-gpt-6-luna) and run `npm run compare:azure`. See .env.example.");
  process.exit(strict ? 2 : 0);
}
for (const p of contenders) console.log(`LIVE  ${p.name}`);
console.log("");
const rows = [];

for (const p of contenders) {
  for (const s of [scenarios.triage, scenarios.gate, scenarios.route]) {
    const times = []; let ok = 0, parseErrors = 0, errors = 0, withProb = 0, tokIn = 0, tokOut = 0;
    for (const it of s.items()) {
      const t0 = performance.now();
      try {
        const r = await p.decide(it.text, s.questions(it));
        times.push(performance.now() - t0);
        tokIn += r.usage?.input ?? 0; tokOut += r.usage?.output ?? 0;
        if (r.parseError) { parseErrors++; continue; }
        const first = Object.values(r.answers)[0];
        if (first && (first.probabilities && Object.keys(first.probabilities).length)) withProb++;
        if (s.check(it, r.answers, s.policy(r.answers))) ok++;
      } catch (e) { errors++; console.error(`${p.name} / ${s.key} / ${it.id}: ${e.message}`); }
    }
    const n = s.items().length;
    rows.push({ model: p.name.slice(0, 44), scenario: s.key, correct: `${ok}/${n}`, "median latency": times.length ? ms(median(times)) : "-", "tokens in/out": `${tokIn}/${tokOut}`, "parse errors": parseErrors, errors, "probabilities?": withProb ? "yes" : "no" });
  }
}

console.log(table(rows));
console.log("\nLatency is measured on this machine (network round trip included).");

// Agents chain decisions: each one waits for the previous. Latency adds up.
const med = (name) => median(rows.filter((r) => r.model === name).map((r) => parseFloat(r["median latency"])).filter((x) => !Number.isNaN(x)));
const [d, l] = contenders.map((p) => med(p.name.slice(0, 44)));
if (d && l) console.log(`\nAn agent step that chains 20 decisions: about ${(20 * d / 1000).toFixed(1)} s with ${contenders[0].name}, ${(20 * l / 1000).toFixed(1)} s with ${contenders[1].name}.`);
const failed = rows.reduce((n, r) => n + r.errors, 0);
if (failed && strict) process.exit(1);
