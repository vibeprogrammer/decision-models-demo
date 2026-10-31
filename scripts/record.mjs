#!/usr/bin/env node
// Records one real comparison run of every scenario from a deployed site (or `npm run web`)
// into web/recorded.json. The page shows it before a visitor runs anything, and when the
// live models are throttled or down. Every number in it was measured; nothing is simulated.
//   node scripts/record.mjs https://<your-site>.azurestaticapps.net
// Cost: one run per scenario = 50 model calls in total, counted in the site's daily cap.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const site = (process.argv[2] || "http://localhost:4280").replace(/\/+$/, "");
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const post = async (path, body) => {
  const res = await fetch(`${site}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status} ${j.error || ""}`);
  return j;
};

const out = { recordedAt: new Date().toISOString(), scenarios: {} };
for (const scenario of ["triage", "gate", "rank", "route"]) {
  const run = await post("/api/run", { scenario });
  const lanes = {};
  await Promise.all(run.lanes.map(async (lane) => {
    const t0 = performance.now();
    const items = [];
    for (let item = 0; item < run.items; item++) {
      const r = (await post("/api/decide", { run: run.run, lane, item })).result;
      if (item > 0) delete r.io; // one example request/response per lane is enough
      items.push(r);
    }
    lanes[lane] = { wallMs: Math.round(performance.now() - t0), items };
  }));
  out.scenarios[scenario] = { lanes };
  const s = (l) => lanes[l].items.reduce((t, x) => t + x.ms, 0);
  console.log(`${scenario}: decision ${s("decision")} ms, llm ${s("llm")} ms (sum of model calls)`);
}
writeFileSync(join(root, "web", "recorded.json"), JSON.stringify(out, null, 1) + "\n");
console.log("web/recorded.json written");
