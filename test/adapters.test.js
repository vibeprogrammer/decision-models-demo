import { test } from "node:test";
import assert from "node:assert/strict";
import { choice, score, yesno, choiceConfidence } from "../src/questions.js";
import { toSystemOneRequest, fromSystemOneResponse, typesafe, foundry } from "../src/providers/systemone.js";
import { toOpenAIRequest, fromOpenAIResponse } from "../src/providers/openai-decisions.js";
import { parseLLMAnswer } from "../src/providers/llm-baseline.js";

const Q = {
  team: choice("Which team?", { billing: "Charges", engineering: "Bugs" }),
  severity: score("How severe?", ["Minor", "Major", "Critical"]),
  urgent: yesno("Is it urgent?", { true: "Time-sensitive", false: "Can wait" }),
};

test("System One request matches the documented wire format", () => {
  const body = toSystemOneRequest("jev-latest", "The API returns 500", Q);
  assert.equal(body.model, "jev-latest");
  assert.equal(body.state, "The API returns 500");
  assert.deepEqual(body.questions.team, { type: "choice", instructions: "Which team?", criteria: { billing: "Charges", engineering: "Bugs" } });
  assert.deepEqual(body.questions.severity.criteria, ["Minor", "Major", "Critical"]);
  assert.equal(body.questions.urgent.type, "noul");
});

test("System One response (TypeSafe quickstart example) is normalized", () => {
  const r = fromSystemOneResponse({
    model: "jev-1.13.0",
    answers: {
      department: { type: "choice", choice: "technical", confidence: 1.0, probabilities: { technical: 1.0, billing: 0.0, sales: 0.0 } },
      frustration: { type: "score", score: 0.67, confidence: 0.5, legend: { 0: "Calm", 1: "Frustrated", 2: "Angry" }, probabilities: { 0: 0.33, 1: 0.67, 2: 0.0 } },
      is_urgent: { type: "noul", noul: 0.99 },
    },
  });
  assert.equal(r.answers.department.choice, "technical");
  assert.equal(r.answers.frustration.score, 0.67);
  assert.deepEqual(r.answers.is_urgent, { type: "yesno", probability: 0.99 });
});

test("TypeSafe and Foundry adapters call the right URLs with the right auth", async () => {
  const calls = [];
  const fakeFetch = async (url, init) => { calls.push({ url, init }); return new Response(JSON.stringify({ model: "x", answers: {} }), { status: 200 }); };
  await typesafe({ TYPESAFE_API_KEY: "k1" }, fakeFetch).decide("s", Q);
  await foundry({ AZURE_ENDPOINT: "https://res.services.ai.azure.com/", AZURE_API_KEY: "k2", AZURE_DEPLOYMENT: "my-decision" }, fakeFetch).decide("s", Q);
  assert.equal(calls[0].url, "https://api.typesafe.ai/v1/systemone");
  assert.equal(calls[0].init.headers.Authorization, "Bearer k1");
  assert.equal(calls[1].url, "https://res.services.ai.azure.com/providers/microsoft/v1/systemone");
  assert.equal(calls[1].init.headers["api-key"], "k2");
  assert.equal(JSON.parse(calls[1].init.body).model, "my-decision");
});

test("OpenAI Decisions request and response are mapped", () => {
  const body = toOpenAIRequest("gpt-6-luna", "I was charged twice", Q);
  assert.equal(body.questions[0].type, "choice");
  assert.deepEqual(body.questions[0].choices[0], { value: "billing", description: "Charges" });
  assert.equal(body.questions[2].type, "predicate");
  const r = fromOpenAIResponse({ answers: [
    { type: "choice", name: "team", choice: "billing", confidence: 0.93, probabilities: [{ value: "billing", probability: 0.95 }, { value: "engineering", probability: 0.05 }] },
    { type: "predicate", name: "urgent", probability: 0.92 },
  ] });
  assert.equal(r.answers.team.probabilities.billing, 0.95);
  assert.equal(r.answers.urgent.probability, 0.92);
});

test("confidence formula: uniform = 0, certain = 1", () => {
  assert.equal(choiceConfidence({ a: 0.5, b: 0.5 }), 0);
  assert.equal(choiceConfidence({ a: 1, b: 0, c: 0 }), 1);
});

test("LLM baseline parser: fenced JSON ok, prose and wrong labels flagged", () => {
  assert.equal(parseLLMAnswer('```json\n{"team":"billing","severity":1,"urgent":true}\n```', Q).parseError, false);
  assert.equal(parseLLMAnswer("Sure! The team is billing.", Q).parseError, true);
  assert.equal(parseLLMAnswer('{"team":"Billing team","severity":1,"urgent":true}', Q).parseError, true);
});
