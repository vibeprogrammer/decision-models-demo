// Offline stand-in so the whole demo runs with no keys and no network.
// It is NOT a model: it scores options by keyword overlap between the state and each
// option's description, then turns the overlaps into probabilities with a softmax.
// That is enough to show the shape of the API (typed answers, a probability for every
// option, confidence you can gate on). Real decisions come from a real provider.
//
// Latency is a sleep (MOCK_DECISION_MS, default 130 ms: the per-task median Artificial
// Analysis published on 2026-10-13 for Jev 1.13). Only `npm run demo` uses this offline
// stand-in; the comparison with an LLM is always live.

import { choiceConfidence, argmax } from "../questions.js";

const STOP = new Set("a an the and or of to in on for with is are was be this that it its as at by from not no do does did have has into out than then them they you your our we can will just only any all more most very".split(" "));

export function tokens(text) {
  const out = new Set();
  for (const w of String(text).toLowerCase().split(/[^a-z0-9]+/)) {
    if (w.length < 3 || STOP.has(w)) continue;
    out.add(w.length > 5 ? w.slice(0, 5) : w);
  }
  return out;
}

function overlap(stateTokens, text) {
  let n = 0;
  for (const t of tokens(text)) if (stateTokens.has(t)) n++;
  return n;
}

function softmax(scores, temperature = 0.55) {
  const keys = Object.keys(scores);
  const m = Math.max(...keys.map((k) => scores[k]));
  const ex = keys.map((k) => Math.exp((scores[k] - m) / temperature));
  const sum = ex.reduce((a, b) => a + b, 0);
  const out = {};
  keys.forEach((k, i) => (out[k] = Math.round((ex[i] / sum) * 1000) / 1000));
  return out;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function mockAnswer(state, q) {
  const st = tokens(typeof state === "string" ? state : JSON.stringify(state));
  if (q.type === "choice") {
    const s = {};
    for (const [k, d] of Object.entries(q.options)) s[k] = overlap(st, `${k} ${d}`);
    const probabilities = softmax(s);
    return { type: "choice", choice: argmax(probabilities), probabilities, confidence: Math.round(choiceConfidence(probabilities) * 100) / 100 };
  }
  if (q.type === "score") {
    const s = {};
    q.levels.forEach((d, i) => (s[String(i)] = overlap(st, d)));
    const probabilities = softmax(s);
    const score = Object.entries(probabilities).reduce((acc, [i, p]) => acc + Number(i) * p, 0);
    const legend = Object.fromEntries(q.levels.map((d, i) => [String(i), d]));
    return { type: "score", score: Math.round(score * 100) / 100, probabilities, confidence: Math.round(choiceConfidence(probabilities) * 100) / 100, legend };
  }
  // yes/no
  if (q.criteria) {
    const t = overlap(st, q.criteria.true), f = overlap(st, q.criteria.false);
    if (t === 0 && f === 0) return { type: "yesno", probability: 0.15 }; // no evidence either way
    const p = softmax({ true: t, false: f });
    return { type: "yesno", probability: p.true };
  }
  const c = overlap(st, q.instructions);
  return { type: "yesno", probability: c > 0 ? Math.min(0.95, 0.55 + 0.12 * c) : 0.12 };
}

export function mockDecisionProvider(env = process.env) {
  const ms = Number(env.MOCK_DECISION_MS ?? 130);
  return {
    name: "mock decision model",
    mock: true,
    async decide(state, questions) {
      await sleep(ms);
      const answers = {};
      for (const [id, q] of Object.entries(questions)) answers[id] = mockAnswer(state, q);
      return { model: "mock-decision", answers };
    },
  };
}
