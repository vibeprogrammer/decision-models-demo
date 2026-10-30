// The "before" picture: asking a generative LLM the same questions and parsing its text.
// Works with any OpenAI-compatible /chat/completions endpoint (OpenAI, OpenRouter,
// Azure OpenAI, Ollama, LM Studio ...). With no LLM_BASE_URL it falls back to a simulated
// baseline that reuses the offline keyword scorer but, like a real chat completion,
// returns only a label: no probability, no confidence.

import { mockAnswer, sleep } from "./mock.js";

export function buildPrompt(state, questions) {
  const lines = [
    "You are a decision component inside software. Answer every question.",
    "Reply with ONE JSON object only, no prose, no code fences.",
    "Keys are the question ids. Values:",
    "- choice: one of the allowed option keys (string)",
    "- score: the 0-based index of the best level (integer)",
    "- yesno: true or false",
    "",
    "STATE:",
    typeof state === "string" ? state : JSON.stringify(state, null, 2),
    "",
    "QUESTIONS:",
  ];
  for (const [id, q] of Object.entries(questions)) {
    if (q.type === "choice") lines.push(`${id} (choice): ${q.instructions} Options: ${Object.entries(q.options).map(([k, d]) => `${k} = ${d}`).join("; ")}`);
    else if (q.type === "score") lines.push(`${id} (score): ${q.instructions} Levels: ${q.levels.map((d, i) => `${i} = ${d}`).join("; ")}`);
    else lines.push(`${id} (yesno): ${q.instructions}${q.criteria ? ` true = ${q.criteria.true}; false = ${q.criteria.false}` : ""}`);
  }
  return lines.join("\n");
}

export function parseLLMAnswer(text, questions) {
  const cleaned = String(text).replace(/```(?:json)?/g, "").trim();
  const start = cleaned.indexOf("{"), end = cleaned.lastIndexOf("}");
  let obj;
  try { obj = JSON.parse(cleaned.slice(start, end + 1)); } catch { return { parseError: true, answers: {} }; }
  const answers = {};
  let parseError = false;
  for (const [id, q] of Object.entries(questions)) {
    const v = obj[id];
    if (q.type === "choice") { if (!(v in q.options)) parseError = true; answers[id] = { type: "choice", choice: v }; }
    else if (q.type === "score") { const n = Number(v); if (!Number.isInteger(n)) parseError = true; answers[id] = { type: "score", score: n }; }
    else { if (typeof v !== "boolean") parseError = true; answers[id] = { type: "yesno", probability: v === true ? 1 : 0 }; }
  }
  return { parseError, answers };
}

export function llmBaseline(env = process.env, fetchImpl = globalThis.fetch) {
  if (!env.LLM_BASE_URL) {
    const ms = Number(env.MOCK_LLM_MS ?? 1400);
    return {
      name: "simulated LLM baseline",
      mock: true,
      async decide(state, questions) {
        await sleep(ms);
        const answers = {};
        for (const [id, q] of Object.entries(questions)) {
          const a = mockAnswer(state, q);
          if (a.type === "choice") answers[id] = { type: "choice", choice: a.choice };
          else if (a.type === "score") answers[id] = { type: "score", score: Math.round(a.score) };
          else answers[id] = { type: "yesno", probability: a.probability >= 0.5 ? 1 : 0 };
        }
        return { model: "simulated-llm", answers, parseError: false };
      },
    };
  }
  const url = `${env.LLM_BASE_URL.replace(/\/+$/, "")}/chat/completions`;
  return {
    name: `generative LLM (${env.LLM_MODEL})`,
    async decide(state, questions) {
      const res = await fetchImpl(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(env.LLM_API_KEY ? { Authorization: `Bearer ${env.LLM_API_KEY}` } : {}) },
        body: JSON.stringify({ model: env.LLM_MODEL, temperature: 0, messages: [{ role: "user", content: buildPrompt(state, questions) }] }),
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`LLM: HTTP ${res.status} ${text.slice(0, 300)}`);
      const json = JSON.parse(text);
      const content = json.choices?.[0]?.message?.content ?? "";
      const parsed = parseLLMAnswer(content, questions);
      return { model: json.model, ...parsed, usage: json.usage, rawText: content };
    },
  };
}
