// Web demo front end. No framework, no build step.
const DESC = {
  triage: "Eight GitHub issues. One request per issue asks three questions at once: what kind, how severe, and must a human see it first. The code decides what to do.",
  gate: "A coding agent wants to run a command. The model scores the risk; the code maps the score to allow, ask or block.",
  rank: "Four candidate fixes for a failing test. One of them just deleted the assertion. All four are scored in parallel and combined in code.",
  route: "Send each task to a small model, a frontier model or a human. Low confidence goes to a human.",
};
const $ = (id) => document.getElementById(id);
let current = "triage", fallback = null, live = false;

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const pct = (p) => `${Math.round((p ?? 0) * 100)}%`;

function bars(probs, labels) {
  const entries = Object.entries(probs || {}).sort((a, b) => b[1] - a[1]);
  if (!entries.length) return "";
  const top = entries[0][0];
  return `<div class="bars">${entries.map(([k, p]) => `<span>${esc(labels?.[k] ?? k)}</span><div class="bar${k === top ? " top" : ""}"><span style="width:${Math.max(0, Math.min(100, p * 100)).toFixed(1)}%"></span></div><span class="pct">${pct(p)}</span>`).join("")}</div>`;
}

function answerHtml(id, a, q) {
  if (!a) return "";
  if (a.type === "choice") return `<div class="q"><span class="label">${esc(id)}</span>${bars(a.probabilities)}</div>`;
  if (a.type === "score") {
    const n = q?.levels?.length || 1;
    const lvl = (q?.levels?.[Math.round(a.score)] ?? "").split(":")[0];
    const frac = n > 1 ? a.score / (n - 1) : 0;
    return `<div class="q"><div class="bars"><span>${esc(id)}</span><div class="bar top"><span style="width:${(Math.max(0, Math.min(1, frac)) * 100).toFixed(1)}%"></span></div><span class="pct">${Number(a.score).toFixed(2)}</span></div><span class="label">${esc(lvl)}${n > 1 ? ` (scale 0 to ${n - 1})` : ""}</span></div>`;
  }
  if (a.type === "yesno") return `<div class="q"><div class="bars"><span>${esc(id)}</span><div class="bar top"><span style="width:${(Math.max(0, Math.min(1, a.probability ?? 0)) * 100).toFixed(1)}%"></span></div><span class="pct">${pct(a.probability)}</span></div><span class="label">probability of yes</span></div>`;
  return "";
}

function render(r, mode, note) {
  $("notice").hidden = !note;
  $("notice").textContent = note || "";
  const isLive = mode === "live";
  const n = r.items.length, correct = r.items.filter((x) => x.correct).length;
  const stats = [];
  if (isLive) {
    stats.push(`<div><strong>${r.medianMs} ms</strong>median per decision</div>`);
    stats.push(`<div><strong>${r.wallMs} ms</strong>${r.parallel ? "all scored in parallel" : `total for ${n} decisions`}</div>`);
    if (r.model) stats.push(`<div><strong>${esc(r.model)}</strong>model reported by the API</div>`);
  } else stats.push(`<div><strong>MOCK</strong>keyword stand-in, no latency</div>`);
  if (r.scenario !== "rank") stats.push(`<div><strong>${correct}/${n}</strong>match the labels</div>`);
  else stats.push(`<div><strong>${esc(r.decision)}</strong>decision</div>`);
  $("summary").innerHTML = stats.join("");
  $("summary").hidden = false;

  $("results").innerHTML = r.items.map((it) => {
    const qs = Object.entries(it.answers).map(([id, a]) => answerHtml(id, a, r.questions?.[id])).join("");
    const act = it.action ?? `composite ${Number(it.composite).toFixed(2)}`;
    const cls = /block|page/.test(act) ? (/block/.test(act) ? "block" : "page") : "";
    const miss = it.correct === false ? ` <span class="wrong">(label: ${esc(typeof it.expected === "object" ? it.expected.kind : it.expected)})</span>` : "";
    return `<li><div class="item-head"><p class="item-text"><span class="item-id">${esc(it.id)}</span>${esc(it.text)}</p>${isLive ? `<span class="ms">${it.ms} ms</span>` : ""}</div>${qs}<div class="action ${cls}">→ ${esc(act)}${miss}</div></li>`;
  }).join("");
}

async function loadFallback() {
  if (!fallback) fallback = await (await fetch("fallback.json")).json();
  return fallback;
}

async function showFallback(note) {
  const fb = await loadFallback();
  render(fb.scenarios[current], "mock", note);
}

async function run() {
  const btn = $("run");
  btn.disabled = true; btn.textContent = "Running…";
  try {
    const res = await fetch("api/decide", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ scenario: current }) });
    const body = await res.json().catch(() => ({}));
    if (res.ok && body.mode === "live") render(body, "live", "");
    else await showFallback(body.error || "The live model isn't reachable right now. Showing mock output.");
  } catch {
    await showFallback("The API isn't reachable from here. Showing mock output.");
  } finally {
    btn.disabled = false; btn.textContent = live ? "Run live" : "Run (mock)";
  }
}

function select(s) {
  current = s;
  for (const b of document.querySelectorAll("#tabs button")) b.setAttribute("aria-pressed", String(b.dataset.s === s));
  $("desc").textContent = DESC[s];
  $("results").innerHTML = ""; $("summary").hidden = true; $("notice").hidden = true;
}

document.querySelectorAll("#tabs button").forEach((b) => b.addEventListener("click", () => select(b.dataset.s)));
$("run").addEventListener("click", run);
select("triage");

fetch("api/health").then((r) => r.json()).then((h) => {
  live = !!h.live;
  $("badge").textContent = live ? `LIVE · Microsoft-Decision-1 · deployment ${h.deployment}` : "MOCK · live model not configured";
  $("badge").classList.toggle("live", live);
  $("run").textContent = live ? "Run live" : "Run (mock)";
}).catch(() => { $("badge").textContent = "MOCK · API not reachable"; $("run").textContent = "Run (mock)"; });
