import { test } from "node:test";
import assert from "node:assert/strict";
import { mockDecisionProvider } from "../src/providers/mock.js";
import { scenarios } from "../src/scenarios.js";

const provider = mockDecisionProvider({ MOCK_DECISION_MS: 0 });

for (const s of [scenarios.triage, scenarios.gate, scenarios.route]) {
  test(`mock mode runs the ${s.key} scenario end to end`, async () => {
    for (const it of s.items()) {
      const r = await provider.decide(it.text, s.questions(it));
      assert.ok(s.check(it, r.answers, s.policy(r.answers)), `${s.key} ${it.id} -> ${s.policy(r.answers)}`);
    }
  });
}

test("mock mode ranks the real fix with a regression test first", async () => {
  const s = scenarios.rank;
  const items = s.items();
  const res = await Promise.all(items.map((it) => provider.decide(it.text, s.questions(it))));
  const best = items.map((it, i) => ({ id: it.id, c: s.composite(res[i].answers) })).sort((a, b) => b.c - a.c)[0];
  assert.equal(best.id, items[0].expect);
});

test("probabilities of a choice sum to ~1", async () => {
  const s = scenarios.triage;
  const it = s.items()[0];
  const r = await provider.decide(it.text, s.questions(it));
  const sum = Object.values(r.answers.kind.probabilities).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 1) < 0.01);
});
