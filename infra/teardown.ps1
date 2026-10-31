<#
.SYNOPSIS
  Removes what infra/deploy.ps1 created: the Static Web App and the budget.

.DESCRIPTION
  Deletes ONLY the Static Web App (default swa-decision-demo) and the budget (default
  budget-decision-demo) in the resource group. It never deletes the resource group, the
  Foundry account or the model deployment. Optionally removes the GitHub secret
  AZURE_STATIC_WEB_APPS_API_TOKEN so the deploy workflow goes back to skipping.

  Works in Windows PowerShell 5.1 and PowerShell 7+.

.EXAMPLE
  pwsh ./infra/teardown.ps1
.EXAMPLE
  pwsh ./infra/teardown.ps1 -RemoveGitHubSecret -Yes
#>
[CmdletBinding()]
param(
  [string]$ResourceGroup = 'rg-middagskos',
  [string]$SwaName = 'swa-decision-demo',
  [string]$BudgetName = 'budget-decision-demo',
  [string]$Repo = 'vibeprogrammer/decision-models-demo',
  [string]$Subscription = '',
  [switch]$RemoveGitHubSecret,
  [switch]$Yes
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Write-Ok([string]$Text) { Write-Host ("    OK   {0}" -f $Text) -ForegroundColor Green }
function Write-Info([string]$Text) { Write-Host ("    ..   {0}" -f $Text) -ForegroundColor Gray }
function Write-Warn2([string]$Text) { Write-Host ("    WARN {0}" -f $Text) -ForegroundColor Yellow }
function Exit-WithHint([string]$Text, [string]$Hint) {
  Write-Host ("ERROR: {0}" -f $Text) -ForegroundColor Red
  if ($Hint) { Write-Host ("Next:  {0}" -f $Hint) -ForegroundColor Yellow }
  exit 1
}
function Invoke-Native {
  param([Parameter(Mandatory = $true)][string]$Exe, [string[]]$Arguments = @())
  $prev = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try { $all = & $Exe @Arguments 2>&1; $code = $LASTEXITCODE } finally { $ErrorActionPreference = $prev }
  $outLines = @(); $errLines = @()
  foreach ($line in @($all)) {
    if ($line -is [System.Management.Automation.ErrorRecord]) { $errLines += $line.ToString() } else { $outLines += [string]$line }
  }
  return [pscustomobject]@{ Code = $code; Out = (($outLines -join "`n").Trim()); Err = (($errLines -join "`n").Trim()) }
}

if (-not (Get-Command az -ErrorAction SilentlyContinue)) { Exit-WithHint 'Azure CLI (az) is not installed.' 'winget install -e --id Microsoft.AzureCLI' }
if ($Subscription) {
  $s = Invoke-Native -Exe 'az' -Arguments @('account', 'set', '--subscription', $Subscription, '--only-show-errors')
  if ($s.Code -ne 0) { Exit-WithHint $s.Err 'Check the subscription id: az account list -o table' }
}
$acct = Invoke-Native -Exe 'az' -Arguments @('account', 'show', '-o', 'json', '--only-show-errors')
if ($acct.Code -ne 0) { Exit-WithHint 'You are not logged in to Azure.' 'Run: az login' }
$a = $acct.Out | ConvertFrom-Json
$subId = $a.id

Write-Host 'Decision models demo: teardown' -ForegroundColor White
Write-Info ("Subscription: {0} ({1})" -f $a.name, $subId)
Write-Info ("Will delete: Static Web App '{0}' and budget '{1}' in '{2}'" -f $SwaName, $BudgetName, $ResourceGroup)
Write-Info 'Will NOT touch: the resource group, the Foundry account, the model deployment'
if ($RemoveGitHubSecret) { Write-Info ("Will remove GitHub secret AZURE_STATIC_WEB_APPS_API_TOKEN from {0}" -f $Repo) }
if (-not $Yes) {
  $answer = Read-Host '    Delete these? [y/N]'
  if ($answer -notmatch '^(y|yes)$') { Write-Host 'Stopped. Nothing was deleted.' -ForegroundColor Yellow; exit 0 }
}

$show = Invoke-Native -Exe 'az' -Arguments @('staticwebapp', 'show', '--name', $SwaName, '--resource-group', $ResourceGroup, '--query', 'name', '-o', 'tsv', '--only-show-errors')
if ($show.Code -eq 0 -and $show.Out) {
  $del = Invoke-Native -Exe 'az' -Arguments @('staticwebapp', 'delete', '--name', $SwaName, '--resource-group', $ResourceGroup, '--yes', '--only-show-errors')
  if ($del.Code -ne 0) { Exit-WithHint ("Deleting the Static Web App failed: {0}" -f $del.Err) 'You need Contributor on the resource group. Re-run when fixed.' }
  Write-Ok ("Static Web App '{0}' deleted" -f $SwaName)
} else {
  Write-Info ("Static Web App '{0}' not found (already gone)" -f $SwaName)
}

$budgetUrl = "/subscriptions/$subId/resourceGroups/$ResourceGroup/providers/Microsoft.Consumption/budgets/$($BudgetName)?api-version=2023-11-01"
$bs = Invoke-Native -Exe 'az' -Arguments @('rest', '--method', 'get', '--url', $budgetUrl, '--query', 'name', '-o', 'tsv', '--only-show-errors')
if ($bs.Code -eq 0 -and $bs.Out) {
  $bd = Invoke-Native -Exe 'az' -Arguments @('rest', '--method', 'delete', '--url', $budgetUrl, '--only-show-errors')
  if ($bd.Code -ne 0) { Write-Warn2 ("Deleting the budget failed: {0}" -f $bd.Err) } else { Write-Ok ("budget '{0}' deleted" -f $BudgetName) }
} else {
  Write-Info ("budget '{0}' not found (already gone or never created)" -f $BudgetName)
}

if ($RemoveGitHubSecret) {
  if (Get-Command gh -ErrorAction SilentlyContinue) {
    $gs = Invoke-Native -Exe 'gh' -Arguments @('secret', 'delete', 'AZURE_STATIC_WEB_APPS_API_TOKEN', '--repo', $Repo)
    if ($gs.Code -eq 0) { Write-Ok 'GitHub secret removed' } else { Write-Warn2 ("Could not remove the GitHub secret: {0}" -f $gs.Err) }
  } else {
    Write-Warn2 ("gh not found: remove AZURE_STATIC_WEB_APPS_API_TOKEN at https://github.com/{0}/settings/secrets/actions" -f $Repo)
  }
}
Write-Host ''
Write-Host 'Teardown done. The Foundry account and model deployment were not touched.' -ForegroundColor Green
