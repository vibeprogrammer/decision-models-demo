# Demo script: decision model vs regular LLM, live

About two minutes. Two ways to show it: the web page (easiest) or the terminal.

## The web page

Open https://delightful-island-0738f7203.3.azurestaticapps.net. Before you press anything it shows a recorded live run, so the page is never empty.

| Do | What appears | Say |
| --- | --- | --- |
| Tab **Triage issues**, press **Run live** | Two clocks start. Both models answer eight GitHub issues, item by item, side by side. The decision model's lane finishes first. | "Same eight issues, same questions, both models live. Left: a decision model. Right: a regular LLM writing JSON. Watch the clocks." |
| Point at a row | Decision model: the action, a confidence bar, its latency bar. LLM: the action, "no probability", a longer latency bar. | "Both got it right. But only one tells me how sure it is, and that's what my code needs to decide when to escalate to a human." |
| The line under the clocks | `Decision model: 4× faster per decision ... fewer output tokens, and a probability to act on.` | "Per decision that's a few hundred milliseconds against more than a second. An agent makes dozens of these per task." |
| Open **Example JSON** | The real request and response of both models for the first item. | "No prompt engineering on the left: typed questions in, a probability for every option out." |
| Scroll to **All four use cases** | Median latency per call and correct answers for triage, gate, rank and route. | "Same picture on every use case." |

Limits: 10 live runs per minute per visitor and 500 model calls a day across both models (a triage run is 16 calls). Over the limit the page says so and keeps showing the recorded run.

## The terminal

Set the key **before** you share your screen (a `.env` file, or the PowerShell lines below in a terminal nobody sees). Never type the key in front of an audience.

```powershell
cd decision-models-demo
git pull
$env:AZURE_DECISION_ENDPOINT = "https://proj-middagskos-resource.services.ai.azure.com/providers/microsoft/v1/systemone"
$env:AZURE_DECISION_DEPLOYMENT = "dep-decision-1"
$env:AZURE_LLM_DEPLOYMENT = "dep-gpt-6-luna"
$env:AZURE_DECISION_KEY = "<paste-key>"
npm run azure:check
```

`azure:check` sends one small request three times and prints measured latency. 401: key wrong. 404 `DeploymentNotFound` or 422: deployment name wrong (the check lists the names it can see). Other 404: endpoint wrong.

| Type | What appears | Say |
| --- | --- | --- |
| `npm run azure:triage` | Each issue with three answers: kind (a bar per option), severity, P(needs human), the action the code took, and the ms of that call | "One request, three questions: what kind, how bad, does a human need to see it. No text comes back, just a probability for every option." |
| `npm run azure:gate` | Seven tool calls, a risk score each, `allow` / `ask` / `block` | "The agent wants to force-push to main. The model scores the risk. My code, not the model, turns the score into allow, ask or block." |
| `npm run azure:rank` | Four candidate fixes, sorted by a composite score; `-> merge candidate ...` | "One fix just deleted the assertion. A yes/no question, 'did it weaken the test?', sinks it." |
| `npm run compare:azure` | A table: both models, correct answers, median latency, tokens, parse errors, probabilities yes/no | "Same questions to a regular LLM. Both measured here, live." |

## If something goes wrong

- No network or the key fails: the error has a hint. The web page keeps showing its recorded run.
- `demo:azure` with no key set prints `NOTE: ... Falling back to MOCK mode.` That's the offline stand-in for the decision model, not the real one, so check the first lines. `compare:azure` never falls back: without both models it says what to set.

## Honest notes for Q&A

- The scenario data and labels were written for this demo. A model may disagree with a label on a borderline item. That's the point of calibrated probabilities: low confidence goes to a human.
- GPT-6 Luna runs in its fastest setting (`reasoning_effort: none`, `temperature: 0`, JSON mode, at most 300 output tokens), with a prompt that spells out the JSON format. More reasoning would make it slower, not faster.
- Latency includes the network round trip to the Azure region. It is not the model's compute time alone.
