# Web demo on Azure Static Web Apps (Free plan)

A one-page version of the demo: pick a scenario, press **Run live**, see each decision's probabilities and the measured latency. It runs on Azure Static Web Apps **Free** with its **managed** Azure Functions API, so there is no separate Function App and no hosting bill. The only thing that costs money is calls to the model, and those are capped (below).

```
web/   static page (index.html, app.js, style.css), no build step
api/   managed Functions API (Node 22, v4 model): POST /api/decide, GET /api/health
       api/lib/ is a generated copy of src/ and data/ (npm run build:api)
```

- The key stays server-side in an app setting. The browser only ever calls `/api/decide` with a scenario name.
- Only the four fixed scenarios run. No free text reaches the model, so the API can't be used as a free model proxy. Bodies over 512 bytes are rejected.
- Throttling: 10 live runs per minute per IP (`DEMO_RATE_PER_MIN`) and 500 model calls per day (`DEMO_DAILY_CALL_CAP`). A triage run is 8 calls, gate 7, rank 4, route 6. Over the limit the API returns 429 and the page shows mock output instead.
- Honest limit: these counters are in-memory per function instance. A restart resets them, and if Azure runs several instances each counts on its own. The hard ceiling is the model deployment's own rate limit plus the budget alert below.
- No key, throttled or model down: the page shows mock output from `web/fallback.json`, clearly labelled MOCK, with no latency numbers.

Try it locally first (no Azure needed): `npm run web`, then open http://localhost:4280. It uses the same `AZURE_DECISION_*` variables as the CLI demo, and mock output without them.

## Set it up (one time, about 10 minutes)

Do this in the Azure portal, signed in to the subscription that has the Foundry resource **proj-middagskos-resource**.

1. **Create the Static Web App.** Portal: **Create a resource > Static Web App**.
   - Resource group: the one that holds proj-middagskos-resource (then one budget covers both)
   - Name: e.g. `decision-models-demo`
   - Plan type: **Free**
   - Region (for the API): **West Europe**
   - Deployment source: **Other** (our GitHub workflow deploys; don't let the portal create its own workflow)
   - **Review + create > Create**
2. **Copy the deployment token.** Open the new Static Web App > **Overview > Manage deployment token** > copy.
3. **Give it to GitHub.** GitHub repo **Settings > Secrets and variables > Actions > New repository secret**: name `AZURE_STATIC_WEB_APPS_API_TOKEN`, value = the token.
4. **Give the API the model settings.** Static Web App > **Settings > Environment variables** > Production > **+ Add**, three times:
   - `AZURE_DECISION_ENDPOINT` = `https://proj-middagskos-resource.services.ai.azure.com/providers/microsoft/v1/systemone`
   - `AZURE_DECISION_DEPLOYMENT` = `dep-decision-1`
   - `AZURE_DECISION_KEY` = your key (the same one as the GitHub secret)
   - **Apply**.
5. **Deploy.** GitHub **Actions > azure-static-web-apps > Run workflow** (it also runs on every push to main that touches the web demo). The run summary shows the site URL and the `/api/health` answer; `"live": true` means the key is in place.
6. **Budget alert.** Portal: **Cost Management > Budgets > + Add**. Scope: the resource group from step 1. Amount: e.g. 5 (your currency) per month. Alert conditions: 50 % and 100 % actual, to your email. Optional hard ceiling: lower the rate limit (tokens per minute) on the dep-decision-1 deployment in the Foundry portal.

### The same with the Azure CLI (PowerShell)

```powershell
az login
$rg = "<resource-group-of-proj-middagskos-resource>"
az staticwebapp create --name decision-models-demo --resource-group $rg --location westeurope --sku Free

# deployment token straight into the GitHub secret (never shown on screen; needs the GitHub CLI)
az staticwebapp secrets list --name decision-models-demo --resource-group $rg --query "properties.apiKey" -o tsv | gh secret set AZURE_STATIC_WEB_APPS_API_TOKEN --repo vibeprogrammer/decision-models-demo

# model settings; the key is read from Azure, not typed
$key = az cognitiveservices account keys list --name proj-middagskos-resource --resource-group $rg --query key1 -o tsv
az staticwebapp appsettings set --name decision-models-demo --resource-group $rg --setting-names "AZURE_DECISION_ENDPOINT=https://proj-middagskos-resource.services.ai.azure.com/providers/microsoft/v1/systemone" "AZURE_DECISION_DEPLOYMENT=dep-decision-1" "AZURE_DECISION_KEY=$key"
Remove-Variable key

gh workflow run azure-static-web-apps.yml --repo vibeprogrammer/decision-models-demo
```

Without `--source`, `az staticwebapp create` makes the app without linking a repo, which is what we want (the token-based workflow deploys).

## Sources (checked 2026-10-31)

- Plans (Free: managed Functions API, no SLA): https://learn.microsoft.com/azure/static-web-apps/plans
- Quotas (Free: 100 GB bandwidth/month included, no overage billing): https://learn.microsoft.com/azure/static-web-apps/quotas
- API with Azure Functions (managed = HTTP triggers only, Consumption): https://learn.microsoft.com/azure/static-web-apps/apis-functions
- `apiRuntime` values (`node:22` supported): https://learn.microsoft.com/azure/static-web-apps/configuration
- Environment variables / app settings: https://learn.microsoft.com/azure/static-web-apps/application-settings
- `az staticwebapp`: https://learn.microsoft.com/cli/azure/staticwebapp
