// Shared logic for the web demo API (Azure Static Web Apps managed functions) and the
// local server (npm run web). Only the four fixed demo scenarios can be run: no free
// text goes to either model, so the endpoint can't be used as a free model proxy.
//
// A comparison run is two steps, so the page can show both models racing item by item:
//   POST /api/run    {"scenario":"triage"}                       -> {run, items, limits}
//        Takes one run from the per-IP limit and reserves every model call the run needs
//        (items x 2 models) from the daily cap, before any model is called.
//   POST /api/decide {"run":"...","lane":"decision"|"llm","item":0} -> one measured answer
//        Each (lane, item) of a run can be called once; the run expires after 3 minutes.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { scenarios } from "./lib/src/scenarios.js";
import { decisionProvider, foundryConfig } from "./lib/src/providers/index.js";
import { llmBaseline, llmConfig } from "./lib/src/providers/llm-baseline.js";
import { createLimiter, clientIp } from "./throttle.mjs";

export const SCENARIOS = ["triage", "gate", "rank", "route"];
export const LANES = ["decision", "llm"];
const MAX_BODY = 512; // bytes
const RUN_TTL_MS = 3 * 60_000;

const summarizeQuestion = (q) => ({ type: q.type, instructions: q.instructions, ...(q.options ? { options: q.options } : {}), ...(q.levels ? { levels: q.levels } : {}) });

// What the page shows before anything runs: items, questions and the expected labels.
export function catalog() {
  const out = {};
  for (const key of SCENARIOS) {
    const s = scenarios[key];
    const items = s.items();
    out[key] = {
      title: s.title,
      questions: Object.fromEntries(Object.entries(s.questions(items[0])).map(([id, q]) => [id, summarizeQuestion(q)])),
      items: items.map((it) => ({ id: it.id, text: it.text, expected: it.expect })),
    };
  }
  return out;
}

// One item, one model, measured on the server (model round trip only).
export async function runItem(provider, key, index) {
  const s = scenarios[key];
  const it = s.items()[index];
  const qs = s.questions(it);
  const t0 = performance.now();
  const r = await provider.decide(it.text, qs);
  const ms = Math.round(performance.now() - t0);
  const out = { id: it.id, ms, parseError: !!r.parseError, answers: r.answers, usage: r.usage ?? { input: null, output: null } };
  if (key === "rank") {
    out.composite = r.parseError ? null : s.composite(r.answers);
    out.expected = it.expect;
  } else {
    let action = "unparseable answer", correct = false;
    if (!r.parseError) {
      try { action = s.policy(r.answers); correct = !!s.check(it, r.answers, action); } catch { action = "unparseable answer"; }
    }
    Object.assign(out, { action, expected: it.expect, correct });
  }
  if (r.io) out.io = r.io;
  return out;
}

// Example JSON for the page: the real request and response, with deployment names and
// content-filter noise taken out. Never contains headers, so never the key.
export function cleanIo(io, deployments = []) {
  if (!io) return undefined;
  const response = structuredClone(io.response);
  if (response && typeof response === "object") {
    delete response.prompt_filter_results;
    for (const c of response.choices ?? []) delete c.content_filter_results;
    delete response.system_fingerprint;
    delete response.routing; // serving internals, not part of the API contract
    if (response.usage) delete response.usage.latency_checkpoint;
  }
  let text = JSON.stringify({ request: io.request, response });
  for (const d of deployments.filter(Boolean)) text = text.split(JSON.stringify(d)).join('"<deployment>"');
  return JSON.parse(text);
}

const json = (status, body, headers = {}) => ({ status, headers: { "content-type": "application/json", "cache-control": "no-store", ...headers }, body: JSON.stringify(body) });
const b64u = (b) => Buffer.from(b).toString("base64url");

export function makeApi(env = process.env, { limiter, providers, now = () => Date.now() } = {}) {
  limiter ||= createLimiter({
    perIpPerMinute: Number(env.DEMO_RATE_PER_MIN || 10),
    dailyCallCap: Number(env.DEMO_DAILY_CALL_CAP || 500),
  });
  providers ||= {
    decision: () => decisionProvider(env, { provider: "azure", strict: true }),
    llm: () => llmBaseline(env),
  };
  // Run tokens are signed, so any Functions instance can check them. The signing key is
  // derived from the model key (or DEMO_RUN_SECRET) and never leaves the server.
  const secret = createHmac("sha256", "decision-demo-run").update(env.DEMO_RUN_SECRET || env.AZURE_DECISION_KEY || randomBytes(32)).digest();
  const sign = (payload) => createHmac("sha256", secret).update(payload).digest("base64url");
  const used = new Map(); // nonce -> Set("lane:item")
  const ready = () => foundryConfig(env).ready && llmConfig(env).ready;
  const deployments = () => [foundryConfig(env).deployment, llmConfig(env).model];

  const parse = (rawBody) => {
    if (rawBody && Buffer.byteLength(String(rawBody)) > MAX_BODY) return { err: json(413, { error: "Request too large." }) };
    try { return { body: JSON.parse(rawBody || "{}") }; } catch { return { err: json(400, { error: "Send JSON, for example {\"scenario\": \"triage\"}" }) }; }
  };

  return {
    health() {
      const st = limiter.stats();
      return json(200, {
        live: ready(),
        deployment: foundryConfig(env).ready ? foundryConfig(env).deployment : null,
        llm: llmConfig(env).ready,
        limits: { perIpPerMinute: st.perIpPerMinute, dailyCallCap: st.dailyCallCap, usedToday: st.calls },
      });
    },

    async run({ rawBody, headers }) {
      const { body, err } = parse(rawBody);
      if (err) return err;
      const key = body?.scenario;
      if (!SCENARIOS.includes(key)) return json(400, { error: `scenario must be one of ${SCENARIOS.join(", ")}` });
      if (!ready()) return json(503, { error: "The live models aren't configured on this site yet. Showing the recorded run.", recorded: true });
      const n = scenarios[key].items().length;
      const gate = limiter.take(clientIp(headers), n * LANES.length);
      if (!gate.ok) {
        const msg = gate.reason === "daily"
          ? "The live demo reached today's limit. Showing the recorded run instead; it resets at midnight UTC."
          : `Easy there: max ${limiter.stats().perIpPerMinute} live runs per minute. Try again in ${gate.retryAfter} s.`;
        return json(429, { error: msg, recorded: true, reason: gate.reason }, { "retry-after": String(gate.retryAfter) });
      }
      const payload = b64u(JSON.stringify({ s: key, e: now() + RUN_TTL_MS, n: randomBytes(9).toString("base64url") }));
      return json(200, { run: `${payload}.${sign(payload)}`, scenario: key, items: n, lanes: LANES, limits: { remainingThisMinute: gate.remainingIp, remainingToday: gate.remainingToday } });
    },

    async decide({ rawBody }) {
      const { body, err } = parse(rawBody);
      if (err) return err;
      const { run, lane, item } = body ?? {};
      if (!LANES.includes(lane)) return json(400, { error: `lane must be one of ${LANES.join(", ")}` });
      const [payload, sig] = String(run || "").split(".");
      const good = payload && sig && sig.length === sign(payload).length && timingSafeEqual(Buffer.from(sig), Buffer.from(sign(payload)));
      if (!good) return json(403, { error: "Start a run first (POST /api/run)." });
      let tok;
      try { tok = JSON.parse(Buffer.from(payload, "base64url").toString()); } catch { return json(403, { error: "Start a run first (POST /api/run)." }); }
      if (tok.e < now()) return json(403, { error: "This run expired. Start a new one." });
      const key = tok.s;
      const n = scenarios[key]?.items().length ?? 0;
      if (!Number.isInteger(item) || item < 0 || item >= n) return json(400, { error: `item must be 0..${n - 1}` });
      for (const [k, v] of used) if (v.exp < now()) used.delete(k);
      const slot = used.get(tok.n) || { exp: tok.e, done: new Set() };
      if (slot.done.has(`${lane}:${item}`)) return json(409, { error: "Already answered in this run." });
      slot.done.add(`${lane}:${item}`);
      used.set(tok.n, slot);
      if (!ready()) return json(503, { error: "The live models aren't configured on this site yet.", recorded: true });
      try {
        const r = await runItem(providers[lane](), key, item);
        r.io = cleanIo(r.io, deployments());
        return json(200, { mode: "live", scenario: key, lane, item, result: r });
      } catch (e) {
        // Status and Azure's error code only; never headers or config.
        const m = String(e.message || e).match(/HTTP (\d+)/);
        return json(502, { error: `The model call failed${m ? ` (HTTP ${m[1]})` : ""}.`, lane });
      }
    },
  };
}
