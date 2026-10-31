import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { makeApi, runItem, catalog, cleanIo } from "../api/core.mjs";
import { createLimiter, clientIp } from "../api/throttle.mjs";
import { mockDecisionProvider } from "../src/providers/mock.js";
import { llmBaseline, llmConfig } from "../src/providers/llm-baseline.js";

const LIVE_ENV = { AZURE_DECISION_ENDPOINT: "https://r.services.ai.azure.com/providers/microsoft/v1/systemone", AZURE_DECISION_KEY: "k", AZURE_DECISION_DEPLOYMENT: "dep-decision-1" };
const mock = () => mockDecisionProvider({ MOCK_DECISION_MS: 0 });
const providers = { decision: mock, llm: mock };
const hdr = (ip = "1.2.3.4") => ({ "x-forwarded-for": `${ip}:5555` });
const start = (api, scenario, ip) => api.run({ rawBody: JSON.stringify({ scenario }), headers: hdr(ip) });
const ask = (api, body) => api.decide({ rawBody: JSON.stringify(body), headers: hdr() });

function files(dir, base = dir) {
  return readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? files(p, base) : [p.slice(base.length + 1)]; });
}

test("api/lib is in sync with src/ and data/ (run npm run build:api)", () => {
  for (const d of ["src", "data"]) for (const f of files(d)) {
    assert.equal(readFileSync(join("api/lib", d, f), "utf8"), readFileSync(join(d, f), "utf8"), `api/lib/${d}/${f} is stale`);
  }
});

test("web/scenarios.json matches the data (run npm run build:api)", () => {
  assert.deepEqual(JSON.parse(readFileSync("web/scenarios.json", "utf8")), JSON.parse(JSON.stringify(catalog())));
});

test("no simulated output ships with the page", () => {
  assert.equal(existsSync("web/fallback.json"), false);
  if (existsSync("web/recorded.json")) {
    const r = JSON.parse(readFileSync("web/recorded.json", "utf8"));
    assert.ok(r.recordedAt);
    for (const s of Object.values(r.scenarios)) for (const lane of ["decision", "llm"]) for (const it of s.lanes[lane].items) assert.equal(typeof it.ms, "number");
  }
});

test("health never exposes the key and reports both models", () => {
  const r = makeApi(LIVE_ENV).health();
  assert.equal(r.status, 200);
  assert.ok(!r.body.includes('"k"') && !r.body.includes("AZURE_DECISION_KEY"));
  const b = JSON.parse(r.body);
  assert.equal(b.deployment, "dep-decision-1"); assert.equal(b.live, true); assert.equal(b.llm, true);
});

test("a run covers only the fixed scenarios; each lane/item answers once", async () => {
  const api = makeApi(LIVE_ENV, { providers });
  assert.equal((await start(api, "write me a poem")).status, 400);
  assert.equal((await api.run({ rawBody: "not json", headers: {} })).status, 400);
  assert.equal((await api.run({ rawBody: JSON.stringify({ scenario: "triage", x: "a".repeat(600) }), headers: {} })).status, 413);
  const r = JSON.parse((await start(api, "gate")).body);
  assert.equal(r.items, 7); assert.deepEqual(r.lanes, ["decision", "llm"]);
  const ok = await ask(api, { run: r.run, lane: "decision", item: 0 });
  assert.equal(ok.status, 200);
  const body = JSON.parse(ok.body);
  assert.equal(body.mode, "live"); assert.equal(typeof body.result.ms, "number"); assert.equal(body.result.correct, true);
  assert.equal((await ask(api, { run: r.run, lane: "decision", item: 0 })).status, 409);
  assert.equal((await ask(api, { run: r.run, lane: "llm", item: 0 })).status, 200);
  assert.equal((await ask(api, { run: r.run, lane: "llm", item: 7 })).status, 400);
  assert.equal((await ask(api, { run: r.run, lane: "other", item: 1 })).status, 400);
});

test("forged or expired run tokens are refused before any model call", async () => {
  let t = 1_000_000, called = 0;
  const p = { decision: () => { called++; return mock(); }, llm: mock };
  const api = makeApi(LIVE_ENV, { providers: p, now: () => t });
  const r = JSON.parse((await start(api, "route")).body);
  const [payload] = r.run.split(".");
  const forged = Buffer.from(JSON.stringify({ s: "route", e: t + 1e9, n: "x" })).toString("base64url") + "." + r.run.split(".")[1];
  assert.equal((await ask(api, { run: forged, lane: "decision", item: 0 })).status, 403);
  assert.equal((await ask(api, { run: payload + ".AAAA", lane: "decision", item: 0 })).status, 403);
  t += 4 * 60_000;
  assert.equal((await ask(api, { run: r.run, lane: "decision", item: 0 })).status, 403);
  assert.equal(called, 0);
});

test("no key configured -> 503, model never called", async () => {
  let called = false;
  const api = makeApi({}, { providers: { decision: () => { called = true; return mock(); }, llm: mock } });
  const r = await start(api, "triage");
  assert.equal(r.status, 503); assert.equal(JSON.parse(r.body).recorded, true); assert.equal(called, false);
});

test("per-IP rate limit counts runs and returns 429 with retry-after; other IPs still work", async () => {
  const api = makeApi(LIVE_ENV, { providers, limiter: createLimiter({ perIpPerMinute: 2, dailyCallCap: 1000 }) });
  assert.equal((await start(api, "route")).status, 200);
  assert.equal((await start(api, "route")).status, 200);
  const r = await start(api, "route");
  assert.equal(r.status, 429); assert.ok(Number(r.headers["retry-after"]) > 0); assert.equal(JSON.parse(r.body).reason, "per-ip");
  assert.equal((await start(api, "route", "5.6.7.8")).status, 200);
});

test("daily cap counts the model calls of both models", async () => {
  const api = makeApi(LIVE_ENV, { providers, limiter: createLimiter({ perIpPerMinute: 100, dailyCallCap: 20 }) });
  assert.equal((await start(api, "gate")).status, 200); // 7 items x 2 models = 14 calls
  const r = await start(api, "gate"); // would be 28
  assert.equal(r.status, 429); assert.equal(JSON.parse(r.body).reason, "daily");
  assert.equal(JSON.parse(makeApi(LIVE_ENV).health().body).limits.dailyCallCap, 500);
});

test("model failure -> 502 without leaking details", async () => {
  const api = makeApi(LIVE_ENV, { providers: { decision: () => ({ name: "x", decide: async () => { throw new Error("x: HTTP 401 key=k secret"); } }), llm: mock } });
  const r = JSON.parse((await start(api, "route")).body);
  const res = await ask(api, { run: r.run, lane: "decision", item: 0 });
  assert.equal(res.status, 502); assert.ok(!res.body.includes("secret")); assert.match(res.body, /HTTP 401/);
});

test("client IP parsing", () => {
  assert.equal(clientIp({ "x-forwarded-for": "203.0.113.9:51234, 10.0.0.1" }), "203.0.113.9");
  assert.equal(clientIp({ "x-azure-clientip": "198.51.100.2" }), "198.51.100.2");
  assert.equal(clientIp(new Headers({ "x-forwarded-for": "[2001:db8::1]:443" })), "2001:db8::1");
  assert.equal(clientIp({}), "unknown");
});

test("rank items carry a composite score", async () => {
  const r = await runItem(mock(), "rank", 3);
  assert.equal(typeof r.composite, "number"); assert.equal(r.expected, "D");
});

test("example JSON hides deployment names and content-filter noise", () => {
  const io = cleanIo({ request: { model: "dep-gpt-6-luna", messages: [] }, response: { model: "gpt-6-luna", prompt_filter_results: [1], choices: [{ content_filter_results: {}, message: { content: "{}" } }] } }, ["dep-gpt-6-luna"]);
  assert.equal(io.request.model, "<deployment>"); assert.equal(io.response.model, "gpt-6-luna");
  assert.equal(io.response.prompt_filter_results, undefined); assert.equal(io.response.choices[0].content_filter_results, undefined);
});

// ---- the regular-model side: real chat completions, bounded output, no simulation ----
const fakeFetch = (handler) => async (url, init) => {
  const { status, body } = await handler(url, JSON.parse(init.body), init.headers);
  return { ok: status < 400, status, headers: new Headers(), text: async () => JSON.stringify(body) };
};
const LUNA_OK = { model: "gpt-6-luna", choices: [{ finish_reason: "stop", message: { content: "{\"handler\":\"small\"}" } }], usage: { prompt_tokens: 120, completion_tokens: 7 } };
const Q = { handler: { type: "choice", instructions: "Who?", options: { small: "s", frontier: "f", human: "h" } } };

test("LLM config: GPT-6 Luna on the same Foundry resource by default", () => {
  const c = llmConfig(LIVE_ENV);
  assert.equal(c.url, "https://r.services.ai.azure.com/openai/v1/chat/completions");
  assert.equal(c.model, "dep-gpt-6-luna"); assert.equal(c.headers["api-key"], "k"); assert.equal(c.maxTokens, 300);
  assert.equal(llmConfig({ ...LIVE_ENV, AZURE_LLM_DEPLOYMENT: "x", LLM_MAX_OUTPUT_TOKENS: "99999" }).maxTokens, 2000);
  assert.throws(() => llmBaseline({}), /AZURE_DECISION_ENDPOINT/);
});

test("LLM call sends bounded output and returns tokens, parsed answers and the raw JSON", async () => {
  let sent;
  const p = llmBaseline(LIVE_ENV, fakeFetch((url, body) => { sent = body; return { status: 200, body: LUNA_OK }; }));
  const r = await p.decide("Rename a variable", Q);
  assert.equal(sent.model, "dep-gpt-6-luna"); assert.equal(sent.max_completion_tokens, 300); assert.equal(sent.reasoning_effort, "none");
  assert.equal(r.answers.handler.choice, "small"); assert.deepEqual([r.usage.input, r.usage.output], [120, 7]);
  assert.equal(r.io.request.model, "dep-gpt-6-luna"); assert.equal(r.parseError, false);
});

test("LLM call drops a parameter the model refuses and retries", async () => {
  const seen = [];
  const p = llmBaseline(LIVE_ENV, fakeFetch((url, body) => {
    seen.push({ ...body });
    if ("temperature" in body) return { status: 400, body: { error: { message: "Unsupported parameter: 'temperature' is not supported with this model.", param: "temperature" } } };
    if (body.reasoning_effort === "none") return { status: 400, body: { error: { message: "Unsupported value: 'reasoning_effort' does not support 'none' with this model.", param: "reasoning_effort" } } };
    return { status: 200, body: LUNA_OK };
  }));
  const r = await p.decide("x", Q);
  assert.equal(r.answers.handler.choice, "small");
  assert.equal(seen.at(-1).reasoning_effort, "minimal"); assert.ok(!("temperature" in seen.at(-1)));
});
