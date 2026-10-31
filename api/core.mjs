// Shared logic for the web demo API (Azure Static Web Apps managed functions) and the
// local server (npm run web). Only the four fixed demo scenarios can be run: no free
// text goes to the model, so the endpoint can't be used as a free model proxy.
import { scenarios } from "./lib/src/scenarios.js";
import { decisionProvider, foundryConfig } from "./lib/src/providers/index.js";
import { createLimiter, clientIp } from "./throttle.mjs";

export const SCENARIOS = ["triage", "gate", "rank", "route"];
const MAX_BODY = 512; // bytes

export async function runScenario(provider, key) {
  const s = scenarios[key];
  const items = s.items();
  const qs = s.questions(items[0]);
  const questions = Object.fromEntries(Object.entries(qs).map(([id, q]) => [id, { type: q.type, instructions: q.instructions, ...(q.options ? { options: q.options } : {}), ...(q.levels ? { levels: q.levels } : {}) }]));
  const out = { scenario: key, title: s.title, questions, items: [] };
  const t0 = performance.now();
  if (key === "rank") {
    const res = await Promise.all(items.map(async (it) => {
      const a = performance.now();
      const r = await provider.decide(it.text, s.questions(it));
      return { r, ms: performance.now() - a };
    }));
    items.forEach((it, i) => out.items.push({ id: it.id, text: it.text, answers: res[i].r.answers, composite: s.composite(res[i].r.answers), ms: Math.round(res[i].ms), model: res[i].r.model }));
    out.items.sort((x, y) => y.composite - x.composite);
    out.decision = `merge candidate ${out.items[0].id}`;
    out.parallel = true;
  } else {
    for (const it of items) {
      const a = performance.now();
      const r = await provider.decide(it.text, s.questions(it));
      const ms = performance.now() - a;
      const action = s.policy(r.answers);
      out.items.push({ id: it.id, text: it.text, answers: r.answers, action, expected: it.expect, correct: !!s.check(it, r.answers, action), ms: Math.round(ms), model: r.model });
    }
  }
  out.wallMs = Math.round(performance.now() - t0);
  const ms = out.items.map((x) => x.ms).sort((a, b) => a - b);
  out.medianMs = ms.length % 2 ? ms[(ms.length - 1) / 2] : Math.round((ms[ms.length / 2 - 1] + ms[ms.length / 2]) / 2);
  out.model = out.items.find((x) => x.model)?.model;
  return out;
}

const json = (status, body, headers = {}) => ({ status, headers: { "content-type": "application/json", "cache-control": "no-store", ...headers }, body: JSON.stringify(body) });

export function makeApi(env = process.env, { limiter, providerFactory } = {}) {
  limiter ||= createLimiter({
    perIpPerMinute: Number(env.DEMO_RATE_PER_MIN || 10),
    dailyCallCap: Number(env.DEMO_DAILY_CALL_CAP || 500),
  });
  providerFactory ||= () => decisionProvider(env, { provider: "azure", strict: true });

  return {
    health() {
      const c = foundryConfig(env);
      const st = limiter.stats();
      return json(200, { live: c.ready, deployment: c.ready ? c.deployment : null, limits: { perIpPerMinute: st.perIpPerMinute, dailyCallCap: st.dailyCallCap, usedToday: st.calls } });
    },

    async decide({ rawBody, headers }) {
      if (rawBody && Buffer.byteLength(String(rawBody)) > MAX_BODY) return json(413, { error: "Request too large." });
      let body;
      try { body = JSON.parse(rawBody || "{}"); } catch { return json(400, { error: "Send JSON: {\"scenario\": \"triage\"}" }); }
      const key = body?.scenario;
      if (!SCENARIOS.includes(key)) return json(400, { error: `scenario must be one of ${SCENARIOS.join(", ")}` });
      if (!foundryConfig(env).ready) return json(503, { error: "The live model isn't configured on this site yet. Showing mock output.", fallback: true });

      const cost = scenarios[key].items().length;
      const gate = limiter.take(clientIp(headers), cost);
      if (!gate.ok) {
        const msg = gate.reason === "daily"
          ? "The live demo reached today's limit. Showing mock output instead; it resets at midnight UTC."
          : `Easy there: max ${limiter.stats().perIpPerMinute} live runs per minute. Showing mock output; try again in ${gate.retryAfter} s.`;
        return json(429, { error: msg, fallback: true, reason: gate.reason }, { "retry-after": String(gate.retryAfter) });
      }
      try {
        const result = await runScenario(providerFactory(), key);
        return json(200, { mode: "live", deployment: foundryConfig(env).deployment, ...result, limits: { remainingThisMinute: gate.remainingIp, remainingToday: gate.remainingToday } });
      } catch (e) {
        // Status and Azure's error code only; never headers or config.
        const m = String(e.message || e).match(/HTTP (\d+)/);
        return json(502, { error: `The model call failed${m ? ` (HTTP ${m[1]})` : ""}. Showing mock output.`, fallback: true });
      }
    },
  };
}
