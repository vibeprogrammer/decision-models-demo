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

export function fromSystemOneResponse(json) {
  const out = {};
  for (const [id, a] of Object.entries(json.answers ?? {})) {
    if (a.type === "choice") out[id] = { type: "choice", choice: a.choice, probabilities: a.probabilities ?? {}, confidence: a.confidence };
    else if (a.type === "score") out[id] = { type: "score", score: a.score, probabilities: a.probabilities ?? {}, confidence: a.confidence, legend: a.legend };
    else if (a.type === "noul") out[id] = { type: "yesno", probability: a.noul };
    else out[id] = { type: a.type ?? "unknown", raw: a };
  }
  return { model: json.model, answers: out, usage: json.usage };
}

export function systemOneProvider({ name, url, headers, model, fetchImpl = globalThis.fetch }) {
  return {
    name,
    async decide(state, questions) {
      const res = await fetchImpl(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json", ...headers },
        body: JSON.stringify(toSystemOneRequest(model, state, questions)),
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`${name}: HTTP ${res.status} ${text.slice(0, 300)}`);
      return fromSystemOneResponse(JSON.parse(text));
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

export function foundry(env = process.env, fetchImpl) {
  if (!env.AZURE_ENDPOINT || !env.AZURE_API_KEY || !env.AZURE_DEPLOYMENT)
    throw new Error("Set AZURE_ENDPOINT, AZURE_API_KEY and AZURE_DEPLOYMENT to use DECISION_PROVIDER=foundry");
  return systemOneProvider({
    name: "Microsoft-Decision-1 (Foundry)",
    url: `${env.AZURE_ENDPOINT.replace(/\/+$/, "")}/providers/microsoft/v1/systemone`,
    headers: { "api-key": env.AZURE_API_KEY },
    model: env.AZURE_DEPLOYMENT, // deployment name, not the model name
    fetchImpl,
  });
}
