// One vendor-neutral way to ask a decision model something.
//
//   choice(instructions, { key: "description", ... })   -> pick one option
//   score(instructions, ["lowest", ..., "highest"])     -> position on an ordered scale
//   yesno(instructions, { true: "...", false: "..." })  -> probability that it is true
//
// Every provider adapter translates these into its own wire format and translates
// the answers back into the same normalized shape:
//
//   { type: "choice", choice, probabilities: {key: p}, confidence }
//   { type: "score",  score, probabilities: {"0": p, ...}, confidence, legend }
//   { type: "yesno",  probability }

export const choice = (instructions, options) => ({ type: "choice", instructions, options });
export const score = (instructions, levels) => ({ type: "score", instructions, levels });
export const yesno = (instructions, criteria) => ({ type: "yesno", instructions, ...(criteria ? { criteria } : {}) });

// Confidence as defined in TypeSafe's and Microsoft's docs for choice answers:
// how far the top probability sits above an even spread, scaled to 0..1.
export function choiceConfidence(probabilities) {
  const ps = Object.values(probabilities);
  const n = ps.length;
  if (n < 2) return 1;
  const pmax = Math.max(...ps);
  return Math.max(0, (pmax - 1 / n) / (1 - 1 / n));
}

export function argmax(probabilities) {
  let best = null, bestP = -1;
  for (const [k, p] of Object.entries(probabilities)) if (p > bestP) { best = k; bestP = p; }
  return best;
}
