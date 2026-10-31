// Decision model vs regular LLM: the page. No framework, no build step.
// Flow of a live run: POST /api/run reserves the run (rate limit + daily cap), then both
// lanes call POST /api/decide item by item, at the same time, so you watch them race.
// Before any run (or when the live models are throttled) the page shows web/recorded.json:
// a real run recorded from this site. Nothing on this page is simulated.

const USE_CASES = {
  triage: { tab: "Triage issues", desc: "Eight incoming GitHub issues. For each: what kind is it, how severe, and must a human look first? Your code labels, assigns or pages a maintainer." },
  gate: { tab: "Gate tool calls", desc: "Seven commands a coding agent wants to run. The model scores the risk; your code allows, asks or blocks." },
  rank: { tab: "Rank fixes", desc: "Four candidate fixes for one failing test. The model scores each one; your code ranks them and merges the best." },
  route: { tab: "Route tasks", desc: "Six coding tasks. The model picks who should handle each: a small model, a frontier model or a human." },
};
const KEYS = Object.keys(USE_CASES);
const LANES = ["decision", "llm"];
const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

let catalog, recorded;
const live = {};          // scenario -> { lanes: { decision: {wallMs, items}, llm: {...} }, at }
let current = "triage";
let busy = false;

// ---------- helpers ----------
const fmtMs = (n) => (n == null ? "–" : n >= 1000 ? `${(n / 1000).toFixed(2)} s` : `${Math.round(n)} ms`);
const median = (xs) => { const s = xs.filter((x) => x != null).sort((a, b) => a - b); if (!s.length) return null; const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const sum = (xs) => xs.reduce((t, x) => t + (x ?? 0), 0);
const pretty = (o) => JSON.stringify(o, null, 2);
const expectedLabel = (key, exp) => {
  if (key === "triage") return `${exp.kind}${exp.needs_human ? ", human first" : ""}`;
  if (key === "rank") return `best fix: ${exp}`;
  return exp;
};

// Rank is judged as a whole: did the top-ranked fix match the expected one?
function rankOutcome(items) {
  const done = items.filter((x) => x && !x.error);
  if (done.length < catalog.rank.items.length) return null;
  const order = [...done].sort((a, b) => (b.composite ?? -99) - (a.composite ?? -99));
  return { order: order.map((x) => x.id), top: order[0].id, correct: order[0].id === order[0].expected && order[0].composite != null };
}

function laneStats(key, lane) {
  const items = (lane?.items ?? []).filter(Boolean);
  const ok = items.filter((x) => !x.error);
  let correct, total;
  if (key === "rank") { const r = rankOutcome(lane.items); correct = r ? (r.correct ? 1 : 0) : null; total = 1; }
  else { correct = ok.filter((x) => x.correct).length; total = catalog[key].items.length; }
  if (!items.length) correct = null;
  return {
    n: items.length, correct, total,
    median: median(ok.map((x) => x.ms)),
    modelMs: sum(ok.map((x) => x.ms)),
    tokIn: sum(ok.map((x) => x.usage?.input)), tokOut: sum(ok.map((x) => x.usage?.output)),
    parseErrors: ok.filter((x) => x.parseError).length,
    errors: items.filter((x) => x.error).length,
  };
}

// ---------- tabs ----------
function buildTabs() {
  const tabs = $("tabs");
  KEYS.forEach((key, i) => {
    const b = el("button", "tab");
    b.type = "button"; b.id = `tab-${key}`; b.setAttribute("role", "tab"); b.dataset.key = key;
    b.setAttribute("aria-controls", "panel");
    b.append(el("span", "n", String(i + 1)), USE_CASES[key].tab);
    b.addEventListener("click", () => select(key));
    b.addEventListener("keydown", (e) => {
      const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
      if (!d) return;
      e.preventDefault();
      const next = KEYS[(KEYS.indexOf(key) + d + KEYS.length) % KEYS.length];
      select(next); $(`tab-${next}`).focus();
    });
    tabs.append(b);
  });
}

function select(key) {
  if (busy) return;
  current = key;
  for (const b of document.querySelectorAll(".tab")) {
    const on = b.dataset.key === key;
    b.setAttribute("aria-selected", String(on)); b.tabIndex = on ? 0 : -1;
  }
  $("panel").setAttribute("aria-labelledby", `tab-${key}`);
  $("title").textContent = catalog[key].title;
  $("desc").textContent = USE_CASES[key].desc;
  if (location.hash !== `#${key}`) history.replaceState(null, "", `#${key}`);
  render(key);
}

// ---------- rendering ----------
function dataFor(key) {
  if (live[key]) return { src: "live", ...live[key] };
  const r = recorded?.scenarios?.[key];
  return r ? { src: "recorded", ...r } : null;
}

function render(key, { running = false } = {}) {
  const data = dataFor(key);
  const rows = $("rows");
  rows.replaceChildren();
  const head = el("div", "row head"); head.setAttribute("role", "row");
  for (const t of ["Item and expected answer", "Decision model", "Regular LLM"]) { const c = el("div", null, t); c.setAttribute("role", "columnheader"); head.append(c); }
  rows.append(head);

  // shared latency scale across both lanes, so bars compare directly
  const all = LANES.flatMap((l) => (data?.lanes?.[l]?.items ?? []).filter(Boolean).map((x) => x.ms ?? 0));
  const scale = Math.max(1, ...all, running ? 1500 : 1);
  const rank = { decision: key === "rank" ? rankOutcome(data?.lanes?.decision?.items ?? []) : null, llm: key === "rank" ? rankOutcome(data?.lanes?.llm?.items ?? []) : null };

  catalog[key].items.forEach((it, i) => {
    const row = el("div", "row"); row.setAttribute("role", "row");
    const item = el("div", "item"); item.setAttribute("role", "cell");
    item.append(el("span", "id", it.id), el("span", "txt", it.text.replace(/^Failing test: .*\n/, "")), el("span", "exp", `Expected: ${expectedLabel(key, it.expected)}`));
    row.append(item);
    for (const lane of LANES) row.append(cell(key, lane, data?.lanes?.[lane]?.items?.[i], scale, running, rank[lane]));
    rows.append(row);
  });

  if (key === "rank") {
    const it = catalog.rank.items[0];
    const m = it.text.match(/^Failing test: (.*)$/m);
    if (m) rows.prepend(Object.assign(el("p", "meta", `Failing test: ${m[1]}`), { style: "margin:0 0 8px" }));
  }

  // scoreboard
  for (const lane of LANES) {
    const st = laneStats(key, data?.lanes?.[lane]);
    $(`acc-${lane}`).textContent = st.correct == null ? "–" : key === "rank" ? (st.correct ? "picked the right fix" : "picked the wrong fix") : `${st.correct} / ${st.total}${st.parseErrors ? ` · ${st.parseErrors} unparseable` : ""}`;
    $(`med-${lane}`).textContent = fmtMs(st.median);
    $(`tok-${lane}`).textContent = st.n ? `${st.tokIn.toLocaleString("en")} / ${st.tokOut.toLocaleString("en")}` : "–";
    if (!running) $(`clock-${lane}`).textContent = data?.lanes?.[lane]?.wallMs != null ? (data.lanes[lane].wallMs / 1000).toFixed(2) : "0.00";
    $(`side-${lane}`).classList.toggle("running", running && !(data?.lanes?.[lane]?.done));
    $(`race-${lane}`).style.width = `${(st.n / catalog[key].items.length) * 100}%`;
  }
  verdict(key, data, running);
  $("source").textContent = !data ? "No results yet. Press Run live." : data.src === "live"
    ? `Your live run, ${new Date(data.at).toLocaleTimeString()}. Latency per item is the model round trip measured on the server; the clocks are wall time in your browser.`
    : `Recorded live run from ${new Date(recorded.recordedAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}. Press Run live to measure it yourself.`;
  renderJson(key, data);
  renderChart();
}

function cell(key, lane, r, scale, running, rank) {
  const c = el("div", `cell ${lane === "decision" ? "d" : "l"}`); c.setAttribute("role", "cell");
  c.append(el("span", "lane", lane === "decision" ? "Decision model" : "Regular LLM"));
  if (!r) { c.append(el("span", running ? "pending" : "pending-none", running ? "waiting" : "–")); return c; }
  if (r.error) { c.append(el("span", "err", r.error)); return c; }
  const ans = el("div", "ans");
  if (key !== "rank") {
    const b = el("span", `badge ${r.correct ? "ok" : "bad"}`, r.correct ? "✓" : "✗");
    b.setAttribute("aria-label", r.correct ? "correct" : "wrong"); b.title = r.correct ? "correct" : "wrong";
    ans.append(b);
  } else if (rank) {
    const pos = rank.order.indexOf(r.id) + 1;
    const top = pos === 1;
    const b = el("span", `badge ${top ? (rank.correct ? "ok" : "bad") : "na"}`, String(pos));
    b.setAttribute("aria-label", `ranked ${pos}`); b.title = `ranked ${pos}`;
    ans.append(b);
  }
  ans.append(el("span", null, r.parseError ? "unparseable answer" : answerText(key, r)));
  c.append(ans);
  const meta = metaText(key, lane, r);
  if (meta) c.append(el("div", "meta", meta));
  const conf = confidenceOf(key, r);
  if (lane === "decision" && conf != null) {
    const p = el("div", "prob"); const t = el("span", "track"); const f = el("span", "fill");
    f.style.width = `${Math.round(conf * 100)}%`; t.append(f);
    p.append(t, el("span", null, `${Math.round(conf * 100)}% ${confLabel(key)}`)); c.append(p);
  } else if (lane === "llm") {
    c.append(el("div", "meta", "no probability"));
  }
  const lat = el("div", "lat"); const t = el("span", "track"); const f = el("span", "fill");
  f.style.width = `${Math.max(1, (r.ms / scale) * 100)}%`; t.append(f);
  lat.append(t, el("span", "v", fmtMs(r.ms))); c.append(lat);
  return c;
}

function answerText(key, r) {
  const a = r.answers;
  if (key === "triage") return r.action;
  if (key === "gate") return r.action;
  if (key === "route") return r.action;
  return `quality ${fmtNum(a.quality?.score)} of 3${a.games_tests?.probability >= 0.5 ? ", games the tests" : ""}`;
}
function metaText(key, lane, r) {
  const a = r.answers;
  if (r.parseError) return "the JSON didn't match the questions";
  if (key === "triage") return `kind ${a.kind?.choice} · severity ${fmtNum(a.severity?.score)} of 3`;
  if (key === "gate") return `risk ${fmtNum(a.risk?.score)} of 2`;
  if (key === "rank") return `score ${fmtNum(r.composite)}`;
  return null;
}
const fmtNum = (x) => (x == null ? "?" : Number.isInteger(x) ? String(x) : x.toFixed(2));
function confidenceOf(key, r) {
  const a = r.answers;
  if (key === "triage") return a.kind?.confidence ?? null;
  if (key === "route") return a.handler?.confidence ?? null;
  if (key === "gate") return a.risk?.confidence ?? null;
  if (key === "rank") return a.quality?.confidence ?? null;
  return null;
}
const confLabel = (key) => (key === "triage" ? "sure of the kind" : key === "route" ? "sure of the handler" : "confidence");

function verdict(key, data, running) {
  const v = $("verdict");
  v.replaceChildren();
  if (running || !data) return;
  const d = laneStats(key, data.lanes.decision), l = laneStats(key, data.lanes.llm);
  if (!d.median || !l.median) return;
  const x = l.median / d.median;
  const big = el("span", "big", x >= 1.15 ? `${x.toFixed(1)}× faster` : x <= 0.87 ? `${(1 / x).toFixed(1)}× slower` : "about as fast");
  v.append("Decision model: ", big, ` per decision (median ${fmtMs(d.median)} vs ${fmtMs(l.median)})`);
  const tokRatio = l.tokOut && d.tokOut != null ? l.tokOut / Math.max(1, d.tokOut) : null;
  if (tokRatio && tokRatio > 1.5) v.append(`, ${tokRatio.toFixed(0)}× fewer output tokens`);
  v.append(", and a probability to act on.");
  $("side-decision").classList.toggle("win", x >= 1);
}

function renderJson(key, data) {
  const pick = (lane) => (data?.lanes?.[lane]?.items ?? []).find((x) => x?.io)?.io;
  const d = pick("decision") ?? recorded?.scenarios?.[key]?.lanes?.decision?.items?.find((x) => x?.io)?.io;
  const l = pick("llm") ?? recorded?.scenarios?.[key]?.lanes?.llm?.items?.find((x) => x?.io)?.io;
  $("json-d-req").textContent = d ? pretty(d.request) : "Run once to see it.";
  $("json-d-res").textContent = d ? pretty(d.response) : "";
  $("json-l-req").textContent = l ? pretty(l.request) : "Run once to see it.";
  $("json-l-res").textContent = l ? pretty(l.response) : "";
  $("json-note").textContent = `Real JSON from ${data?.src === "live" ? "your run" : "the recorded run"} (first item). Deployment names are replaced with <deployment>; the API key is never sent to the page.`;
}

function renderChart() {
  const chart = $("chart");
  chart.replaceChildren();
  const rows = KEYS.map((key) => { const data = dataFor(key); return { key, data, d: data && laneStats(key, data.lanes.decision), l: data && laneStats(key, data.lanes.llm) }; });
  const max = Math.max(1, ...rows.flatMap((r) => [r.d?.median ?? 0, r.l?.median ?? 0]));
  let anyLive = false;
  for (const r of rows) {
    if (!r.data) continue;
    anyLive ||= r.data.src === "live";
    const row = el("div", "crow");
    row.append(el("div", "name", USE_CASES[r.key].tab));
    const bars = el("div", "bars");
    for (const [cls, st, label] of [["d", r.d, "Decision model"], ["l", r.l, "Regular LLM"]]) {
      const b = el("div", `b ${cls}`); const f = el("span", "fill");
      f.style.width = `${((st.median ?? 0) / max) * 75}%`;
      b.append(f, el("span", null, fmtMs(st.median)));
      b.setAttribute("aria-label", `${label}: median ${fmtMs(st.median)}`);
      bars.append(b);
    }
    row.append(bars);
    const acc = el("div", "acc");
    const accTxt = (st) => (r.key === "rank" ? (st.correct ? "right fix" : st.correct === 0 ? "wrong fix" : "–") : `${st.correct}/${st.total}`);
    acc.append(el("b", null, accTxt(r.d)), " vs ", el("b", null, accTxt(r.l)), el("br"), el("span", null, "correct"));
    row.append(acc);
    chart.append(row);
  }
  $("sum-src").textContent = anyLive ? "Includes your live runs; the rest is the recorded run." : recorded ? "From the recorded run; your live runs replace it." : "";
}

// ---------- live run ----------
const post = async (path, body) => {
  const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  let j = {}; try { j = await res.json(); } catch {}
  return { status: res.status, body: j };
};

async function runLive() {
  if (busy) return;
  const key = current;
  const btn = $("run"), status = $("status");
  status.classList.remove("warn");
  busy = true; btn.disabled = true; btn.textContent = "Running…";
  status.textContent = "Starting a live run…";
  try {
    const start = await post("/api/run", { scenario: key });
    if (start.status !== 200) {
      status.textContent = start.body.error || `The live run didn't start (HTTP ${start.status}).`;
      status.classList.add("warn");
      return;
    }
    const n = start.body.items;
    live[key] = { at: Date.now(), lanes: { decision: { items: new Array(n), wallMs: null }, llm: { items: new Array(n), wallMs: null } } };
    render(key, { running: true });
    const t0 = performance.now();
    let raf;
    const tick = () => {
      for (const lane of LANES) {
        const L = live[key].lanes[lane];
        $(`clock-${lane}`).textContent = ((L.wallMs ?? performance.now() - t0) / 1000).toFixed(2);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    status.textContent = `Both models are answering ${n} items, one after another…`;
    await Promise.all(LANES.map(async (lane) => {
      const L = live[key].lanes[lane];
      for (let i = 0; i < n; i++) {
        const r = await post("/api/decide", { run: start.body.run, lane, item: i });
        L.items[i] = r.status === 200 ? r.body.result : { error: r.body.error || `HTTP ${r.status}` };
        if (i === n - 1) { L.wallMs = Math.round(performance.now() - t0); L.done = true; }
        if (key === current) render(key, { running: true });
      }
    }));
    cancelAnimationFrame(raf);
    render(key);
    const left = start.body.limits;
    status.textContent = left ? `Done. ${left.remainingThisMinute} more live runs this minute.` : "Done.";
  } catch (e) {
    status.textContent = "The live run failed on the network. Showing what we have.";
    status.classList.add("warn");
  } finally {
    busy = false; btn.disabled = false; btn.textContent = "Run live";
    if (live[key] && !LANES.every((l) => live[key].lanes[l].done)) { delete live[key]; render(key); }
  }
}

// ---------- boot ----------
async function boot() {
  const [c, r, h] = await Promise.all([
    fetch("scenarios.json").then((x) => x.json()),
    fetch("recorded.json").then((x) => (x.ok ? x.json() : null)).catch(() => null),
    fetch("/api/health").then((x) => (x.ok ? x.json() : null)).catch(() => null),
  ]);
  catalog = c; recorded = r;
  buildTabs();
  $("run").addEventListener("click", runLive);
  if (h?.limits) $("limits").textContent = `${h.limits.perIpPerMinute} live runs per minute per visitor, ${h.limits.dailyCallCap} model calls per day across both models`;
  if (h && !h.live) { $("status").textContent = "Live models aren't configured on this deployment; showing the recorded run."; }
  const fromHash = location.hash.slice(1);
  select(KEYS.includes(fromHash) ? fromHash : "triage");
}
boot();
