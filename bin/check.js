#!/usr/bin/env node
// Preflight for the live demo: is Microsoft-Decision-1 reachable with this key?
// Usage: npm run azure:check     Prints the config (never the key), sends ONE small request,
// and prints status, measured latency and the answer. Exit code 0 = ready to demo.
import { loadEnv } from "../src/env.js";
import { foundry, foundryConfig, listFoundryDeployments } from "../src/providers/systemone.js";
import { choice } from "../src/questions.js";

loadEnv();
const c = foundryConfig(process.env);
console.log("Microsoft-Decision-1 preflight");
console.log(`  endpoint    ${c.url ?? "(not set: AZURE_DECISION_ENDPOINT)"}`);
console.log(`  deployment  ${c.deployment}`);
console.log(`  auth        ${c.key ? "api-key header (AZURE_DECISION_KEY is set)" : c.token ? "Bearer token (AZURE_DECISION_TOKEN is set)" : "MISSING: set AZURE_DECISION_KEY"}`);
if (!c.ready) {
  console.log("\nNot configured. See README > 'Live demo with Microsoft-Decision-1'. `npm run demo` still works in mock mode.");
  process.exit(2);
}

const p = foundry(process.env);
const q = { team: choice("Which team should handle this ticket?", {
  billing: "Charges, invoices, and refunds",
  engineering: "Bugs, errors, and outages",
  support: "How-to and account questions",
}) };
const times = [];
try {
  for (let i = 0; i < 3; i++) {
    const t0 = performance.now();
    const r = await p.decide("The API returns 500 on every call since the last deploy.", q);
    times.push(performance.now() - t0);
    if (i === 0) {
      console.log(`\nOK  model reported by the API: ${r.model ?? "(none)"}`);
      console.log(`    team = ${r.answers.team?.choice}  probabilities ${JSON.stringify(r.answers.team?.probabilities)}`);
      if (r.usage) console.log(`    usage ${JSON.stringify(r.usage)}`);
    }
  }
  console.log(`    latency (measured, 3 calls): ${times.map((t) => `${Math.round(t)} ms`).join(", ")}  (first includes connection setup)`);
  console.log("\nReady. Run: npm run demo:azure");
} catch (e) {
  console.error(`\nFAILED: ${e.message}`);
  if (/DeploymentNotFound|HTTP 404|HTTP 422/.test(e.message)) {
    const ds = await listFoundryDeployments(process.env);
    if (ds.length) {
      console.log("\nDeployments on this resource (set AZURE_DECISION_DEPLOYMENT to one of these names):");
      for (const d of ds) console.log(`  ${d.name}   model: ${d.model ?? "?"}${d.status ? `   ${d.status}` : ""}`);
    } else console.log("\nCouldn't list the deployments with this key. Copy the deployment name from the Foundry portal (Models + endpoints).");
  }
  process.exit(1);
}
