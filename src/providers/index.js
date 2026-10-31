import { mockDecisionProvider } from "./mock.js";
import { typesafe, foundry, foundryConfig } from "./systemone.js";
import { openaiDecisions } from "./openai-decisions.js";
import { llmBaseline } from "./llm-baseline.js";

const ALIASES = { jev: "typesafe", microsoft: "foundry", azure: "foundry" };

// Pick the decision model. Your app code never changes.
// Order: --provider flag, then DECISION_PROVIDER, then mock.
// If a real provider is asked for but its key is missing, the demo falls back to mock
// and says so (fallback), unless strict is set (CI / the live-azure workflow).
export function decisionProvider(env = process.env, { provider, strict = false } = {}) {
  const raw = (provider || env.DECISION_PROVIDER || "mock").toLowerCase();
  const p = ALIASES[raw] || raw;
  if (p === "mock") return mockDecisionProvider(env);
  try {
    if (p === "typesafe") return typesafe(env);
    if (p === "foundry") return foundry(env);
    if (p === "openai") return openaiDecisions(env);
  } catch (e) {
    if (strict || env.DEMO_STRICT === "1") throw e;
    const m = mockDecisionProvider(env);
    m.fallbackReason = `${e.message}. Falling back to MOCK mode.`;
    return m;
  }
  throw new Error(`Unknown provider "${raw}". Use mock | azure (foundry) | typesafe (jev) | openai`);
}

// Tiny argv parser: --provider azure, --strict, first bare word = scenario.
export function parseArgs(argv = process.argv.slice(2)) {
  const out = { provider: undefined, strict: false, rest: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--provider" || a === "-p") out.provider = argv[++i];
    else if (a.startsWith("--provider=")) out.provider = a.split("=")[1];
    else if (a === "--strict") out.strict = true;
    else out.rest.push(a);
  }
  return out;
}

export { llmBaseline, foundryConfig };
