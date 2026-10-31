# Demo script: Microsoft-Decision-1, live

About 90 seconds, slide 8 ("Demo: four decisions inside a coding agent"). Font size up, terminal in the repo folder.

## Before the talk (at the venue, on the laptop you present from)

1. Set the key **before** you share your screen (a `.env` file, or the PowerShell lines below in a terminal nobody sees). Never type the key on stage.

   ```powershell
   cd decision-models-demo
   git pull
   $env:AZURE_DECISION_ENDPOINT = "https://proj-middagskos-resource.services.ai.azure.com/providers/microsoft/v1/systemone"
   $env:AZURE_DECISION_DEPLOYMENT = "dep-decision-1"
   $env:AZURE_DECISION_KEY = "<paste-key>"
   ```

2. Preflight. It sends one small request three times and prints measured latency. Expect `OK`, the model name the API reports, and three latencies (the first one is higher: connection setup).

   ```powershell
   npm run azure:check
   ```

   401: key wrong. 404 `DeploymentNotFound` or 422: deployment name wrong, set `$env:AZURE_DECISION_DEPLOYMENT` (the check lists the names it can see). Other 404: endpoint wrong.

3. Run the full demo once (`npm run demo:azure`) and keep that terminal output, or a screenshot of it, as your fallback. Note the median latency you see on the venue Wi-Fi.
   For reference, the GitHub Actions run on 2026-10-31 (US runner): 21/21 correct, median 218 to 287 ms per request, first call about 1.1 s.
4. Clear the screen: `cls` (cmd/PowerShell) or `clear`.

## On stage

| Type | What appears | Say |
| --- | --- | --- |
| `npm run azure:triage` | `LIVE: proj-middagskos-resource...`, then each issue with three answers: kind (a bar per option), severity, P(needs human), and the action my code took, with the ms of that call | "This is the real Microsoft-Decision-1 on my Azure. One request, three questions: what kind, how bad, does a human need to see it. No text comes back, just a probability for every option. And look at the milliseconds." |
| `npm run azure:gate` | Six tool calls, a risk score each, `allow` / `ask` / `block` | "The agent wants to force-push to main. The model scores the risk. My code, not the model, turns the score into allow, ask or block." |
| `npm run azure:rank` | Four candidate fixes, sorted by a composite score; `-> merge candidate ...` | "Four candidate fixes for a failing test. One just deleted the assertion. A yes/no question, 'did it weaken the test?', sinks it. All four scored in parallel." |
| (scroll to the bottom) | `--- latency (measured, N calls) ---  median ... p95 ...` | "These numbers are measured right here, over the conference Wi-Fi. Not a vendor slide." |

Optional if time allows: `npm run azure:route` (route a task to a small model, a frontier model or a human).

`npm run compare:azure` compares against a generative LLM. Unless `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL` are set, the LLM row is **simulated** and the output says so; say that out loud or skip it on stage.

## Option: the web page instead of the terminal

If the Static Web App is set up (`pwsh ./infra/deploy.ps1`, see infra/README.md), open its URL, pick a tab, press **Run live**. The badge at the top says LIVE and the deployment name; each decision shows its probabilities and its measured latency. Run it once before the talk. It allows 10 live runs per minute per IP; if you hit that, the page switches to labelled mock output. The terminal demo below stays the fallback.

## If something goes wrong

- No network or the key fails: the error has a hint. Switch to the fallback output from step 3, or run `npm run demo` (mock mode; the output says `MOCK MODE`, so say "this is the offline stand-in").
- `demo:azure` with no key set prints `NOTE: ... Falling back to MOCK mode.` That's the safety net: the demo never crashes, but it is not the real model, so check the first lines.

## Honest notes for Q&A

- The scenario data and labels were written for this demo. The real model may disagree with a label on a borderline item. That's the point of calibrated probabilities: low confidence goes to a human.
- Latency includes the network round trip from this laptop to the Azure region. It is not the model's compute time alone.
