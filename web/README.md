# Web demo on Azure Static Web Apps (Free plan)

A one-page race between the decision model and a regular LLM: pick a use case, press **Run live**, and both models answer every item side by side with live clocks, latency bars, correctness badges, probabilities, tokens, and the real request/response JSON. It runs on Azure Static Web Apps **Free** with its **managed** Azure Functions API, so there is no separate Function App and no hosting bill. The only thing that costs money is calls to the models, and those are capped (below).

```
web/   static page (index.html, app.js, style.css), no build step
api/   managed Functions API (Node 22, v4 model): POST /api/run, POST /api/decide, GET /api/health
       api/lib/ is a generated copy of src/ and data/ (npm run build:api)
```

- The key stays server-side in an app setting. The browser calls `/api/run` with a use-case name, then `/api/decide` with the signed run token, a lane (`decision` or `llm`) and an item number. Each lane/item answers once per run; a run expires after 3 minutes.
- Only the four fixed scenarios run. No free text reaches either model, so the API can't be used as a free model proxy. Bodies over 512 bytes are rejected.
- Throttling: 10 live runs per minute per IP (`DEMO_RATE_PER_MIN`) and 500 model calls per day across both models (`DEMO_DAILY_CALL_CAP`). A run reserves all its calls up front: triage 16 (8 items × 2 models), gate 14, rank 8, route 12. Over the limit `/api/run` returns 429 before any model is called, and the page keeps the recorded run. The LLM's output is capped at 300 tokens per call (`LLM_MAX_OUTPUT_TOKENS`).
- Honest limit: these counters are in-memory per function instance. A restart resets them, and if Azure runs several instances each counts on its own. The hard ceiling is the model deployment's own rate limit plus the budget alert below.
- No simulation: before a run, and when the models are throttled or not configured, the page shows `web/recorded.json`, a real run recorded from the live site (`node scripts/record.mjs <site-url>`, 50 model calls), labelled with its date.

Try it locally first (no Azure needed): `npm run web`, then open http://localhost:4280. It uses the same `AZURE_*` variables as the CLI demo; without them it shows the recorded run.

## Set it up with one command (recommended)

```powershell
pwsh ./infra/deploy.ps1 -BudgetEmail you@example.com
```

That does all the steps below for you (Static Web App on the Free plan in `rg-middagskos`, app settings with the key read inside Azure, budget, GitHub token secret, deploy, health check). See [infra/README.md](../infra/README.md). The manual route follows, in case you prefer the portal.

## Set it up by hand (one time, about 10 minutes)

Do this in the Azure portal, signed in to the subscription that has the Foundry resource **proj-middagskos-resource**.

1. **Create the Static Web App.** Portal: **Create a resource > Static Web App**.
   - Resource group: `rg-middagskos` (it holds proj-middagskos-resource, so one budget covers both)
   - Name: `swa-decision-demo` (the name infra/teardown.ps1 expects)
   - Plan type: **Free**
   - Region (for the API): **West Europe**
   - Deployment source: **Other** (our GitHub workflow deploys; don't let the portal create its own workflow)
   - **Review + create > Create**
2. **Copy the deployment token.** Open the new Static Web App > **Overview > Manage deployment token** > copy.
3. **Give it to GitHub.** GitHub repo **Settings > Secrets and variables > Actions > New repository secret**: name `AZURE_STATIC_WEB_APPS_API_TOKEN`, value = the token.
4. **Give the API the model settings.** Static Web App > **Settings > Environment variables** > Production > **+ Add**:
   - `AZURE_DECISION_ENDPOINT` = `https://proj-middagskos-resource.services.ai.azure.com/providers/microsoft/v1/systemone`
   - `AZURE_DECISION_DEPLOYMENT` = `dep-decision-1`
   - `AZURE_DECISION_KEY` = your key (the same one as the GitHub secret)
   - optional `AZURE_LLM_DEPLOYMENT` = `dep-gpt-6-luna` (that is the default; same resource and key)
   - **Apply**.
5. **Deploy.** Every push to `main` that touches `web/`, `api/`, `src/` or `data/` builds, tests and deploys. To deploy by hand: GitHub **Actions > azure-static-web-apps > Run workflow**. The run summary shows the site URL and the `/api/health` answer; `"live": true` means the key is in place.
6. **Budget alert.** Portal: **Cost Management > Budgets > + Add**. Scope: the resource group from step 1. Amount: e.g. 5 (your currency) per month. Alert conditions: 50 % and 100 % actual, to your email. Optional hard ceiling: lower the rate limit (tokens per minute) on the dep-decision-1 and dep-gpt-6-luna deployments in the Foundry portal.

### The same with the Azure CLI (PowerShell)

```powershell
az login
$rg = "rg-middagskos"
az staticwebapp create --name swa-decision-demo --resource-group $rg --location westeurope --sku Free

# deployment token straight into the GitHub secret (never shown on screen; needs the GitHub CLI)
az staticwebapp secrets list --name swa-decision-demo --resource-group $rg --query "properties.apiKey" -o tsv | gh secret set AZURE_STATIC_WEB_APPS_API_TOKEN --repo webmaxru/decision-models-demo

# model settings; the key is read from Azure, not typed
$key = az cognitiveservices account keys list --name proj-middagskos-resource --resource-group $rg --query key1 -o tsv
az staticwebapp appsettings set --name swa-decision-demo --resource-group $rg --setting-names "AZURE_DECISION_ENDPOINT=https://proj-middagskos-resource.services.ai.azure.com/providers/microsoft/v1/systemone" "AZURE_DECISION_DEPLOYMENT=dep-decision-1" "AZURE_DECISION_KEY=$key" "AZURE_LLM_DEPLOYMENT=dep-gpt-6-luna"
Remove-Variable key

gh workflow run azure-static-web-apps.yml --repo webmaxru/decision-models-demo
```

Without `--source`, `az staticwebapp create` makes the app without linking a repo, which is what we want (the token-based workflow deploys).

## Sources (checked 2026-10-31)

- Plans (Free: managed Functions API, no SLA): https://learn.microsoft.com/azure/static-web-apps/plans
- Quotas (Free: 100 GB bandwidth/month included, no overage billing): https://learn.microsoft.com/azure/static-web-apps/quotas
- API with Azure Functions (managed = HTTP triggers only, Consumption): https://learn.microsoft.com/azure/static-web-apps/apis-functions
- `apiRuntime` values (`node:22` supported): https://learn.microsoft.com/azure/static-web-apps/configuration
- Environment variables / app settings: https://learn.microsoft.com/azure/static-web-apps/application-settings
- `az staticwebapp`: https://learn.microsoft.com/cli/azure/staticwebapp
