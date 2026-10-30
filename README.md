# Decision models demo

Small, runnable demo for Maxim Salnikov's lightning talk on decision models at AI Coding Summit Berlin (December 2026).

A *decision model* doesn't write text. You send it **state** (text or JSON) and **typed questions** (pick one option, place on a scale, yes/no), and it returns a **probability for every option** in one pass. TypeSafe's Jev and Microsoft-Decision-1 are two examples. This repo uses them in four everyday coding-agent decisions and compares them with asking a generative LLM for JSON.

- **Vendor-agnostic:** one adapter layer. TypeSafe Jev, Microsoft-Decision-1 (Microsoft Foundry) and the OpenAI Decisions API are supported. Your scenario code never changes.
- **Runs with no keys:** mock mode works offline, so you can try it on a plane.
- **Zero dependencies:** Node.js 20+ only. No bash scripts. The same commands work on Windows, macOS and Linux.

## Quick start (no keys needed)

You need [Node.js 20 or later](https://nodejs.org/). Check with `node --version`.

**Windows (PowerShell or cmd)**

```powershell
git clone https://github.com/vibeprogrammer/decision-models-demo.git
cd decision-models-demo
npm run demo
npm run compare
npm test
```

**macOS / Linux (Terminal)**

```bash
git clone https://github.com/vibeprogrammer/decision-models-demo.git
cd decision-models-demo
npm run demo
npm run compare
npm test
```

There is nothing to install: `npm run` just starts Node. Run one scenario at a time with `npm run triage`, `npm run gate`, `npm run rank` or `npm run route`.

## The four scenarios

| Script | Decision | Question types | What your code does with the answer |
| --- | --- | --- | --- |
| `npm run triage` | Triage incoming GitHub issues | choice + score + yes/no in **one request** | Page a maintainer if P(needs human) ≥ 0.5, label `needs-triage` if confidence is low, otherwise label and hand to an agent |
| `npm run gate` | Gate a coding agent's next tool call | score (safe / reversible / dangerous) | `allow`, `ask` the human, or `block`, by thresholds you own |
| `npm run rank` | Rank an agent's candidate fixes | score + yes/no ("did it weaken the test?") | Composite score in code; candidates scored **in parallel** |
| `npm run route` | Route a task to a small model, a frontier model or a human | choice | Low confidence goes to a human |

`npm run compare` runs triage, gate and route against both a decision model and a generative LLM baseline. It prints accuracy against the labels in `data/`, median latency, parse errors, and whether you got probabilities to gate on.

## The idea in code

```js
import { choice, score, yesno } from "./src/questions.js";
import { decisionProvider } from "./src/providers/index.js";

const model = decisionProvider(); // mock | typesafe | foundry | openai, from DECISION_PROVIDER

const { answers } = await model.decide(issueText, {
  kind: choice("What kind of issue is this?", { bug: "...", feature: "...", security: "..." }),
  severity: score("How severe is it?", ["Cosmetic", "Minor", "Major", "Critical"]),
  needs_human: yesno("Must a maintainer look at this first?"),
});

if (answers.needs_human.probability >= 0.5) pageMaintainer();
else if (answers.kind.confidence < 0.5) label("needs-triage");
else label(answers.kind.choice);
```

The model decides. Your code keeps control: thresholds, fallbacks and the final action stay in code you can test.

## Use a real decision model

Copy `.env.example` to `.env` and fill in one provider. You can also set the same variables in your shell.

- Windows PowerShell: `Copy-Item .env.example .env`
- Windows cmd: `copy .env.example .env`
- macOS / Linux: `cp .env.example .env`

| `DECISION_PROVIDER` | Model | Variables | Endpoint used |
| --- | --- | --- | --- |
| `mock` (default) | offline keyword stand-in | none | none |
| `typesafe` | TypeSafe **Jev** | `TYPESAFE_API_KEY`, optional `TYPESAFE_MODEL` (default `jev-latest`) | `POST https://api.typesafe.ai/v1/systemone` |
| `foundry` | **Microsoft-Decision-1** in Microsoft Foundry | `AZURE_ENDPOINT`, `AZURE_API_KEY`, `AZURE_DEPLOYMENT` (your deployment name) | `POST {AZURE_ENDPOINT}/providers/microsoft/v1/systemone` |
| `openai` | OpenAI Decisions API | `OPENAI_API_KEY`, optional `OPENAI_DECISIONS_MODEL` (default `gpt-6-luna`) | `POST https://api.openai.com/v1/decisions` |

The LLM baseline works with any OpenAI-compatible `/chat/completions` endpoint (OpenAI, OpenRouter, Azure OpenAI, Ollama, LM Studio). Set `LLM_BASE_URL` (for example `https://openrouter.ai/api/v1`), `LLM_API_KEY` and `LLM_MODEL`. Leave `LLM_BASE_URL` empty for the simulated baseline.

Then run `npm run demo` or `npm run compare` again.

### One request shape, several vendors

TypeSafe's `/v1/systemone` request (`state` plus named `questions` of type `choice`, `score` or `noul`) is also the shape Microsoft Foundry uses for Microsoft-Decision-1. That is why `src/providers/systemone.js` serves both, with only the URL and the auth header changed. OpenAI's Decisions API uses different field names (`input`, `predicate`, `choices`, `levels`, answers as an array), and `src/providers/openai-decisions.js` maps them onto the same answers. Adding a vendor means writing one file.

## Honest notes

- **Mock mode is not a model.** It scores options by keyword overlap so the pipeline runs offline. The mock data is written so the keywords work. Real accuracy comes only from a real provider on your own labelled examples.
- **Mock latency is simulated** with a sleep: 130 ms for the decision model and 1400 ms for the LLM. These are the median time-per-task figures Artificial Analysis published on 2026-10-13 for Jev 1.13 and Claude Haiku 5.5 (Low). Change them with `MOCK_DECISION_MS` and `MOCK_LLM_MS`. With real providers configured, `compare` measures real wall-clock time from your machine.
- **Vendor numbers are vendor numbers.** Microsoft's and TypeSafe's speed and cost claims come from their own benchmarks. Artificial Analysis found that decision models trail LLMs on knowledge questions and are overconfident there, while doing well on classification and tool-calling decisions. Validate thresholds on your data before you automate a gate.
- API shapes are taken from the vendors' docs as of 2026-10-30. The unit tests check the request mapping against those documented examples. They don't call live endpoints.

## Project layout

```
bin/demo.js                     run the scenarios
bin/compare.js                  decision model vs generative LLM
src/questions.js                choice / score / yesno + confidence
src/scenarios.js                the four decisions and the policies that act on them
src/providers/systemone.js      TypeSafe Jev + Microsoft Foundry (same wire format)
src/providers/openai-decisions.js
src/providers/llm-baseline.js   chat-completions baseline + JSON parsing
src/providers/mock.js           offline stand-in
data/                           labelled sample issues, tool calls, fixes, tasks
test/                           node:test unit tests (npm test)
```

## Sources

- TypeSafe, "Introducing System One Models & Jev", 2026-09-15: https://typesafe.ai/blog/introducing-system-one-models-and-jev · Quick start: https://docs.typesafe.ai/introduction/quickstart
- Microsoft, "Introducing Microsoft-Decision-1", 2026-10-09: https://commandline.microsoft.com/microsoft-decision-1-model-foundry/ · Docs: https://learn.microsoft.com/en-us/azure/foundry/foundry-models/how-to/use-foundry-models-microsoft-decision
- OpenAI, Decisions API guide: https://developers.openai.com/api/docs/guides/decisions
- Artificial Analysis, "Decision Index v1.0", 2026-10-13: https://artificialanalysis.ai/articles/artificial-analysis-decision-index
- JevBench (independent leaderboard): https://github.com/fstandhartinger/jevbench

MIT licensed. By [Maxim Salnikov](https://www.linkedin.com/in/webmax/).
