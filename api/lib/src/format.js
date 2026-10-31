// Plain ASCII output so it looks the same in PowerShell, cmd, Terminal and bash.
export const pct = (p) => (p === undefined || p === null || Number.isNaN(p) ? "  n/a" : `${(p * 100).toFixed(0).padStart(4)}%`);
export const bar = (p, width = 20) => "#".repeat(Math.round((p ?? 0) * width)).padEnd(width, ".");
export const ms = (n) => `${Math.round(n)} ms`;

export function describe(id, a) {
  if (!a) return `  ${id}: (no answer)`;
  if (a.type === "choice") {
    const lines = [`  ${id}: ${a.choice}   confidence ${pct(a.confidence)}`];
    for (const [k, p] of Object.entries(a.probabilities ?? {}).sort((x, y) => y[1] - x[1])) lines.push(`      ${k.padEnd(10)} ${bar(p)} ${pct(p)}`);
    return lines.join("\n");
  }
  if (a.type === "score") return `  ${id}: ${Number(a.score).toFixed(2)}${a.legend ? ` (${a.legend[String(Math.round(a.score))]})` : ""}   confidence ${pct(a.confidence)}`;
  if (a.type === "yesno") return `  ${id}: P(yes) = ${pct(a.probability)}  ${bar(a.probability)}`;
  return `  ${id}: ${JSON.stringify(a)}`;
}

export function table(rows) {
  const cols = Object.keys(rows[0]);
  const w = cols.map((c) => Math.max(c.length, ...rows.map((r) => String(r[c]).length)));
  const line = (vals) => vals.map((v, i) => String(v).padEnd(w[i])).join("  ");
  return [line(cols), line(w.map((n) => "-".repeat(n))), ...rows.map((r) => line(cols.map((c) => r[c])))].join("\n");
}

export function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
