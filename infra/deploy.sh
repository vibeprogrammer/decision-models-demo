#!/usr/bin/env bash
# macOS / Linux twin of infra/deploy.ps1 (Windows users: use deploy.ps1).
# Creates/updates the Static Web App (Free) + app settings in rg-middagskos, optional budget,
# sets the GitHub deployment-token secret, runs the deploy workflow, checks /api/health.
# Safe to re-run. The model key never leaves Azure (main.bicep reads it with listKeys).
#
#   ./infra/deploy.sh --budget-email you@example.com [--yes] [--skip-github] [--no-wait]
# Other options (defaults): --resource-group rg-middagskos --location westeurope
#   --swa-name swa-decision-demo --foundry-account proj-middagskos-resource
#   --deployment dep-decision-1 --budget-amount 5 --repo webmaxru/decision-models-demo
set -euo pipefail

RG=rg-middagskos; LOCATION=westeurope; SWA=swa-decision-demo; FOUNDRY=proj-middagskos-resource
FOUNDRY_RG=""; DEPLOYMENT=dep-decision-1; ENDPOINT=""; BUDGET_EMAIL=""; BUDGET_AMOUNT=5
BUDGET_NAME=budget-decision-demo; RATE=10; DAILY=500; REPO=webmaxru/decision-models-demo
BRANCH=main; YES=0; SKIP_GH=0; NO_WAIT=0
while [ $# -gt 0 ]; do
  case "$1" in
    --resource-group) RG=$2; shift 2;; --location) LOCATION=$2; shift 2;;
    --swa-name) SWA=$2; shift 2;; --foundry-account) FOUNDRY=$2; shift 2;;
    --foundry-resource-group) FOUNDRY_RG=$2; shift 2;; --deployment) DEPLOYMENT=$2; shift 2;;
    --endpoint) ENDPOINT=$2; shift 2;; --budget-email) BUDGET_EMAIL=$2; shift 2;;
    --budget-amount) BUDGET_AMOUNT=$2; shift 2;; --budget-name) BUDGET_NAME=$2; shift 2;;
    --rate-per-minute) RATE=$2; shift 2;; --daily-call-cap) DAILY=$2; shift 2;;
    --repo) REPO=$2; shift 2;; --branch) BRANCH=$2; shift 2;;
    --yes|-y) YES=1; shift;; --skip-github) SKIP_GH=1; shift;; --no-wait) NO_WAIT=1; shift;;
    -h|--help) sed -n '2,11p' "$0"; exit 0;;
    *) echo "Unknown option: $1" >&2; exit 2;;
  esac
done
FOUNDRY_RG=${FOUNDRY_RG:-$RG}
DIR="$(cd "$(dirname "$0")" && pwd)"
STAMP=$(date +%Y%m%d-%H%M%S)
c() { printf '\033[%sm%s\033[0m\n' "$1" "$2"; }
step() { echo; c 36 "== $1"; }
ok() { c 32 "   OK   $1"; }
info() { c 90 "   ..   $1"; }
warn() { c 33 "   WARN $1"; }
die() { echo; c 31 "ERROR: $1"; [ -n "${2:-}" ] && c 33 "Next:  $2"; exit 1; }

step "Checking tools"
command -v az >/dev/null || die "Azure CLI (az) is not installed." "brew install azure-cli (or see learn.microsoft.com/cli/azure/install-azure-cli), then az login"
az bicep version --only-show-errors >/dev/null 2>&1 || az bicep install --only-show-errors
ok "Azure CLI + Bicep"
USE_GH=1
if [ $SKIP_GH = 1 ]; then USE_GH=0
elif ! command -v gh >/dev/null; then warn "gh not found: GitHub steps will be printed"; USE_GH=0
elif ! gh auth status --hostname github.com >/dev/null 2>&1; then warn "gh not logged in (gh auth login): GitHub steps will be printed"; USE_GH=0
else ok "GitHub CLI logged in"; fi

step "Azure login and subscription"
SUB_ID=$(az account show --query id -o tsv --only-show-errors 2>/dev/null) || die "Not logged in to Azure." "az login"
ok "Subscription: $(az account show --query name -o tsv --only-show-errors) ($SUB_ID)"
info "RG $RG | SWA $SWA ($LOCATION, Free) | model $FOUNDRY/$DEPLOYMENT | budget: ${BUDGET_EMAIL:-skipped}"
if [ $YES = 0 ]; then read -r -p "   Deploy to this subscription? [y/N] " a; case "$a" in y|Y|yes) ;; *) echo "Stopped. Nothing changed."; exit 0;; esac; fi

step "Resource group $RG"
if [ "$(az group exists -n "$RG" --only-show-errors)" = true ]; then ok "exists (left as is)"
else az group create -n "$RG" -l "$LOCATION" --tags project=decision-models-demo -o none --only-show-errors; ok "created"; fi

step "Foundry account $FOUNDRY (read only)"
SUBDOMAIN=$(az cognitiveservices account show -n "$FOUNDRY" -g "$FOUNDRY_RG" --query properties.customSubDomainName -o tsv --only-show-errors) \
  || die "Foundry account '$FOUNDRY' not found in '$FOUNDRY_RG'." "az cognitiveservices account list -g $FOUNDRY_RG -o table, then --foundry-account <name>"
SUBDOMAIN=${SUBDOMAIN:-$FOUNDRY}
ENDPOINT=${ENDPOINT:-https://$SUBDOMAIN.services.ai.azure.com/providers/microsoft/v1/systemone}
az cognitiveservices account keys list -n "$FOUNDRY" -g "$FOUNDRY_RG" --query 'length(key1)' -o tsv --only-show-errors >/dev/null \
  || die "Cannot list keys on $FOUNDRY." "You need Cognitive Services Contributor / Contributor / Owner on it, and key auth enabled."
ok "key access confirmed (the key stays in Azure)"
MODEL=$(az cognitiveservices account deployment show -n "$FOUNDRY" -g "$FOUNDRY_RG" --deployment-name "$DEPLOYMENT" --query properties.model.name -o tsv --only-show-errors) \
  || die "Deployment '$DEPLOYMENT' not found. Deployments: $(az cognitiveservices account deployment list -n "$FOUNDRY" -g "$FOUNDRY_RG" --query '[].name' -o tsv --only-show-errors | tr '\n' ' ')" "--deployment <name>"
ok "deployment $DEPLOYMENT (model $MODEL)"

step "Static Web App $SWA (Free) + app settings"
HOST=$(az deployment group create -g "$RG" -n "decision-demo-$STAMP" -f "$DIR/main.bicep" --only-show-errors \
  -p swaName="$SWA" location="$LOCATION" foundryAccountName="$FOUNDRY" foundryResourceGroup="$FOUNDRY_RG" \
     decisionDeployment="$DEPLOYMENT" decisionEndpoint="$ENDPOINT" rateLimitPerMinute="$RATE" dailyCallCap="$DAILY" \
  --query properties.outputs.defaultHostname.value -o tsv) || die "Deployment of main.bicep failed (see above)." "Contributor on $RG needed; region must be westeurope/eastus2/centralus/westus2/eastasia. Safe to re-run."
SITE="https://$HOST"
ok "Static Web App ready: $SITE"

step "Monthly budget alert"
if [ -z "$BUDGET_EMAIL" ]; then info "skipped (add --budget-email you@example.com)"
else
  URL="/subscriptions/$SUB_ID/resourceGroups/$RG/providers/Microsoft.Consumption/budgets/$BUDGET_NAME?api-version=2023-11-01"
  START=$(az rest --method get --url "$URL" --query properties.timePeriod.startDate -o tsv --only-show-errors 2>/dev/null | cut -c1-10 || true)
  START=${START:-$(date -u +%Y-%m-01)}
  if az deployment group create -g "$RG" -n "decision-budget-$STAMP" -f "$DIR/budget.bicep" -o none --only-show-errors \
       -p budgetName="$BUDGET_NAME" amount="$BUDGET_AMOUNT" contactEmail="$BUDGET_EMAIL" startDate="$START"; then
    ok "budget $BUDGET_NAME: $BUDGET_AMOUNT/month, alerts 80% actual + 100% forecast to $BUDGET_EMAIL"
  else warn "budget not created (web app is fine). Portal: Cost Management > Budgets > + Add (scope: $RG)"; fi
fi

step "GitHub: deployment token secret"
if [ $USE_GH = 1 ] && az staticwebapp secrets list -n "$SWA" -g "$RG" --query properties.apiKey -o tsv --only-show-errors \
     | gh secret set AZURE_STATIC_WEB_APPS_API_TOKEN --repo "$REPO"; then
  ok "AZURE_STATIC_WEB_APPS_API_TOKEN set on $REPO"
else
  warn "Do it by hand (token goes to the clipboard, not the screen):"
  echo "   1. az staticwebapp secrets list -n $SWA -g $RG --query properties.apiKey -o tsv | pbcopy   (Linux: xclip -sel clip)"
  echo "   2. https://github.com/$REPO/settings/secrets/actions > New repository secret > AZURE_STATIC_WEB_APPS_API_TOKEN"
  echo "   3. https://github.com/$REPO/actions/workflows/azure-static-web-apps.yml > Run workflow"
  echo; c 32 "Infra ready. Site after the deploy run: $SITE"; exit 0
fi

step "GitHub: deploy workflow"
gh workflow run azure-static-web-apps.yml --repo "$REPO" --ref "$BRANCH" >/dev/null || die "Could not start the workflow." "https://github.com/$REPO/actions/workflows/azure-static-web-apps.yml > Run workflow"
ok "deploy workflow started"
if [ $NO_WAIT = 0 ]; then
  sleep 8
  RUN=$(gh run list --repo "$REPO" --workflow azure-static-web-apps.yml --event workflow_dispatch --limit 1 --json databaseId --jq '.[0].databaseId')
  [ -n "$RUN" ] && { gh run watch "$RUN" --repo "$REPO" --exit-status --interval 10 || die "Deploy workflow failed." "https://github.com/$REPO/actions/runs/$RUN"; }
  step "Checking the live site"
  for i in 1 2 3 4 5 6 7 8; do
    if H=$(curl -fsS --max-time 30 "$SITE/api/health" 2>/dev/null); then ok "health: $H"; break; fi
    [ $i = 8 ] && warn "$SITE/api/health not answering yet; try again in a few minutes"; sleep 15
  done
fi
echo; c 32 "Done. Web demo: $SITE"
c 90 "Cost: SWA Free = 0; you pay only for model calls (capped by the API limits). Remove: pwsh ./infra/teardown.ps1"
