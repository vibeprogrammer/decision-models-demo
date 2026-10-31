<#
.SYNOPSIS
  One-command, low-cost Azure deployment of the decision-models-demo web demo.

.DESCRIPTION
  Creates (or updates) an Azure Static Web App on the FREE plan, with its managed Azure
  Functions API, in an existing resource group (default rg-middagskos), wires it to your
  Microsoft-Decision-1 deployment on the existing Foundry account, adds an optional monthly
  budget alert, puts the deployment token into the GitHub repo secret, runs the deploy
  workflow and checks the live URL.

  Safe to re-run: every step creates only what is missing and updates the rest in place.
  The model key is never shown, typed or written to disk: Azure reads it from the Foundry
  account during the deployment (listKeys in main.bicep). The Foundry account and the model
  deployment are only read, never changed.

  Works in Windows PowerShell 5.1 and PowerShell 7+ (Windows, macOS, Linux).
  Needs: Azure CLI (az login), and for the GitHub part the GitHub CLI (gh auth login).

.EXAMPLE
  pwsh ./infra/deploy.ps1 -BudgetEmail you@example.com

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\infra\deploy.ps1 -BudgetEmail you@example.com
#>
[CmdletBinding()]
param(
  [string]$ResourceGroup = 'rg-middagskos',
  [ValidateSet('westeurope', 'eastus2', 'centralus', 'westus2', 'eastasia')]
  [string]$Location = 'westeurope',
  [string]$SwaName = 'swa-decision-demo',
  [string]$FoundryAccount = 'proj-middagskos-resource',
  [string]$FoundryResourceGroup = '',
  [string]$Deployment = 'dep-decision-1',
  [string]$Endpoint = '',
  [string]$BudgetEmail = '',
  [int]$BudgetAmount = 5,
  [string]$BudgetName = 'budget-decision-demo',
  [int]$RatePerMinute = 10,
  [int]$DailyCallCap = 500,
  [string]$Repo = 'vibeprogrammer/decision-models-demo',
  [string]$Branch = 'main',
  [string]$Subscription = '',
  [switch]$SkipGitHub,
  [switch]$NoWait,
  [switch]$Yes
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12 } catch { $null = $_ }

$script:StepNo = 0
function Write-Step([string]$Text) { $script:StepNo++; Write-Host ''; Write-Host ("[{0}] {1}" -f $script:StepNo, $Text) -ForegroundColor Cyan }
function Write-Ok([string]$Text) { Write-Host ("    OK   {0}" -f $Text) -ForegroundColor Green }
function Write-Info([string]$Text) { Write-Host ("    ..   {0}" -f $Text) -ForegroundColor Gray }
function Write-Warn2([string]$Text) { Write-Host ("    WARN {0}" -f $Text) -ForegroundColor Yellow }
function Exit-WithHint([string]$Text, [string]$Hint) {
  Write-Host ''
  Write-Host ("ERROR: {0}" -f $Text) -ForegroundColor Red
  if ($Hint) { Write-Host ("Next:  {0}" -f $Hint) -ForegroundColor Yellow }
  exit 1
}

# Runs a native command without letting stderr warnings turn into terminating errors
# (a Windows PowerShell 5.1 trap). Returns exit code, stdout and stderr as text.
function Invoke-Native {
  param([Parameter(Mandatory = $true)][string]$Exe, [string[]]$Arguments = @())
  $prev = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $all = & $Exe @Arguments 2>&1
    $code = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $prev
  }
  $outLines = @()
  $errLines = @()
  foreach ($line in @($all)) {
    if ($line -is [System.Management.Automation.ErrorRecord]) { $errLines += $line.ToString() } else { $outLines += [string]$line }
  }
  return [pscustomobject]@{ Code = $code; Out = (($outLines -join "`n").Trim()); Err = (($errLines -join "`n").Trim()) }
}

function Invoke-Az {
  param([string[]]$Arguments, [string]$What, [string]$Hint = '', [switch]$AllowFail)
  $r = Invoke-Native -Exe 'az' -Arguments ($Arguments + @('--only-show-errors'))
  if ($r.Code -ne 0 -and -not $AllowFail) {
    $msg = $r.Err
    if (-not $Hint) { $Hint = Get-AzHint $msg }
    Exit-WithHint ("{0} failed.`n{1}" -f $What, $msg) $Hint
  }
  return $r
}

function Get-AzHint([string]$Message) {
  if ($Message -match 'AuthorizationFailed|does not have authorization') { return "Your account needs Contributor (or Owner) on resource group '$ResourceGroup'. Ask the subscription owner, or run with -Subscription <id> if this is the wrong subscription." }
  if ($Message -match 'az login|Please run .az login') { return 'Run: az login   (then re-run this script)' }
  if ($Message -match 'LocationNotAvailableForResourceType|not available for resource type') { return 'Static Web Apps runs only in westeurope, eastus2, centralus, westus2, eastasia. Use -Location westeurope.' }
  if ($Message -match 'ResourceNotFound|was not found|could not be found') { return "Check the names: -ResourceGroup '$ResourceGroup', -FoundryAccount '$FoundryAccount' (az cognitiveservices account list -o table)." }
  if ($Message -match 'Bicep|bicep') { return 'Run: az bicep install   (or az bicep upgrade), then re-run.' }
  if ($Message -match 'RequestDisallowedByPolicy') { return 'An Azure Policy blocks this resource or region. Check the policy name in the message with your subscription admin.' }
  return 'Fix the error above and re-run; the script is safe to run again.'
}

$infraDir = $PSScriptRoot
$mainBicep = [IO.Path]::Combine($infraDir, 'main.bicep')
$budgetBicep = [IO.Path]::Combine($infraDir, 'budget.bicep')
if (-not $FoundryResourceGroup) { $FoundryResourceGroup = $ResourceGroup }
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'

Write-Host 'Decision models demo: Azure deploy (Static Web App Free + managed Functions)' -ForegroundColor White

# ---------------------------------------------------------------------------------------
Write-Step 'Checking tools'
if (-not (Get-Command az -ErrorAction SilentlyContinue)) {
  Exit-WithHint 'Azure CLI (az) is not installed.' 'Install it: winget install -e --id Microsoft.AzureCLI   (macOS: brew install azure-cli), open a new terminal, run az login, re-run.'
}
if (-not (Test-Path $mainBicep) -or -not (Test-Path $budgetBicep)) {
  Exit-WithHint "main.bicep / budget.bicep not found next to this script ($infraDir)." 'Run the script from a full clone of the repo: git clone https://github.com/vibeprogrammer/decision-models-demo.git'
}
$azv = Invoke-Native -Exe 'az' -Arguments @('version', '-o', 'json')
$azVersion = 'unknown version'
if ($azv.Code -eq 0 -and $azv.Out) { try { $azVersion = ($azv.Out | ConvertFrom-Json).'azure-cli' } catch { $null = $_ } }
Write-Ok ("Azure CLI {0}" -f $azVersion)
$bv = Invoke-Native -Exe 'az' -Arguments @('bicep', 'version', '--only-show-errors')
if ($bv.Code -ne 0) {
  Write-Info 'Installing Bicep for the Azure CLI (one time)'
  Invoke-Az -Arguments @('bicep', 'install') -What 'az bicep install' | Out-Null
}
Write-Ok 'Bicep available'

$useGh = -not $SkipGitHub
if ($useGh) {
  if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
    Write-Warn2 'GitHub CLI (gh) not found: the GitHub steps will be printed for you to do by hand. (Install: winget install -e --id GitHub.cli, then gh auth login.)'
    $useGh = $false
  } else {
    $ga = Invoke-Native -Exe 'gh' -Arguments @('auth', 'status', '--hostname', 'github.com')
    if ($ga.Code -ne 0) {
      Write-Warn2 'GitHub CLI is not logged in: the GitHub steps will be printed for you to do by hand. (Run gh auth login to automate them.)'
      $useGh = $false
    } else {
      Write-Ok 'GitHub CLI logged in'
    }
  }
}

# ---------------------------------------------------------------------------------------
Write-Step 'Checking your Azure login and subscription'
if ($Subscription) {
  Invoke-Az -Arguments @('account', 'set', '--subscription', $Subscription) -What "Switching to subscription '$Subscription'" | Out-Null
}
$acct = Invoke-Native -Exe 'az' -Arguments @('account', 'show', '-o', 'json', '--only-show-errors')
if ($acct.Code -ne 0) { Exit-WithHint 'You are not logged in to Azure.' 'Run: az login   (then re-run this script)' }
$acctObj = $acct.Out | ConvertFrom-Json
$subId = $acctObj.id
Write-Ok ("Subscription: {0} ({1})" -f $acctObj.name, $subId)
Write-Ok ("Signed in as: {0}" -f $acctObj.user.name)
Write-Info ("Resource group: {0}   Static Web App: {1} ({2}, Free)   Model: {3}/{4}" -f $ResourceGroup, $SwaName, $Location, $FoundryAccount, $Deployment)
if ($BudgetEmail) { Write-Info ("Budget: {0} per month, alerts to {1}" -f $BudgetAmount, $BudgetEmail) } else { Write-Info 'Budget: skipped (add -BudgetEmail you@example.com to create one)' }
if (-not $Yes) {
  $answer = Read-Host '    Deploy to this subscription? [y/N]'
  if ($answer -notmatch '^(y|yes)$') { Write-Host 'Stopped. Nothing was changed.' -ForegroundColor Yellow; exit 0 }
}

# ---------------------------------------------------------------------------------------
Write-Step "Resource group $ResourceGroup"
$rgExists = Invoke-Az -Arguments @('group', 'exists', '--name', $ResourceGroup) -What 'Checking the resource group'
if ($rgExists.Out -eq 'true') {
  Write-Ok 'exists (left as is)'
} else {
  Invoke-Az -Arguments @('group', 'create', '--name', $ResourceGroup, '--location', $Location, '--tags', 'project=decision-models-demo', '-o', 'none') -What 'Creating the resource group' | Out-Null
  Write-Ok ("created in {0}" -f $Location)
}

# ---------------------------------------------------------------------------------------
Write-Step "Foundry account $FoundryAccount (read only)"
$fa = Invoke-Az -Arguments @('cognitiveservices', 'account', 'show', '--name', $FoundryAccount, '--resource-group', $FoundryResourceGroup, '--query', 'properties.customSubDomainName', '-o', 'tsv') -What 'Reading the Foundry account' -AllowFail
if ($fa.Code -ne 0) {
  $list = Invoke-Native -Exe 'az' -Arguments @('cognitiveservices', 'account', 'list', '--resource-group', $FoundryResourceGroup, '--query', '[].name', '-o', 'tsv', '--only-show-errors')
  $names = ($list.Out -split "`n" | Where-Object { $_ }) -join ', '
  if (-not $names) { $names = '(none)' }
  Exit-WithHint ("Foundry account '{0}' not found in resource group '{1}'. Accounts there: {2}" -f $FoundryAccount, $FoundryResourceGroup, $names) 'Re-run with -FoundryAccount <name> (and -FoundryResourceGroup <rg> if it lives elsewhere).'
}
$subdomain = $fa.Out
if (-not $subdomain) { $subdomain = $FoundryAccount }
Write-Ok ("found (endpoint host {0}.services.ai.azure.com)" -f $subdomain)
if (-not $Endpoint) { $Endpoint = "https://$subdomain.services.ai.azure.com/providers/microsoft/v1/systemone" }

# Only the LENGTH of the key is read, to prove access; the key itself stays in Azure.
$klen = Invoke-Az -Arguments @('cognitiveservices', 'account', 'keys', 'list', '--name', $FoundryAccount, '--resource-group', $FoundryResourceGroup, '--query', 'length(key1)', '-o', 'tsv') -What 'Checking access to the Foundry keys' -Hint "Your account needs permission to list keys on $FoundryAccount (Cognitive Services Contributor, Contributor or Owner). If local (key) auth is disabled on the account, enable it or ask the owner." -AllowFail
if ($klen.Code -ne 0) {
  Exit-WithHint ("Cannot read the keys of {0}.`n{1}" -f $FoundryAccount, $klen.Err) "Your account needs permission to list keys on $FoundryAccount (Cognitive Services Contributor, Contributor or Owner). If key auth is disabled on the account, enable it or ask the owner."
}
Write-Ok 'key access confirmed (the key is read by Azure during the deployment, never shown here)'

$dep = Invoke-Az -Arguments @('cognitiveservices', 'account', 'deployment', 'show', '--name', $FoundryAccount, '--resource-group', $FoundryResourceGroup, '--deployment-name', $Deployment, '--query', 'properties.model.name', '-o', 'tsv') -What 'Checking the model deployment' -AllowFail
if ($dep.Code -ne 0) {
  $dl = Invoke-Native -Exe 'az' -Arguments @('cognitiveservices', 'account', 'deployment', 'list', '--name', $FoundryAccount, '--resource-group', $FoundryResourceGroup, '--query', '[].name', '-o', 'tsv', '--only-show-errors')
  $dnames = ($dl.Out -split "`n" | Where-Object { $_ }) -join ', '
  if (-not $dnames) { $dnames = '(none)' }
  Exit-WithHint ("Model deployment '{0}' not found on {1}. Deployments there: {2}" -f $Deployment, $FoundryAccount, $dnames) 'Re-run with -Deployment <name>.'
}
Write-Ok ("deployment {0} found (model {1})" -f $Deployment, $dep.Out)

# ---------------------------------------------------------------------------------------
Write-Step "Static Web App $SwaName (Free) + app settings"
$params = @(
  "swaName=$SwaName",
  "location=$Location",
  "foundryAccountName=$FoundryAccount",
  "foundryResourceGroup=$FoundryResourceGroup",
  "decisionDeployment=$Deployment",
  "decisionEndpoint=$Endpoint",
  "rateLimitPerMinute=$RatePerMinute",
  "dailyCallCap=$DailyCallCap"
)
Write-Info 'Deploying main.bicep (about 1 minute)'
$d = Invoke-Az -Arguments (@('deployment', 'group', 'create', '--resource-group', $ResourceGroup, '--name', "decision-demo-$stamp", '--template-file', $mainBicep, '--parameters') + $params + @('--query', 'properties.outputs', '-o', 'json')) -What 'Deploying the Static Web App'
$outputs = $d.Out | ConvertFrom-Json
$hostName = $outputs.defaultHostname.value
$siteUrl = "https://$hostName"
Write-Ok ("Static Web App ready: {0}" -f $siteUrl)
Write-Ok ("App settings: AZURE_DECISION_ENDPOINT={0}, AZURE_DECISION_DEPLOYMENT={1}, AZURE_DECISION_KEY=(from Azure), limits {2}/min per IP, {3}/day" -f $Endpoint, $Deployment, $RatePerMinute, $DailyCallCap)

# ---------------------------------------------------------------------------------------
Write-Step 'Monthly budget alert'
if (-not $BudgetEmail) {
  Write-Info 'skipped (no -BudgetEmail). Re-run with -BudgetEmail you@example.com to add it.'
} else {
  $budgetUrl = "/subscriptions/$subId/resourceGroups/$ResourceGroup/providers/Microsoft.Consumption/budgets/$($BudgetName)?api-version=2023-11-01"
  $existing = Invoke-Native -Exe 'az' -Arguments @('rest', '--method', 'get', '--url', $budgetUrl, '--query', 'properties.timePeriod.startDate', '-o', 'tsv', '--only-show-errors')
  if ($existing.Code -eq 0 -and $existing.Out.Length -ge 10) {
    $startDate = $existing.Out.Substring(0, 10)
    Write-Info ("budget exists, keeping its start date {0}" -f $startDate)
  } else {
    $startDate = (Get-Date).ToUniversalTime().ToString('yyyy-MM-01')
  }
  $b = Invoke-Native -Exe 'az' -Arguments @('deployment', 'group', 'create', '--resource-group', $ResourceGroup, '--name', "decision-budget-$stamp", '--template-file', $budgetBicep, '--parameters', "budgetName=$BudgetName", "amount=$BudgetAmount", "contactEmail=$BudgetEmail", "startDate=$startDate", '-o', 'none', '--only-show-errors')
  if ($b.Code -eq 0) {
    Write-Ok ("budget '{0}': {1} per month (billing currency), email at 80% actual and 100% forecast to {2}" -f $BudgetName, $BudgetAmount, $BudgetEmail)
  } else {
    Write-Warn2 ("The budget could not be created (the web app is fine). Azure said:`n{0}" -f $b.Err)
    Write-Warn2 'Some subscription types do not support budgets. Portal alternative: Cost Management > Budgets > + Add, scope = the resource group.'
  }
}

# ---------------------------------------------------------------------------------------
Write-Step 'GitHub: deployment token secret'
$tokenCmd = "az staticwebapp secrets list --name $SwaName --resource-group $ResourceGroup --query properties.apiKey -o tsv"
$manual = $true
if ($useGh) {
  $tk = Invoke-Az -Arguments @('staticwebapp', 'secrets', 'list', '--name', $SwaName, '--resource-group', $ResourceGroup, '--query', 'properties.apiKey', '-o', 'tsv') -What 'Reading the deployment token'
  $token = $tk.Out
  $prev = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    # Sent on stdin, never on the command line or the screen.
    $setOut = $token | & gh secret set AZURE_STATIC_WEB_APPS_API_TOKEN --repo $Repo 2>&1
    $setCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $prev
    $token = $null
    Remove-Variable -Name token -ErrorAction SilentlyContinue
    $tk = $null
  }
  if ($setCode -eq 0) {
    Write-Ok ("AZURE_STATIC_WEB_APPS_API_TOKEN set on {0}" -f $Repo)
    $manual = $false
  } else {
    Write-Warn2 ("gh could not set the secret: {0}" -f (($setOut | ForEach-Object { "$_" }) -join ' '))
    Write-Warn2 "Your GitHub login needs admin (or write + secrets) access to $Repo."
  }
}
if ($manual) {
  Write-Host ''
  Write-Host '    Do this by hand (the token is copied to your clipboard, not shown):' -ForegroundColor Yellow
  Write-Host ("      1. {0} | Set-Clipboard" -f $tokenCmd) -ForegroundColor Yellow
  Write-Host ("      2. https://github.com/{0}/settings/secrets/actions > New repository secret" -f $Repo) -ForegroundColor Yellow
  Write-Host '         Name: AZURE_STATIC_WEB_APPS_API_TOKEN   Value: paste   > Add secret' -ForegroundColor Yellow
  Write-Host ("      3. https://github.com/{0}/actions/workflows/azure-static-web-apps.yml > Run workflow" -f $Repo) -ForegroundColor Yellow
  Write-Host ("      4. When the run is green, open {0}" -f $siteUrl) -ForegroundColor Yellow
  Write-Host ''
  Write-Host ("Infra is ready. Site (after the deploy run): {0}" -f $siteUrl) -ForegroundColor Green
  exit 0
}

# ---------------------------------------------------------------------------------------
Write-Step 'GitHub: deploy workflow'
$dispatchTime = (Get-Date).ToUniversalTime().AddSeconds(-30)
$wr = Invoke-Native -Exe 'gh' -Arguments @('workflow', 'run', 'azure-static-web-apps.yml', '--repo', $Repo, '--ref', $Branch)
if ($wr.Code -ne 0) {
  Exit-WithHint ("Could not start the deploy workflow: {0}" -f $wr.Err) ("Start it by hand: https://github.com/{0}/actions/workflows/azure-static-web-apps.yml > Run workflow" -f $Repo)
}
Write-Ok 'deploy workflow started'
$runId = $null
for ($i = 0; $i -lt 12 -and -not $runId; $i++) {
  Start-Sleep -Seconds 5
  $rl = Invoke-Native -Exe 'gh' -Arguments @('run', 'list', '--repo', $Repo, '--workflow', 'azure-static-web-apps.yml', '--limit', '5', '--json', 'databaseId,createdAt,event')
  if ($rl.Code -eq 0 -and $rl.Out) {
    foreach ($run in @($rl.Out | ConvertFrom-Json)) {
      $created = [DateTime]::Parse([string]$run.createdAt, [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::AdjustToUniversal)
      if ($run.event -eq 'workflow_dispatch' -and $created -ge $dispatchTime) { $runId = $run.databaseId; break }
    }
  }
}
if (-not $runId) {
  Write-Warn2 ("Could not find the run; follow it at https://github.com/{0}/actions" -f $Repo)
} elseif ($NoWait) {
  Write-Info ("follow it at https://github.com/{0}/actions/runs/{1}" -f $Repo, $runId)
} else {
  Write-Info ("watching run {0} (Ctrl+C stops watching, not the deploy)" -f $runId)
  $prev = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try { & gh run watch $runId --repo $Repo --exit-status --interval 10; $watchCode = $LASTEXITCODE } finally { $ErrorActionPreference = $prev }
  if ($watchCode -ne 0) {
    Exit-WithHint 'The deploy workflow failed.' ("Open https://github.com/{0}/actions/runs/{1} for the log, fix, then re-run this script (or just the workflow)." -f $Repo, $runId)
  }
  Write-Ok 'deploy workflow succeeded'
}

# ---------------------------------------------------------------------------------------
if (-not $NoWait) {
  Write-Step 'Checking the live site'
  $health = $null
  for ($i = 0; $i -lt 8 -and -not $health; $i++) {
    try { $health = Invoke-RestMethod -Uri "$siteUrl/api/health" -TimeoutSec 30 } catch { Start-Sleep -Seconds 15 }
  }
  if (-not $health) {
    Write-Warn2 ("{0}/api/health did not answer yet. Managed APIs can take a few minutes after the first deploy; try the URL again shortly." -f $siteUrl)
  } elseif ($health.live) {
    Write-Ok ("API live on deployment {0} (limits: {1}/min per IP, {2}/day)" -f $health.deployment, $health.limits.perIpPerMinute, $health.limits.dailyCallCap)
  } else {
    Write-Warn2 'API answers but reports live=false: the app settings are missing. Re-run this script.'
  }
}

Write-Host ''
Write-Host ("Done. Web demo: {0}" -f $siteUrl) -ForegroundColor Green
Write-Host 'Cost: Static Web App Free plan = 0. You pay only for model calls on your Foundry deployment (capped by the API limits above).' -ForegroundColor Gray
Write-Host 'Remove it later with: pwsh ./infra/teardown.ps1' -ForegroundColor Gray
