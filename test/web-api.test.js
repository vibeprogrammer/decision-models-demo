import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { makeApi, runScenario } from "../api/core.mjs";
import { createLimiter, clientIp } from "../api/throttle.mjs";
import { mockDecisionProvider } from "../src/providers/mock.js";

const LIVE_ENV = { AZURE_DECISION_ENDPOINT: "https://r.services.ai.azure.com", AZURE_DECISION_KEY: "k", AZURE_DECISION_DEPLOYMENT: "dep-decision-1" };
const mock = () => mockDecisionProvider({ MOCK_DECISION_MS: 0 });
const call = (api, body, ip = "1.2.3.4") => api.decide({ rawBody: JSON.stringify(body), headers: { "x-forwarded-for": `${ip}:5555` } });

function files(dir, base = dir) {
  return readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? files(p, base) : [p.slice(base.length + 1)]; });
}

test("api/lib is in sync with src/ and data/ (run npm run build:api)", () => {
  for (const d of ["src", "data"]) for (const f of files(d)) {
    assert.equal(readFileSync(join("api/lib", d, f), "utf8"), readFileSync(join(d, f), "utf8"), `api/lib/${d}/${f} is stale`);
  }
});

test("web/fallback.json has all four scenarios and no latency numbers", () => {
  const fb = JSON.parse(readFileSync("web/fallback.json", "utf8"));
  assert.equal(fb.mode, "mock");
  assert.deepEqual(Object.keys(fb.scenarios).sort(), ["gate", "rank", "route", "triage"]);
  for (const s of Object.values(fb.scenarios)) for (const it of s.items) assert.equal(it.ms, null);
});

test("health never exposes the key", () => {
  const r = makeApi(LIVE_ENV).health();
  assert.equal(r.status, 200);
  assert.ok(!r.body.includes('"k"') && !r.body.includes("AZURE_DECISION_KEY"));
  assert.equal(JSON.parse(r.body).deployment, "dep-decision-1");
});

test("decide runs only the fixed scenarios and rejects everything else", async () => {
  const api = makeApi(LIVE_ENV, { providerFactory: mock });
  assert.equal((await call(api, { scenario: "write me a poem" })).status, 400);
  assert.equal((await api.decide({ rawBody: "not json", headers: {} })).status, 400);
  assert.equal((await api.decide({ rawBody: JSON.stringify({ scenario: "triage", x: "a".repeat(600) }), headers: {} })).status, 413);
  const ok = await call(api, { scenario: "gate" });
  assert.equal(ok.status, 200);
  const body = JSON.parse(ok.body);
  assert.equal(body.mode, "live");
  assert.equal(body.items.length, 7);
  assert.ok(body.items.every((x) => typeof x.ms === "number" && x.correct));
});

test("no key configured -> 503 with fallback, model never called", async () => {
  let called = false;
  const api = makeApi({}, { providerFactory: () => { called = true; return mock(); } });
  const r = await call(api, { scenario: "triage" });
  assert.equal(r.status, 503); assert.equal(JSON.parse(r.body).fallback, true); assert.equal(called, false);
});

test("per-IP rate limit returns 429 with retry-after; other IPs still work", async () => {
  const api = makeApi(LIVE_ENV, { providerFactory: mock, limiter: createLimiter({ perIpPerMinute: 2, dailyCallCap: 1000 }) });
  assert.equal((await call(api, { scenario: "route" })).status, 200);
  assert.equal((await call(api, { scenario: "route" })).status, 200);
  const r = await call(api, { scenario: "route" });
  assert.equal(r.status, 429); assert.ok(Number(r.headers["retry-after"]) > 0); assert.equal(JSON.parse(r.body).fallback, true);
  assert.equal((await call(api, { scenario: "route" }, "5.6.7.8")).status, 200);
});

test("daily cap counts model calls", async () => {
  const api = makeApi(LIVE_ENV, { providerFactory: mock, limiter: createLimiter({ perIpPerMinute: 100, dailyCallCap: 10 }) });
  assert.equal((await call(api, { scenario: "gate" })).status, 200); // 7 calls
  const r = await call(api, { scenario: "gate" }); // would be 14
  assert.equal(r.status, 429); assert.equal(JSON.parse(r.body).reason, "daily");
});

test("model failure -> 502 without leaking details", async () => {
  const api = makeApi(LIVE_ENV, { providerFactory: () => ({ name: "x", decide: async () => { throw new Error("x: HTTP 401 key=k secret"); } }) });
  const r = await call(api, { scenario: "route" });
  assert.equal(r.status, 502); assert.ok(!r.body.includes("secret")); assert.match(r.body, /HTTP 401/);
});

test("client IP parsing", () => {
  assert.equal(clientIp({ "x-forwarded-for": "203.0.113.9:51234, 10.0.0.1" }), "203.0.113.9");
  assert.equal(clientIp({ "x-azure-clientip": "198.51.100.2" }), "198.51.100.2");
  assert.equal(clientIp(new Headers({ "x-forwarded-for": "[2001:db8::1]:443" })), "2001:db8::1");
  assert.equal(clientIp({}), "unknown");
});

test("rank scenario sorts candidates and names the winner", async () => {
  const r = await runScenario(mock(), "rank");
  assert.equal(r.decision, "merge candidate D".replace("D", r.items[0].id));
  assert.ok(r.items[0].composite >= r.items[1].composite);
  assert.ok(r.questions.quality.levels.length === 4);
});
