// Prices used for the cost comparison on the page. One place to update them.
//
// Both models, pay-as-you-go, the Global (Global Standard) deployment type, USD per 1M tokens,
// as published on the date below. Checked against two official sources:
//  - Azure Retail Prices API (https://prices.azure.com/api/retail/prices)
//      Decision-1:  productName eq 'Microsoft Decision Models', meter "Microsoft Decision 1 1M Tokens"
//                   (armSkuName "Pi 1 glbl"; one price, the same in all 37 regions listed)
//      GPT-6 Luna:  productName eq 'Azure OpenAI GPT6', meters "6-luna ShortCo Inp|Cd Inp|Cd Wr|Opt Std Gl 1M Tokens"
//                   (Std Gl = Global Standard, ShortCo = short context; the same in all 26 regions listed)
//      EUR figures: the same query with currencyCode='EUR' (Azure's own conversion).
//  - The pricing pages: https://azure.microsoft.com/en-us/pricing/details/ai-foundry-models/microsoft/
//    (Microsoft-Decision-1: input $0.042, cached input N/A, output N/A = output tokens are not billed) and
//    https://azure.microsoft.com/en-us/pricing/details/azure-openai/ ("GPT-6 Luna (short context) Global").
// Every demo call is a few hundred tokens, so the short-context tier applies, and the prompts are below
// the 1,024-token minimum for prompt caching (the API reports cached_tokens; they are priced if present).
// Taxes, discounts, Data Zone / Provisioned / Flex deployments and the free Azure credits are not included.

export const PRICES = {
  asOf: "2026-11-01",
  currency: "USD",
  deploymentType: "Global Standard (pay-as-you-go)",
  sources: [
    { label: "Azure Retail Prices API", url: "https://prices.azure.com/api/retail/prices" },
    { label: "Foundry Models pricing (Microsoft models)", url: "https://azure.microsoft.com/en-us/pricing/details/ai-foundry-models/microsoft/" },
    { label: "Azure OpenAI pricing", url: "https://azure.microsoft.com/en-us/pricing/details/azure-openai/" },
  ],
  models: {
    decision: {
      name: "Microsoft-Decision-1",
      deployment: "Global",
      perMillion: { input: 0.042, cachedInput: null, output: 0 },
      eurPerMillion: { input: 0.037, cachedInput: null, output: 0 },
      note: "input only; output tokens are not billed",
    },
    llm: {
      name: "GPT-6 Luna (short context)",
      deployment: "Global",
      perMillion: { input: 0.1, cachedInput: 0.01, cacheWrite: 0.125, output: 0.5 },
      eurPerMillion: { input: 0.088, cachedInput: 0.0088, cacheWrite: 0.11, output: 0.44 },
      note: "reasoning tokens are billed as output",
    },
  },
};

// Cost in USD of one call, from the usage the API measured: {input, output, cached?}.
// Cached input tokens are part of input and are priced at the cached rate when the model has one.
export function callCost(lane, usage) {
  const p = PRICES.models[lane]?.perMillion;
  if (!p || !usage || usage.input == null) return null;
  const cached = Math.min(usage.cached ?? 0, usage.input);
  const fresh = usage.input - cached;
  const cachedRate = p.cachedInput ?? p.input;
  return (fresh * p.input + cached * cachedRate + (usage.output ?? 0) * p.output) / 1e6;
}
