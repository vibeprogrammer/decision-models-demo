// Azure Functions (Node.js v4 programming model), deployed as the managed API of the
// Static Web App. POST /api/decide {"scenario":"triage"} and GET /api/health.
// The key stays here (app setting AZURE_DECISION_KEY); the browser never sees it.
const { app } = require("@azure/functions");

let apiPromise;
const getApi = () => (apiPromise ||= import("../../core.mjs").then((m) => m.makeApi(process.env)));
const toFn = (r) => ({ status: r.status, headers: r.headers, body: r.body });

app.http("decide", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "decide",
  handler: async (request) => {
    const api = await getApi();
    const rawBody = await request.text();
    return toFn(await api.decide({ rawBody, headers: request.headers }));
  },
});

app.http("health", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "health",
  handler: async () => toFn((await getApi()).health()),
});
