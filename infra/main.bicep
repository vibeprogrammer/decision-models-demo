// Azure infrastructure for the decision-models-demo web demo, built for minimum cost:
//   - Azure Static Web App, Free plan, with its managed Azure Functions API (no separate
//     Function App, no hosting bill)
//   - the app settings the API reads (AZURE_DECISION_ENDPOINT, _DEPLOYMENT, _KEY, AZURE_LLM_DEPLOYMENT)
//   - the custom domain decision.isainative.dev (CNAME validation, free managed certificate)
//   - optional: a monthly Consumption budget on the resource group with email alerts
//
// The Foundry (AI Services) account that hosts the model is only READ here ("existing"):
// its key is read with listKeys() inside Azure, so it never passes through your terminal,
// a file or this template's outputs. Nothing on the Foundry account is created or changed.
//
// Deploy with infra/deploy.ps1 (recommended) or directly:
//   az deployment group create -g rg-middagskos -f infra/main.bicep -p budgetContactEmail=you@example.com

targetScope = 'resourceGroup'

@description('Name of the Static Web App.')
@minLength(2)
@maxLength(40)
param swaName string = 'swa-decision-demo'

@description('Region of the Static Web App (where its managed API runs). Static Web Apps is offered in westus2, centralus, eastus2, westeurope and eastasia only.')
@allowed([
  'westeurope'
  'eastus2'
  'centralus'
  'westus2'
  'eastasia'
])
param location string = 'westeurope'

@description('Name of the existing Foundry / AI Services account that hosts the model deployment.')
param foundryAccountName string = 'proj-middagskos-resource'

@description('Resource group of the Foundry account. Defaults to this resource group.')
param foundryResourceGroup string = resourceGroup().name

@description('Name of the model deployment on the Foundry account.')
param decisionDeployment string = 'dep-decision-1'

@description('Name of the regular LLM deployment (the comparison baseline) on the same Foundry account.')
param llmDeployment string = 'dep-gpt-6-luna'

@description('Decision endpoint. Empty = https://<foundry custom subdomain>.services.ai.azure.com/providers/microsoft/v1/systemone')
param decisionEndpoint string = ''

@description('Optional override for the API key. Empty (recommended) = read key1 from the Foundry account inside Azure.')
@secure()
param decisionKey string = ''

@description('Custom domain for the web demo. A CNAME from this name to the Static Web App\'s default hostname must exist first (DNS-only, not proxied). Empty = none.')
param customDomain string = 'decision.isainative.dev'

@description('Live runs per minute per visitor IP (the API returns 429 above it and the page keeps its recorded run).')
@minValue(1)
param rateLimitPerMinute int = 10

@description('Model calls per day across all visitors and both models.')
@minValue(1)
param dailyCallCap int = 500

@description('Email for the budget alerts. Empty = no budget is created.')
param budgetContactEmail string = ''

@description('Monthly budget amount, in the billing currency of the subscription.')
@minValue(1)
param budgetAmount int = 5

@description('Name of the budget.')
param budgetName string = 'budget-decision-demo'

@description('First day of the budget period (yyyy-MM-01). Keep the same value on re-deploys; deploy.ps1 reuses the existing budget\'s start date.')
param budgetStartDate string = utcNow('yyyy-MM-01')

@description('Tags for the created resources.')
param tags object = {
  project: 'decision-models-demo'
  purpose: 'demo'
  managedBy: 'bicep'
}

resource foundry 'Microsoft.CognitiveServices/accounts@2024-10-01' existing = {
  name: foundryAccountName
  scope: resourceGroup(foundryResourceGroup)
}

var endpoint = empty(decisionEndpoint)
  ? 'https://${foundry.properties.customSubDomainName}.services.ai.azure.com/providers/microsoft/v1/systemone'
  : decisionEndpoint

resource swa 'Microsoft.Web/staticSites@2024-04-01' = {
  name: swaName
  location: location
  tags: tags
  sku: {
    name: 'Free'
    tier: 'Free'
  }
  properties: {
    // No repository link: the GitHub workflow deploys with the deployment token.
    allowConfigFileUpdates: true
    stagingEnvironmentPolicy: 'Disabled'
  }
}

// Replaces the full set of app settings on every deploy (these are all the API needs).
resource swaSettings 'Microsoft.Web/staticSites/config@2024-04-01' = {
  parent: swa
  name: 'appsettings'
  properties: {
    AZURE_DECISION_ENDPOINT: endpoint
    AZURE_DECISION_DEPLOYMENT: decisionDeployment
    AZURE_DECISION_KEY: empty(decisionKey) ? foundry.listKeys().key1 : decisionKey
    AZURE_LLM_DEPLOYMENT: llmDeployment
    DEMO_RATE_PER_MIN: string(rateLimitPerMinute)
    DEMO_DAILY_CALL_CAP: string(dailyCallCap)
  }
}

// Free plan includes custom domains and their managed certificates.
resource domain 'Microsoft.Web/staticSites/customDomains@2024-04-01' = if (!empty(customDomain)) {
  parent: swa
  name: empty(customDomain) ? 'none' : customDomain
  properties: {
    validationMethod: 'cname-delegation'
  }
}

module budget 'budget.bicep' = if (!empty(budgetContactEmail)) {
  name: 'budget-${swaName}'
  params: {
    budgetName: budgetName
    amount: budgetAmount
    contactEmail: budgetContactEmail
    startDate: budgetStartDate
  }
}

@description('Default hostname of the web demo, e.g. nice-sea-0123.azurestaticapps.net')
output defaultHostname string = swa.properties.defaultHostname

@description('Name of the Static Web App.')
output name string = swa.name

@description('Endpoint written to AZURE_DECISION_ENDPOINT.')
output decisionEndpoint string = endpoint

@description('Custom domain bound to the web demo (empty = none).')
output customDomain string = customDomain

@description('Whether a budget was created or updated.')
output budgetCreated bool = !empty(budgetContactEmail)
