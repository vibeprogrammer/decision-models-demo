// OpenAI Decisions API: POST /v1/decisions with { model, input, questions: [...] }.
// Docs: https://developers.openai.com/api/docs/guides/decisions
// Different field names than System One (predicate / choices / levels, answers as an array),
// same idea. This adapter maps it onto the same normalized answers.

export function toOpenAIRequest(model, state, questions) {
  const qs = [];
  for (const [name, q] of Object.entries(questions)) {
    if (q.type === "choice") {
      qs.push({ type: "choice", name, instructions: q.instructions,
        choices: Object.entries(q.options).map(([value, description]) => ({ value, description })) });
    } else if (q.type === "score") {
      qs.push({ type: "score", name, instructions: q.instructions,
        levels: q.levels.map((label) => ({ label, description: label })) });
    } else {
      const extra = q.criteria ? ` True means: ${q.criteria.true}. False means: ${q.criteria.false}.` : "";
      qs.push({ type: "predicate", name, instructions: q.instructions + extra });
    }
  }
  return { model, input: typeof state === "string" ? state : JSON.stringify(state), questions: qs };
}

export function fromOpenAIResponse(json) {
  const out = {};
  for (const a of json.answers ?? []) {
    const probs = {};
    for (const p of a.probabilities ?? []) probs[p.value ?? p.label ?? String(p.index)] = p.probability;
    if (a.type === "choice") out[a.name] = { type: "choice", choice: a.choice, probabilities: probs, confidence: a.confidence };
    else if (a.type === "score") out[a.name] = { type: "score", score: a.score, probabilities: probs, confidence: a.confidence };
    else if (a.type === "predicate") out[a.name] = { type: "yesno", probability: a.probability };
    else out[a.name] = { type: a.type, raw: a }; // e.g. "refusal"
  }
  return { model: json.model, answers: out, usage: json.usage };
}

export function openaiDecisions(env = process.env, fetchImpl = globalThis.fetch) {
  if (!env.OPENAI_API_KEY) throw new Error("Set OPENAI_API_KEY to use DECISION_PROVIDER=openai");
  const model = env.OPENAI_DECISIONS_MODEL || "gpt-6-luna";
  return {
    name: `OpenAI Decisions (${model})`,
    async decide(state, questions) {
      const res = await fetchImpl("https://api.openai.com/v1/decisions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.OPENAI_API_KEY}` },
        body: JSON.stringify(toOpenAIRequest(model, state, questions)),
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`OpenAI Decisions: HTTP ${res.status} ${text.slice(0, 300)}`);
      return fromOpenAIResponse(JSON.parse(text));
    },
  };
}
