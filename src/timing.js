// Wraps a provider so every call is timed on this machine (performance.now()).
// In live mode these are real network round trips; in mock mode they are the simulated sleep.
import { median } from "./format.js";

export function timed(provider) {
  const calls = [];
  const models = new Set();
  let retries = 0;
  const wrapped = Object.create(provider);
  wrapped.decide = async (state, questions) => {
    const t0 = performance.now();
    const r = await provider.decide(state, questions);
    calls.push(performance.now() - t0);
    if (r.model) models.add(r.model);
    retries += r.retries || 0;
    return r;
  };
  wrapped.stats = () => {
    if (!calls.length) return null;
    const s = [...calls].sort((a, b) => a - b);
    const p95 = s[Math.min(s.length - 1, Math.ceil(0.95 * s.length) - 1)];
    return { n: calls.length, first: calls[0], median: median(calls), p95, min: s[0], max: s[s.length - 1], models: [...models], retries };
  };
  return wrapped;
}

export function banner(provider) {
  const lines = [`Decision model: ${provider.name}`];
  if (provider.fallbackReason) lines.push(`NOTE: ${provider.fallbackReason}`);
  if (provider.mock) lines.push("MOCK MODE: keyword stand-in, latency SIMULATED. Run `npm run demo:azure` with a key for the real model.");
  else {
    let host = "";
    try { host = new URL(provider.url).host; } catch {}
    lines.push(`LIVE: ${host || "remote API"}${provider.model ? `, deployment "${provider.model}"` : ""}. Latency below is measured on this machine (network round trip included).`);
  }
  return lines.join("\n");
}

export function summary(provider, wrapped) {
  const st = wrapped.stats();
  if (!st) return "";
  const r = (n) => `${Math.round(n)} ms`;
  const kind = provider.mock ? "SIMULATED" : "measured";
  const lines = [
    "",
    `--- latency (${kind}, ${st.n} calls) ---`,
    `median ${r(st.median)}   p95 ${r(st.p95)}   min ${r(st.min)}   max ${r(st.max)}`,
    `first call ${r(st.first)}${provider.mock ? "" : " (includes connection setup)"}`,
  ];
  if (!provider.mock && st.models.length) lines.push(`model reported by the API: ${st.models.join(", ")}`);
  if (st.retries) lines.push(`retries after HTTP 429: ${st.retries}`);
  return lines.join("\n");
}
