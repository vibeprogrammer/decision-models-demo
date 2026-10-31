// The "regular model" side of the comparison: a general-purpose LLM asked the same
// questions through chat completions, answering in JSON that we then parse.
// No simulation: this always calls a real model, or it is not configured.
//
// Azure (default): GPT-6 Luna on the same Foundry resource as the decision model.
//   AZURE_LLM_DEPLOYMENT   deployment name                     default dep-gpt-6-luna
//   AZURE_LLM_ENDPOINT     .../openai/v1 base URL               default: derived from AZURE_DECISION_ENDPOINT
//   AZURE_LLM_KEY          API key                              default: AZURE_DECISION_KEY (same resource)
//   LLM_REASONING_EFFORT   none | minimal | low | medium ...    default none (fastest, cheapest)
//   LLM_MAX_OUTPUT_TOKENS  hard cap on output tokens per call   default 300
// Any other OpenAI-compatible endpoint (OpenAI, OpenRouter, Ollama ...):
//   LLM_BASE_URL, LLM_API_KEY, LLM_MODEL, LLM_AUTH=api-key|bearer (these win over AZURE_LLM_*)

import { foundryConfig } from "./systemone.js";

export const DEFAULT_LLM_DEPLOYMENT = "dep-gpt-6-luna";

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
  const shape = [];
  for (const [id, q] of Object.entries(questions)) {
    if (q.type === "choice") {
      lines.push(`${id} (choice): ${q.instructions} Options: ${Object.entries(q.options).map(([k, d]) => `${k} = ${d}`).join("; ")}`);
      shape.push(`"${id}": "${Object.keys(q.options).join("|")}"`);
    } else if (q.type === "score") {
      lines.push(`${id} (score): ${q.instructions} Levels: ${q.levels.map((d, i) => `${i} = ${d}`).join("; ")}`);
      shape.push(`"${id}": <integer 0-${q.levels.length - 1}>`);
    } else {
      lines.push(`${id} (yesno): ${q.instructions}${q.criteria ? ` true = ${q.criteria.true}; false = ${q.criteria.false}` : ""}`);
      shape.push(`"${id}": true|false`);
    }
  }
  lines.push("", `ANSWER FORMAT (plain values, no nested objects): {${shape.join(", ")}}`);
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

const first = (env, ...names) => {
  for (const n of names) if (env[n] && String(env[n]).trim()) return String(env[n]).trim();
  return undefined;
};

// Where the LLM lives. Returns { ready, url, headers, model, kind } without ever logging the key.
export function llmConfig(env = process.env) {
  const maxTokens = Math.max(16, Math.min(2000, Number(env.LLM_MAX_OUTPUT_TOKENS || 300)));
  const effort = first(env, "LLM_REASONING_EFFORT") ?? "none";
  if (first(env, "LLM_BASE_URL")) {
    const key = first(env, "LLM_API_KEY");
    const apiKey = (env.LLM_AUTH || "").toLowerCase() === "api-key";
    return {
      kind: "openai-compatible",
      ready: !!first(env, "LLM_MODEL"),
      url: `${first(env, "LLM_BASE_URL").replace(/\/+$/, "")}/chat/completions`,
      headers: key ? (apiKey ? { "api-key": key } : { Authorization: `Bearer ${key}` }) : {},
      model: first(env, "LLM_MODEL"),
      maxTokens, effort,
    };
  }
  const d = foundryConfig(env);
  const key = first(env, "AZURE_LLM_KEY") || d.key;
  const token = d.token;
  let base = first(env, "AZURE_LLM_ENDPOINT");
  if (!base && d.url) base = `${new URL(d.url).origin}/openai/v1`;
  const url = base ? `${base.replace(/\/+$/, "").replace(/\/chat\/completions$/, "")}/chat/completions` : undefined;
  return {
    kind: "azure",
    ready: !!(url && (key || token)),
    url,
    headers: key ? { "api-key": key } : token ? { Authorization: `Bearer ${token}` } : {},
    model: first(env, "AZURE_LLM_DEPLOYMENT") || DEFAULT_LLM_DEPLOYMENT,
    maxTokens, effort,
  };
}

// Parameters some models refuse. If the API names one of these as unsupported we drop it
// (or step the reasoning effort up) and retry once per change; the provider remembers it.
const EFFORT_LADDER = ["none", "minimal", "low"];

export function llmBaseline(env = process.env, fetchImpl = globalThis.fetch, { timeoutMs = 30000, retries = 2 } = {}) {
  const c = llmConfig(env);
  if (!c.ready) {
    throw new Error(c.kind === "azure"
      ? "Set AZURE_DECISION_ENDPOINT and AZURE_DECISION_KEY (the LLM uses the same Foundry resource; deployment AZURE_LLM_DEPLOYMENT, default dep-gpt-6-luna) to compare against a real LLM"
      : "Set LLM_MODEL (and LLM_API_KEY) to use LLM_BASE_URL");
  }
  const params = { temperature: 0, reasoning_effort: c.effort, response_format: { type: "json_object" } };
  if (c.effort === "off" || c.effort === "default") delete params.reasoning_effort;
  return {
    name: c.kind === "azure" ? "GPT-6 Luna (Foundry)" : `LLM (${c.model})`,
    url: c.url,
    model: c.model,
    maxOutputTokens: c.maxTokens,
    async decide(state, questions) {
      const messages = [{ role: "user", content: buildPrompt(state, questions) }];
      for (let attempt = 0, adjust = 0; ; ) {
        const request = { model: c.model, messages, max_completion_tokens: c.maxTokens, ...params };
        const res = await fetchImpl(c.url, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json", ...c.headers },
          body: JSON.stringify(request),
          signal: AbortSignal.timeout(timeoutMs),
        });
        const text = await res.text();
        if (res.status === 429 && attempt < retries) {
          attempt++;
          const wait = Math.min(8000, 1000 * Number(res.headers?.get?.("retry-after") || 2 ** attempt));
          await new Promise((r) => setTimeout(r, wait));
          continue;
        }
        if (res.status === 400 && adjust < 4) {
          const m = text.match(/(?:Unsupported (?:parameter|value)|not supported)[^'"`]*['"`]([a-z_]+)['"`]/i) || text.match(/"param"\s*:\s*"([a-z_]+)"/i);
          const p = m?.[1];
          if (p === "reasoning_effort" && params.reasoning_effort !== undefined) {
            const i = EFFORT_LADDER.indexOf(params.reasoning_effort);
            if (i >= 0 && i < EFFORT_LADDER.length - 1) params.reasoning_effort = EFFORT_LADDER[i + 1];
            else delete params.reasoning_effort;
            adjust++; continue;
          }
          if (p && p in params) { delete params[p]; adjust++; continue; }
        }
        if (!res.ok) throw new Error(`LLM: HTTP ${res.status} ${text.slice(0, 300)}`);
        const json = JSON.parse(text);
        const content = json.choices?.[0]?.message?.content ?? "";
        const parsed = parseLLMAnswer(content, questions);
        return {
          model: json.model, ...parsed, rawText: content, retries: attempt,
          finishReason: json.choices?.[0]?.finish_reason,
          usage: { input: json.usage?.prompt_tokens ?? null, output: json.usage?.completion_tokens ?? null, reasoning: json.usage?.completion_tokens_details?.reasoning_tokens ?? null },
          io: { request, response: json },
        };
      }
    },
  };
}
