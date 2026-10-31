# Decision models demo

Small, runnable demo of decision models next to a regular LLM, on four everyday coding-agent decisions. Live web demo: https://delightful-island-0738f7203.3.azurestaticapps.net

A *decision model* doesn't write text. You send it **state** (text or JSON) and **typed questions** (pick one option, place on a scale, yes/no), and it returns a **probability for every option** in one pass. TypeSafe's Jev and Microsoft-Decision-1 are two examples. This repo uses them in four everyday coding-agent decisions and compares them, live, with asking a regular LLM (GPT-6 Luna) for JSON.

- **Vendor-agnostic:** one adapter layer. TypeSafe Jev, Microsoft-Decision-1 (Microsoft Foundry) and the OpenAI Decisions API are supported. Your scenario code never changes.
- **Runs with no keys:** `npm run demo` has an offline mock mode for the decision model, so you can try the pipeline on a plane. The comparison with an LLM is always live: it never simulates.
- **Zero dependencies:** Node.js 20+ only. No bash scripts. The same commands work on Windows, macOS and Linux.

## Quick start (no keys needed)

You need [Node.js 20 or later](https://nodejs.org/). Check with `node --version`.

**Windows (PowerShell or cmd)**

```powershell
git clone https://github.com/webmaxru/decision-models-demo.git
cd decision-models-demo
npm run demo
npm test
```

**macOS / Linux (Terminal)**

```bash
git clone https://github.com/webmaxru/decision-models-demo.git
cd decision-models-demo
npm run demo
npm test
```

There is nothing to install: `npm run` just starts Node. For the real model, see [Live demo with Microsoft-Decision-1](#live-demo-with-microsoft-decision-1-azure). Run one scenario at a time with `npm run triage`, `npm run gate`, `npm run rank` or `npm run route`.

## The four scenarios

| Script | Decision | Question types | What your code does with the answer |
| --- | --- | --- | --- |
| `npm run triage` | Triage incoming GitHub issues | choice + score + yes/no in **one request** | Page a maintainer if P(needs human) ≥ 0.5, label `needs-triage` if confidence is low, otherwise label and hand to an agent |
| `npm run gate` | Gate a coding agent's next tool call | score (safe / reversible / dangerous) | `allow`, `ask` the human, or `block`, by thresholds you own |
| `npm run rank` | Rank an agent's candidate fixes | score + yes/no ("did it weaken the test?") | Composite score in code; candidates scored **in parallel** |
| `npm run route` | Route a task to a small model, a frontier model or a human | choice | Low confidence goes to a human |

`npm run compare:azure` runs triage, gate and route against both models, live: Microsoft-Decision-1 and GPT-6 Luna, on the same Foundry resource. It prints accuracy against the labels in `data/`, median latency, tokens in/out, parse errors, and whether you got probabilities to gate on. Without live models configured it tells you what to set; there is no simulated baseline.

## The idea in code

```js
import { choice, score, yesno } from "./src/questions.js";
import { decisionProvider } from "./src/providers/index.js";

const model = decisionProvider(); // mock | azure | typesafe | openai, from DECISION_PROVIDER

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

## Live demo with Microsoft-Decision-1 (Azure)

Three commands once the key is set:

```
npm run azure:check     # one small request: is the endpoint + key + deployment OK? prints measured latency
npm run demo:azure      # the four scenarios against the real model, latency measured on your machine
npm run compare:azure   # decision model vs GPT-6 Luna, both live
```

One scenario at a time: `npm run azure:triage`, `azure:gate`, `azure:rank`, `azure:route`.

Without a key, `demo:azure` prints a NOTE and falls back to mock mode, and `compare:azure` says what to set. Add `--strict` to fail instead.

### Measured live (2026-10-31, `compare:azure` from a GitHub runner)

| Scenario | Microsoft-Decision-1: correct, median, tokens in/out | GPT-6 Luna: correct, median, tokens in/out |
| --- | --- | --- |
| triage (8) | 8/8, 322 ms, 1,933 / 24 | 8/8, 1,234 ms, 2,813 / 168 |
| gate (7) | 7/7, 267 ms, 748 / 7 | 7/7, 1,059 ms, 1,427 / 77 |
| route (6) | 6/6, 282 ms, 640 / 6 | 6/6, 1,296 ms, 1,166 / 68 |

Both get the labels right on this small set; the decision model answers about 4× faster, with about a tenth of the output tokens, and gives a probability for every option. GPT-6 Luna ran with `reasoning_effort: none` (its fastest setting), `temperature: 0`, JSON mode and at most 300 output tokens. Latency is from a GitHub-hosted runner to the Azure resource; your machine will differ, so run `npm run azure:check` there. The data set is small and was written for this demo: it shows the mechanics, it isn't a benchmark.

### 1. Find the key and deployment name

In the [Foundry portal](https://ai.azure.com), open your Microsoft-Decision-1 deployment. Its details page shows the endpoint, the **deployment name** and the **API key** (Microsoft's docs: "On the deployment details page, copy the resource endpoint, deployment name, and API key"). The same keys are in the Azure portal: your Foundry resource, then **Resource Management > Keys and Endpoint** (KEY 1 or KEY 2). Or with the Azure CLI:

```
az cognitiveservices account keys list --name <resource-name> --resource-group <resource-group>
```

The deployment name defaults to `Microsoft-Decision-1` here. If you named your deployment differently, set `AZURE_DECISION_DEPLOYMENT`. A 404 `DeploymentNotFound` (or 422) means this name is wrong; `npm run azure:check` then tries to list the deployment names it can see.

### 2. Set it locally (never commit it)

| Variable | Value |
| --- | --- |
| `AZURE_DECISION_ENDPOINT` | `https://proj-middagskos-resource.services.ai.azure.com/providers/microsoft/v1/systemone` (the resource URL without the path also works) |
| `AZURE_DECISION_KEY` | your key (sent as the `api-key` header) |
| `AZURE_DECISION_DEPLOYMENT` | `dep-decision-1` (this demo's deployment; default if unset: `Microsoft-Decision-1`) |
| `AZURE_DECISION_TOKEN` | optional instead of the key: a Microsoft Entra ID token, sent as `Authorization: Bearer` |
| `AZURE_LLM_DEPLOYMENT` | the regular LLM for the comparison: `dep-gpt-6-luna` (default). Same resource and key; `AZURE_LLM_ENDPOINT` / `AZURE_LLM_KEY` only if it lives elsewhere |
| `LLM_MAX_OUTPUT_TOKENS` | cap on the LLM's output tokens per call, default 300 |

Option A, a `.env` file (git-ignored, read automatically):

- PowerShell: `Copy-Item .env.example .env`, then `notepad .env`
- cmd: `copy .env.example .env`, then `notepad .env`
- macOS / Linux: `cp .env.example .env`, then edit it

Option B, the current terminal only:

**Windows PowerShell**

```powershell
$env:AZURE_DECISION_ENDPOINT = "https://proj-middagskos-resource.services.ai.azure.com/providers/microsoft/v1/systemone"
$env:AZURE_DECISION_DEPLOYMENT = "dep-decision-1"
$env:AZURE_DECISION_KEY = "<paste-key>"
npm run azure:check
npm run demo:azure
```

**Windows cmd** (no quotes around values)

```bat
set AZURE_DECISION_ENDPOINT=https://proj-middagskos-resource.services.ai.azure.com/providers/microsoft/v1/systemone
set AZURE_DECISION_DEPLOYMENT=dep-decision-1
set AZURE_DECISION_KEY=<paste-key>
npm run azure:check
npm run demo:azure
```

**macOS / Linux**

```bash
export AZURE_DECISION_ENDPOINT="https://proj-middagskos-resource.services.ai.azure.com/providers/microsoft/v1/systemone"
export AZURE_DECISION_DEPLOYMENT="dep-decision-1"
read -rs AZURE_DECISION_KEY && export AZURE_DECISION_KEY   # paste, Enter (not shown, not in history)
npm run azure:check
npm run demo:azure
```

The demo never prints the key. Error messages carry a hint (401 = key, 404 DeploymentNotFound or 422 = deployment name, other 404 = endpoint, 429 = rate limit, retried twice).

Microsoft Entra ID instead of a key: `az login`, then set `AZURE_DECISION_TOKEN` to the output of `az account get-access-token --resource https://cognitiveservices.azure.com --query accessToken --output tsv`.

### 3. Or run it in GitHub Actions

The **live-azure** workflow (`.github/workflows/live-azure.yml`) runs the demo against Azure from GitHub and puts the output in the run's summary.

1. Repo **Settings > Secrets and variables > Actions > Secrets > New repository secret**, name `AZURE_DECISION_KEY`, value = your key. (CLI: `gh secret set AZURE_DECISION_KEY --repo webmaxru/decision-models-demo` prompts for it.)
2. The repo variables `AZURE_DECISION_ENDPOINT` and `AZURE_DECISION_DEPLOYMENT` (`dep-decision-1`) are already set (Variables tab). `compare` uses `AZURE_LLM_DEPLOYMENT` if you set it, else `dep-gpt-6-luna`.
3. **Actions > live-azure > Run workflow**, pick a scenario (`all`, `triage`, `gate`, `rank`, `route`, `compare`).

It runs only when you start it, fails with "add AZURE_DECISION_KEY secret" if the secret is missing, and GitHub masks the key in logs. Latency from a GitHub runner (US datacenter) is not the latency from your laptop; measure on the machine you present from.

## Web demo (Azure Static Web Apps, Free plan)

Live: https://delightful-island-0738f7203.3.azurestaticapps.net

The four use cases as a race: press **Run live** and both models answer every item at the same time, item by item, with live clocks, per-item latency bars, correctness badges, the decision model's probabilities, tokens in/out and a summary across all four use cases. Each use case has an expandable panel with the real request and response JSON of both models. The page is static (`web/`), and the key stays in a managed Azure Functions API (`api/`).

- **Only the fixed scenarios** can run: no free text reaches either model.
- **Limits** (app settings): `DEMO_RATE_PER_MIN` live runs per minute per visitor (default 10) and `DEMO_DAILY_CALL_CAP` model calls per day (default 500), counted across **both** models. A run of the triage use case is 16 calls (8 items × 2 models). The LLM's output is capped at 300 tokens per call.
- **No simulation:** before you run anything, and when the limits are reached, the page shows `web/recorded.json`, a real run recorded from the live site with `node scripts/record.mjs <site-url>`, labelled with its date.
- Locally: `npm run web`, then open http://localhost:4280 (uses your `AZURE_*` variables).
- **Deploys on every push to `main`** that touches `web/`, `api/`, `src/` or `data/` (`.github/workflows/azure-static-web-apps.yml`: build, tests, deploy, then a smoke test of `/api/health`). It needs the `AZURE_STATIC_WEB_APPS_API_TOKEN` secret, which `infra/deploy.ps1` sets.

### Deploy to Azure with one command

Needs the Azure CLI (`az login`), the GitHub CLI (`gh auth login`) and Contributor on the resource group `rg-middagskos`. From the repo folder:

```powershell
pwsh ./infra/deploy.ps1 -BudgetEmail you@example.com
# Windows PowerShell 5.1:
powershell -ExecutionPolicy Bypass -File .\infra\deploy.ps1 -BudgetEmail you@example.com
```

It creates the Static Web App `swa-decision-demo` (Free plan, West Europe) in `rg-middagskos`, sets the API's app settings (the model key is read by Azure from `proj-middagskos-resource`, never shown; both deployments, `dep-decision-1` and `dep-gpt-6-luna`), adds a 5/month budget alert, puts the deployment token into this repo's secrets, runs the deploy and prints the URL. Safe to re-run. Cost: the Static Web App is free; you pay only for model calls (Microsoft-Decision-1: $0.042 per million input tokens, output free, per Microsoft's launch post; GPT-6 Luna: see Azure OpenAI pricing), capped by the API's limits. Remove it with `pwsh ./infra/teardown.ps1`. Details: [infra/README.md](infra/README.md).

## Other providers

Set `DECISION_PROVIDER` in `.env` or your shell (or pass `--provider <name>` to `demo` / `compare`) and fill in that provider's variables:

| `DECISION_PROVIDER` | Model | Variables | Endpoint used |
| --- | --- | --- | --- |
| `mock` (default) | offline keyword stand-in | none | none |
| `typesafe` | TypeSafe **Jev** | `TYPESAFE_API_KEY`, optional `TYPESAFE_MODEL` (default `jev-latest`) | `POST https://api.typesafe.ai/v1/systemone` |
| `azure` (or `foundry`) | **Microsoft-Decision-1** in Microsoft Foundry | `AZURE_DECISION_ENDPOINT`, `AZURE_DECISION_KEY`, optional `AZURE_DECISION_DEPLOYMENT` (default `Microsoft-Decision-1`). The v1 names `AZURE_ENDPOINT` / `AZURE_API_KEY` / `AZURE_DEPLOYMENT` still work | `POST {endpoint}/providers/microsoft/v1/systemone` |
| `openai` | OpenAI Decisions API | `OPENAI_API_KEY`, optional `OPENAI_DECISIONS_MODEL` (default `gpt-6-luna`) | `POST https://api.openai.com/v1/decisions` |

The regular LLM defaults to GPT-6 Luna on the same Azure resource (`AZURE_LLM_DEPLOYMENT`, default `dep-gpt-6-luna`, called at `{resource}/openai/v1/chat/completions` with the same key). Any other OpenAI-compatible `/chat/completions` endpoint works too (OpenAI, OpenRouter, Ollama, LM Studio): set `LLM_BASE_URL` (for example `https://openrouter.ai/api/v1`), `LLM_API_KEY` and `LLM_MODEL` (`LLM_AUTH=api-key` sends the key as an `api-key` header). If a model refuses a parameter (`temperature`, `reasoning_effort`), the adapter drops it and retries once.

Then run `npm run demo` or `npm run compare` again.

### One request shape, several vendors

TypeSafe's `/v1/systemone` request (`state` plus named `questions` of type `choice`, `score` or `noul`) is also the shape Microsoft Foundry uses for Microsoft-Decision-1. That is why `src/providers/systemone.js` serves both, with only the URL and the auth header changed. OpenAI's Decisions API uses different field names (`input`, `predicate`, `choices`, `levels`, answers as an array), and `src/providers/openai-decisions.js` maps them onto the same answers. Adding a vendor means writing one file.

## Honest notes

- **Mock mode is not a model.** It scores options by keyword overlap so the pipeline runs offline. The mock data is written so the keywords work. Real accuracy comes only from a real provider on your own labelled examples.
- **No simulated comparison.** The LLM side always calls a real model. Offline mock mode exists only for the decision model in `npm run demo` (latency there is a sleep, `MOCK_DECISION_MS`, and the output says MOCK MODE).
- **Vendor numbers are vendor numbers.** Microsoft's and TypeSafe's speed and cost claims come from their own benchmarks. Artificial Analysis found that decision models trail LLMs on knowledge questions and are overconfident there, while doing well on classification and tool-calling decisions. Validate thresholds on your data before you automate a gate.
- **Live latency is measured, mock latency is not.** Every run prints which one you are looking at (`LIVE` or `MOCK MODE`), and `demo:azure` ends with median / p95 / first-call latency measured with `performance.now()` around each request. The first call includes TLS and connection setup.
- API shapes are taken from the vendors' docs as of 2026-10-31. The unit tests check the request mapping against those documented examples and use a fake server; they don't call live endpoints. Run `npm run azure:check` for the real thing.

## Project layout

```
bin/demo.js                     run the scenarios
bin/compare.js                  decision model vs regular LLM, both live
bin/check.js                    azure:check preflight (one live request)
src/timing.js                   measured latency + LIVE / MOCK banner
DEMO-SCRIPT.md                  a short script for presenting the demo
.github/workflows/live-azure.yml  run the live demo from GitHub Actions
.github/workflows/azure-static-web-apps.yml  deploy the web demo
.github/workflows/infra.yml     validate infra/ (Bicep build, PowerShell parse)
infra/                          one-command Azure deploy: deploy.ps1, teardown.ps1, main.bicep
web/                            web demo page (static, no build)
api/                            managed Azure Functions API for the web demo
bin/serve-web.js                npm run web: the web demo locally
scripts/build-api.mjs           npm run build:api: refresh api/lib and web/scenarios.json
scripts/record.mjs              record a real run from the site into web/recorded.json
src/questions.js                choice / score / yesno + confidence
src/scenarios.js                the four decisions and the policies that act on them
src/providers/systemone.js      TypeSafe Jev + Microsoft Foundry (same wire format)
src/providers/openai-decisions.js
src/providers/llm-baseline.js   the regular LLM (GPT-6 Luna by default): chat completions + JSON parsing
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
