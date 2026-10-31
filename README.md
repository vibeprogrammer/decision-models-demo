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

There is nothing to install: `npm run` just starts Node. For the real model, see [Live demo with Microsoft-Decision-1](#live-demo-with-microsoft-decision-1-azure). Run one scenario at a time with `npm run triage`, `npm run gate`, `npm run rank` or `npm run route`.

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
npm run compare:azure   # decision model (live) vs the LLM baseline
```

One scenario at a time: `npm run azure:triage`, `azure:gate`, `azure:rank`, `azure:route`.

Without a key, `demo:azure` and `compare:azure` print a NOTE and fall back to mock mode, so nothing breaks on stage. Add `--strict` to fail instead.

### Measured live (2026-10-31, from a GitHub runner)

`live-azure` on deployment `dep-decision-1`: all 21 labelled items correct (triage 8/8, gate 7/7, route 6/6) and the test-deleting fix ranked last. Median latency per request 218 to 287 ms by scenario, first call about 1.1 s (connection setup). That's from a GitHub-hosted runner in the US to the Azure resource; your laptop on conference Wi-Fi will differ, so run `npm run azure:check` there. The data set is small and was written for this demo: it shows the mechanics, it isn't a benchmark.

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

1. Repo **Settings > Secrets and variables > Actions > Secrets > New repository secret**, name `AZURE_DECISION_KEY`, value = your key. (CLI: `gh secret set AZURE_DECISION_KEY --repo vibeprogrammer/decision-models-demo` prompts for it.)
2. The repo variables `AZURE_DECISION_ENDPOINT` and `AZURE_DECISION_DEPLOYMENT` (`dep-decision-1`) are already set (Variables tab).
3. **Actions > live-azure > Run workflow**, pick a scenario (`all`, `triage`, `gate`, `rank`, `route`, `compare`).

It runs only when you start it, fails with "add AZURE_DECISION_KEY secret" if the secret is missing, and GitHub masks the key in logs. Latency from a GitHub runner (US datacenter) is not the latency from your laptop on stage; measure on the machine you present from.

## Web demo (Azure Static Web Apps, Free plan)

The same four scenarios as a web page with a **Run live** button, probability bars and measured latency. The page is static (`web/`), and the key stays in a managed Azure Functions API (`api/`). Only the fixed scenarios can run, it is rate-limited, and it falls back to labelled mock output when throttled or not configured.

- Locally: `npm run web`, then open http://localhost:4280 (uses your `AZURE_DECISION_*` variables, mock without them).
- On Azure: one command, below. (Manual portal steps are in [web/README.md](web/README.md).) Deploys with `.github/workflows/azure-static-web-apps.yml`, which stays green and skips until the `AZURE_STATIC_WEB_APPS_API_TOKEN` secret exists.

### Deploy to Azure with one command

Needs the Azure CLI (`az login`), the GitHub CLI (`gh auth login`) and Contributor on the resource group `rg-middagskos`. From the repo folder:

```powershell
pwsh ./infra/deploy.ps1 -BudgetEmail you@example.com
# Windows PowerShell 5.1:
powershell -ExecutionPolicy Bypass -File .\infra\deploy.ps1 -BudgetEmail you@example.com
```

It creates the Static Web App `swa-decision-demo` (Free plan, West Europe) in `rg-middagskos`, sets the API's app settings (the model key is read by Azure from `proj-middagskos-resource`, never shown), adds a 5/month budget alert, puts the deployment token into this repo's secrets, runs the deploy and prints the URL. Safe to re-run. Cost: the Static Web App is free; you pay only for model calls (Microsoft-Decision-1: $0.042 per million input tokens, output free, per Microsoft's launch post), capped by the API's limits. Remove it with `pwsh ./infra/teardown.ps1`. Details: [infra/README.md](infra/README.md).

## Other providers

Set `DECISION_PROVIDER` in `.env` or your shell (or pass `--provider <name>` to `demo` / `compare`) and fill in that provider's variables:

| `DECISION_PROVIDER` | Model | Variables | Endpoint used |
| --- | --- | --- | --- |
| `mock` (default) | offline keyword stand-in | none | none |
| `typesafe` | TypeSafe **Jev** | `TYPESAFE_API_KEY`, optional `TYPESAFE_MODEL` (default `jev-latest`) | `POST https://api.typesafe.ai/v1/systemone` |
| `azure` (or `foundry`) | **Microsoft-Decision-1** in Microsoft Foundry | `AZURE_DECISION_ENDPOINT`, `AZURE_DECISION_KEY`, optional `AZURE_DECISION_DEPLOYMENT` (default `Microsoft-Decision-1`). The v1 names `AZURE_ENDPOINT` / `AZURE_API_KEY` / `AZURE_DEPLOYMENT` still work | `POST {endpoint}/providers/microsoft/v1/systemone` |
| `openai` | OpenAI Decisions API | `OPENAI_API_KEY`, optional `OPENAI_DECISIONS_MODEL` (default `gpt-6-luna`) | `POST https://api.openai.com/v1/decisions` |

The LLM baseline works with any OpenAI-compatible `/chat/completions` endpoint (OpenAI, OpenRouter, Azure OpenAI, Ollama, LM Studio). Set `LLM_BASE_URL` (for example `https://openrouter.ai/api/v1`), `LLM_API_KEY` and `LLM_MODEL`. For a chat model deployed on the same Azure resource, use `LLM_BASE_URL=https://<resource>.services.ai.azure.com/openai/v1`, `LLM_MODEL=<chat deployment name>` and `LLM_AUTH=api-key` (sends the key as an `api-key` header). Leave `LLM_BASE_URL` empty for the simulated baseline.

Then run `npm run demo` or `npm run compare` again.

### One request shape, several vendors

TypeSafe's `/v1/systemone` request (`state` plus named `questions` of type `choice`, `score` or `noul`) is also the shape Microsoft Foundry uses for Microsoft-Decision-1. That is why `src/providers/systemone.js` serves both, with only the URL and the auth header changed. OpenAI's Decisions API uses different field names (`input`, `predicate`, `choices`, `levels`, answers as an array), and `src/providers/openai-decisions.js` maps them onto the same answers. Adding a vendor means writing one file.

## Honest notes

- **Mock mode is not a model.** It scores options by keyword overlap so the pipeline runs offline. The mock data is written so the keywords work. Real accuracy comes only from a real provider on your own labelled examples.
- **Mock latency is simulated** with a sleep: 130 ms for the decision model and 1400 ms for the LLM. These are the median time-per-task figures Artificial Analysis published on 2026-10-13 for Jev 1.13 and Claude Haiku 5.5 (Low). Change them with `MOCK_DECISION_MS` and `MOCK_LLM_MS`. With real providers configured, `compare` measures real wall-clock time from your machine.
- **Vendor numbers are vendor numbers.** Microsoft's and TypeSafe's speed and cost claims come from their own benchmarks. Artificial Analysis found that decision models trail LLMs on knowledge questions and are overconfident there, while doing well on classification and tool-calling decisions. Validate thresholds on your data before you automate a gate.
- **Live latency is measured, mock latency is not.** Every run prints which one you are looking at (`LIVE` or `MOCK MODE`), and `demo:azure` ends with median / p95 / first-call latency measured with `performance.now()` around each request. The first call includes TLS and connection setup.
- API shapes are taken from the vendors' docs as of 2026-10-31. The unit tests check the request mapping against those documented examples and use a fake server; they don't call live endpoints. Run `npm run azure:check` for the real thing.

## Project layout

```
bin/demo.js                     run the scenarios
bin/compare.js                  decision model vs generative LLM
bin/check.js                    azure:check preflight (one live request)
src/timing.js                   measured latency + LIVE / MOCK banner
DEMO-SCRIPT.md                  what to type and say on stage
.github/workflows/live-azure.yml  run the live demo from GitHub Actions
.github/workflows/azure-static-web-apps.yml  deploy the web demo
.github/workflows/infra.yml     validate infra/ (Bicep build, PowerShell parse)
infra/                          one-command Azure deploy: deploy.ps1, teardown.ps1, main.bicep
web/                            web demo page (static, no build)
api/                            managed Azure Functions API for the web demo
bin/serve-web.js                npm run web: the web demo locally
scripts/build-api.mjs           npm run build:api: refresh api/lib and web/fallback.json
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
