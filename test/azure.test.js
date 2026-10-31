import { test } from "node:test";
import assert from "node:assert/strict";
import { foundry, foundryConfig, foundryUrl, DEFAULT_DEPLOYMENT } from "../src/providers/systemone.js";
import { decisionProvider, parseArgs } from "../src/providers/index.js";
import { choice } from "../src/questions.js";

const Q = { team: choice("Which team?", { billing: "Charges", engineering: "Bugs" }) };
const ok = (body = { model: "microsoft-decision-1", answers: { team: { type: "choice", choice: "engineering", probabilities: { billing: 0.1, engineering: 0.9 } } } }) =>
  async (url, init) => { ok.calls.push({ url, init }); return new Response(JSON.stringify(body), { status: 200 }); };
ok.calls = [];

const FULL = "https://proj-middagskos-resource.services.ai.azure.com/providers/microsoft/v1/systemone";

test("endpoint works as resource URL or as full decision URL (no doubled path)", () => {
  assert.equal(foundryUrl("https://res.services.ai.azure.com"), "https://res.services.ai.azure.com/providers/microsoft/v1/systemone");
  assert.equal(foundryUrl("https://res.services.ai.azure.com/"), "https://res.services.ai.azure.com/providers/microsoft/v1/systemone");
  assert.equal(foundryUrl(FULL), FULL);
  assert.equal(foundryUrl(FULL + "/"), FULL);
});

test("AZURE_DECISION_* names, old names still work, deployment defaults to Microsoft-Decision-1", () => {
  const a = foundryConfig({ AZURE_DECISION_ENDPOINT: FULL, AZURE_DECISION_KEY: "k" });
  assert.equal(a.url, FULL); assert.equal(a.deployment, DEFAULT_DEPLOYMENT); assert.equal(a.ready, true);
  const b = foundryConfig({ AZURE_ENDPOINT: "https://r.services.ai.azure.com", AZURE_API_KEY: "k", AZURE_DEPLOYMENT: "d1" });
  assert.equal(b.deployment, "d1"); assert.equal(b.ready, true);
  assert.equal(foundryConfig({ AZURE_DECISION_ENDPOINT: FULL }).ready, false);
});

test("api-key header by default, Bearer when only an Entra token is set", async () => {
  ok.calls = [];
  const f = ok();
  await foundry({ AZURE_DECISION_ENDPOINT: FULL, AZURE_DECISION_KEY: "secret-key", AZURE_DECISION_DEPLOYMENT: "dm1" }, f).decide("s", Q);
  await foundry({ AZURE_DECISION_ENDPOINT: FULL, AZURE_DECISION_TOKEN: "tok" }, f).decide("s", Q);
  assert.equal(ok.calls[0].url, FULL);
  assert.equal(ok.calls[0].init.headers["api-key"], "secret-key");
  assert.equal(ok.calls[0].init.headers.Authorization, undefined);
  assert.equal(JSON.parse(ok.calls[0].init.body).model, "dm1");
  assert.equal(ok.calls[1].init.headers.Authorization, "Bearer tok");
  assert.equal(JSON.parse(ok.calls[1].init.body).model, DEFAULT_DEPLOYMENT);
});

test("401 gives a hint and never leaks the key", async () => {
  const f = async () => new Response('{"error":{"code":"401","message":"Access denied"}}', { status: 401 });
  await assert.rejects(
    foundry({ AZURE_DECISION_ENDPOINT: FULL, AZURE_DECISION_KEY: "super-secret-123" }, f).decide("s", Q),
    (e) => /HTTP 401/.test(e.message) && /AZURE_DECISION_KEY/.test(e.message) && !e.message.includes("super-secret-123"),
  );
});

test("429 is retried, then succeeds", async () => {
  let n = 0;
  const f = async () => (++n === 1 ? new Response("{}", { status: 429, headers: { "retry-after": "0" } }) : new Response(JSON.stringify({ answers: {} }), { status: 200 }));
  const r = await foundry({ AZURE_DECISION_ENDPOINT: FULL, AZURE_DECISION_KEY: "k" }, f).decide("s", Q);
  assert.equal(n, 2); assert.equal(r.retries, 1);
});

test("--provider azure without a key falls back to mock and says why; strict fails", () => {
  const p = decisionProvider({}, { provider: "azure" });
  assert.equal(p.mock, true);
  assert.match(p.fallbackReason, /AZURE_DECISION_ENDPOINT and AZURE_DECISION_KEY/);
  assert.throws(() => decisionProvider({}, { provider: "azure", strict: true }), /AZURE_DECISION_KEY/);
  const live = decisionProvider({ AZURE_DECISION_ENDPOINT: FULL, AZURE_DECISION_KEY: "k" }, { provider: "azure" });
  assert.equal(live.mock, undefined);
  assert.equal(live.url, FULL);
});

test("argument parsing", () => {
  assert.deepEqual(parseArgs(["--provider", "azure", "gate"]), { provider: "azure", strict: false, rest: ["gate"] });
  assert.deepEqual(parseArgs(["rank", "--provider=jev", "--strict"]), { provider: "jev", strict: true, rest: ["rank"] });
});
