import { mockDecisionProvider } from "./mock.js";
import { typesafe, foundry } from "./systemone.js";
import { openaiDecisions } from "./openai-decisions.js";
import { llmBaseline } from "./llm-baseline.js";

// Pick the decision model from DECISION_PROVIDER. Your app code never changes.
export function decisionProvider(env = process.env) {
  const p = (env.DECISION_PROVIDER || "mock").toLowerCase();
  if (p === "mock") return mockDecisionProvider(env);
  if (p === "typesafe" || p === "jev") return typesafe(env);
  if (p === "foundry" || p === "microsoft") return foundry(env);
  if (p === "openai") return openaiDecisions(env);
  throw new Error(`Unknown DECISION_PROVIDER "${p}". Use mock | typesafe | foundry | openai`);
}

export { llmBaseline };
