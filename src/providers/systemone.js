// "System One" wire format: POST {base}/v1/systemone with { state, questions }.
// TypeSafe introduced it for Jev; Microsoft Foundry serves Microsoft-Decision-1 on the
// same request shape at {resource}/providers/microsoft/v1/systemone.
// Docs: https://docs.typesafe.ai/introduction/quickstart
//       https://learn.microsoft.com/azure/foundry/foundry-models/how-to/use-foundry-models-microsoft-decision

const WIRE_TYPE = { choice: "choice", score: "score", yesno: "noul" };

export function toSystemOneRequest(model, state, questions) {
  const qs = {};
  for (const [id, q] of Object.entries(questions)) {
    const w = { type: WIRE_TYPE[q.type], instructions: q.instructions };
    if (q.type === "choice") w.criteria = q.options;
    if (q.type === "score") w.criteria = q.levels;
    if (q.type === "yesno" && q.criteria) w.criteria = { true: q.criteria.true, false: q.criteria.false };
    qs[id] = w;
  }
  return { model, state, questions: qs };
}

// Score as the expected level index (0 = first level) computed from the per-level
// probabilities, so policies like "risk < 0.6" mean the same with every vendor.
// Matches TypeSafe's documented example (probabilities 0.33/0.67/0 -> score 0.67).
function expectedLevel(a) {
  const ps = Object.entries(a.probabilities ?? {}).filter(([k]) => /^\d+$/.test(k));
  if (!ps.length) return a.score;
  const total = ps.reduce((t, [, p]) => t + p, 0) || 1;
  return ps.reduce((t, [k, p]) => t + Number(k) * p, 0) / total;
}

export function fromSystemOneResponse(json) {
  const out = {};
  for (const [id, a] of Object.entries(json.answers ?? {})) {
    if (a.type === "choice") out[id] = { type: "choice", choice: a.choice, probabilities: a.probabilities ?? {}, confidence: a.confidence };
    else if (a.type === "score") out[id] = { type: "score", score: expectedLevel(a), rawScore: a.score, probabilities: a.probabilities ?? {}, confidence: a.confidence, legend: a.legend };
    else if (a.type === "noul") out[id] = { type: "yesno", probability: a.noul };
    else out[id] = { type: a.type ?? "unknown", raw: a };
  }
  return { model: json.model, answers: out, usage: json.usage };
}

// Hints for the errors you are most likely to hit on stage. Taken from the
// troubleshooting table in the Microsoft-Decision-1 docs (learn.microsoft.com, 2026-10-09).
const HINTS = {
  400: "the request shape was rejected: check state, questions, type and criteria",
  401: "the key is missing, wrong or expired: check AZURE_DECISION_KEY (Keys and Endpoint in the Azure portal)",
  403: "this identity has no access to the deployment",
  404: "wrong endpoint or path: check AZURE_DECISION_ENDPOINT against the deployment details page",
  422: "the deployment name or a question isn't supported: AZURE_DECISION_DEPLOYMENT must be your DEPLOYMENT name",
  429: "rate limit hit: wait a few seconds, or raise the deployment's quota",
};

export function systemOneProvider({ name, url, headers, model, fetchImpl = globalThis.fetch, timeoutMs = 30000, retries = 2, hints = {} }) {
  return {
    name,
    url,
    model,
    async decide(state, questions) {
      const body = JSON.stringify(toSystemOneRequest(model, state, questions));
      for (let attempt = 0; ; attempt++) {
        const res = await fetchImpl(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json", ...headers },
          body,
          signal: AbortSignal.timeout(timeoutMs),
        });
        const text = await res.text();
        if (res.status === 429 && attempt < retries) {
          const wait = Math.min(8000, 1000 * Number(res.headers?.get?.("retry-after") || 2 ** attempt));
          await new Promise((r) => setTimeout(r, wait));
          continue;
        }
        if (!res.ok) {
          // Never print request headers: they carry the key.
          const hint = hints[res.status] ? `\n  hint: ${hints[res.status]}` : "";
          throw new Error(`${name}: HTTP ${res.status} ${text.slice(0, 300)}${hint}`);
        }
        return { ...fromSystemOneResponse(JSON.parse(text)), retries: attempt };
      }
    },
  };
}

export function typesafe(env = process.env, fetchImpl) {
  if (!env.TYPESAFE_API_KEY) throw new Error("Set TYPESAFE_API_KEY to use DECISION_PROVIDER=typesafe");
  return systemOneProvider({
    name: "TypeSafe Jev",
    url: "https://api.typesafe.ai/v1/systemone",
    headers: { Authorization: `Bearer ${env.TYPESAFE_API_KEY}` },
    model: env.TYPESAFE_MODEL || "jev-latest",
    fetchImpl,
  });
}

// ---- Microsoft-Decision-1 in Microsoft Foundry -------------------------------------
// Env names (the older ones from v1 of this repo still work):
//   AZURE_DECISION_ENDPOINT    (AZURE_ENDPOINT)    resource endpoint, with or without /providers/microsoft/v1/systemone
//   AZURE_DECISION_KEY         (AZURE_API_KEY)     API key, sent as the "api-key" header
//   AZURE_DECISION_TOKEN       (AZURE_ENTRA_TOKEN) or a Microsoft Entra ID access token, sent as "Authorization: Bearer"
//   AZURE_DECISION_DEPLOYMENT  (AZURE_DEPLOYMENT)  deployment name; default Microsoft-Decision-1
export const SYSTEMONE_PATH = "/providers/microsoft/v1/systemone";
export const DEFAULT_DEPLOYMENT = "Microsoft-Decision-1";

const first = (env, ...names) => {
  for (const n of names) if (env[n] && String(env[n]).trim()) return String(env[n]).trim();
  return undefined;
};

export function foundryConfig(env = process.env) {
  const endpoint = first(env, "AZURE_DECISION_ENDPOINT", "AZURE_ENDPOINT");
  const key = first(env, "AZURE_DECISION_KEY", "AZURE_API_KEY");
  const token = first(env, "AZURE_DECISION_TOKEN", "AZURE_ENTRA_TOKEN");
  const deployment = first(env, "AZURE_DECISION_DEPLOYMENT", "AZURE_DEPLOYMENT") || DEFAULT_DEPLOYMENT;
  return { endpoint, key, token, deployment, url: endpoint ? foundryUrl(endpoint) : undefined, ready: !!(endpoint && (key || token)) };
}

// Accepts the resource endpoint ("https://x.services.ai.azure.com") or the full decision
// URL ("https://x.services.ai.azure.com/providers/microsoft/v1/systemone").
export function foundryUrl(endpoint) {
  const base = String(endpoint).trim().replace(/\/+$/, "");
  return /\/v1\/systemone$/i.test(base) ? base : `${base}${SYSTEMONE_PATH}`;
}

export function foundry(env = process.env, fetchImpl) {
  const c = foundryConfig(env);
  if (!c.ready) {
    const missing = [!c.endpoint && "AZURE_DECISION_ENDPOINT", !(c.key || c.token) && "AZURE_DECISION_KEY"].filter(Boolean).join(" and ");
    throw new Error(`Set ${missing} to use Microsoft-Decision-1 (see .env.example)`);
  }
  return systemOneProvider({
    name: "Microsoft-Decision-1 (Foundry)",
    url: c.url,
    headers: c.key ? { "api-key": c.key } : { Authorization: `Bearer ${c.token}` },
    model: c.deployment, // the deployment name, not the model name
    fetchImpl,
    hints: HINTS,
  });
}
