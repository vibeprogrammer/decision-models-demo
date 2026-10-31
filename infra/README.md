# Infrastructure: one command to put the web demo on Azure

`infra/` deploys the web demo (`web/` + the managed Functions API in `api/`) to Azure at the lowest possible cost and wires it to your existing Microsoft-Decision-1 deployment.

| File | What it is |
| --- | --- |
| `deploy.ps1` | The one command. Windows PowerShell 5.1 and PowerShell 7+ (Windows, macOS, Linux). Safe to re-run. |
| `deploy.sh` | The same for macOS/Linux bash, if you prefer it. |
| `teardown.ps1` | Removes the Static Web App and the budget. Never the resource group or the Foundry account. |
| `main.bicep` | Static Web App (Free) + its app settings + optional budget (module). |
| `budget.bicep` | Monthly Consumption budget on the resource group with email alerts. |

## What it creates

In the existing resource group **rg-middagskos** (created only if it doesn't exist):

- **Static Web App `swa-decision-demo`, Free plan, West Europe.** Hosts the page and runs the API as managed Azure Functions, so there is no separate Function App and no hosting bill. Static Web Apps is only offered in westeurope, eastus2, centralus, westus2 and eastasia, so Norway East isn't an option; West Europe is the closest.
- **App settings on it:** `AZURE_DECISION_ENDPOINT` (`https://proj-middagskos-resource.services.ai.azure.com/providers/microsoft/v1/systemone`), `AZURE_DECISION_DEPLOYMENT` (`dep-decision-1`), `AZURE_DECISION_KEY`, plus the throttling limits `DEMO_RATE_PER_MIN` (10) and `DEMO_DAILY_CALL_CAP` (500). These are exactly the names the API reads.
- **Budget `budget-decision-demo`** (only with `-BudgetEmail`): 5 per month in your billing currency, email at 80 % of actual spend and at 100 % of forecast spend. A budget alerts; it doesn't stop anything.
- **GitHub secret `AZURE_STATIC_WEB_APPS_API_TOKEN`** on this repo (the Static Web App's deployment token), then a run of the `azure-static-web-apps` workflow, which deploys `web/` and `api/`.

The Foundry account **proj-middagskos-resource** and the deployment **dep-decision-1** are only read. The key is read by Azure itself during the deployment (`listKeys()` in `main.bicep`): it is never printed, typed, put on a command line or written to a file. The script only checks that you are allowed to read it.

## Before you start (once)

1. **Azure CLI**: `winget install -e --id Microsoft.AzureCLI` (macOS: `brew install azure-cli`), then `az login`. Bicep is installed by the script if missing.
2. **GitHub CLI**: `winget install -e --id GitHub.cli` (macOS: `brew install gh`), then `gh auth login` with an account that can manage secrets on `vibeprogrammer/decision-models-demo`. Without `gh` the script still deploys Azure and prints the two GitHub steps for you to click.
3. **Azure rights**: Contributor (or Owner) on `rg-middagskos`, which includes reading the Foundry keys. Creating the budget also needs Contributor/Owner (or Cost Management Contributor) on the resource group.
4. A clone of this repo: `git clone https://github.com/vibeprogrammer/decision-models-demo.git` and `cd decision-models-demo`.

## Deploy

**PowerShell 7 (Windows, macOS, Linux):**

```powershell
pwsh ./infra/deploy.ps1 -BudgetEmail you@example.com
```

**Windows PowerShell 5.1** (the built-in one):

```powershell
powershell -ExecutionPolicy Bypass -File .\infra\deploy.ps1 -BudgetEmail you@example.com
```

**bash (macOS/Linux):** `./infra/deploy.sh --budget-email you@example.com`

It shows the subscription and asks before changing anything (`-Yes` skips the question). Steps: check tools and login, resource group, Foundry account + key access + deployment, Static Web App + app settings, budget, GitHub secret, deploy workflow (watched until it finishes), then a call to `https://<your-app>.azurestaticapps.net/api/health`. `"live": true` means the API reaches your model. The URL is printed at the end.

Useful options: `-Subscription <id>` (switch subscription first), `-SwaName`, `-Location`, `-FoundryAccount`, `-FoundryResourceGroup`, `-Deployment`, `-BudgetAmount`, `-RatePerMinute`, `-DailyCallCap`, `-SkipGitHub`, `-NoWait`. Run `Get-Help ./infra/deploy.ps1 -Full` for all of them.

Re-running is safe: existing resources are updated in place, the budget keeps its start date, the deployment token stays the same. Re-run it after you rotate the Foundry key, so the app settings pick up the new key.

## Cost

- **Static Web App, Free plan: 0.** Managed Functions API included, 100 GB bandwidth a month included, no overage billing on Free ([plans](https://learn.microsoft.com/azure/static-web-apps/plans), [quotas](https://learn.microsoft.com/azure/static-web-apps/quotas)).
- **Model calls** are billed on your Foundry deployment. Microsoft's launch post lists Microsoft-Decision-1 at **$0.042 per million input tokens, output tokens free** ([launch post](https://commandline.microsoft.com/microsoft-decision-1-model-foundry/), read 2026-10-31; check the model's page in the Foundry catalog for your region's current price). The API stops live calls at 10 runs per minute per IP and 500 model calls per day. As an estimate, if a call is around 2,000 input tokens, the full daily cap is 1 million tokens, about $0.04 a day.
- The budget is your safety net: you get an email at 80 % and when the forecast passes 100 %.

## Tear down

```powershell
pwsh ./infra/teardown.ps1                      # deletes the Static Web App and the budget, asks first
pwsh ./infra/teardown.ps1 -RemoveGitHubSecret  # also removes the token secret, so the deploy workflow skips again
```

The resource group, the Foundry account and the model deployment are never deleted.

## How it was tested

- `bicep build` and `bicep lint` (Bicep 0.48.1) on `main.bicep` and `budget.bicep`: no errors or warnings. CI repeats this on every push (`.github/workflows/infra.yml`).
- `deploy.ps1` and `teardown.ps1`: parsed with the PowerShell parser and checked with PSScriptAnalyzer (PowerShell 7.6); CI parses them with both Windows PowerShell 5.1 and PowerShell 7 on Windows and Linux. The scripts were also run end to end against stand-in `az`/`gh` commands to check the flow, the error paths and that the deployment token reaches `gh` only through stdin.
- Not yet run against real Azure. The first real run is yours.
