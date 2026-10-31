import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";

const deploy = fileURLToPath(new URL("../infra/deploy.ps1", import.meta.url));
const fakeKey = "test-only-key-not-a-credential";
const fakeToken = "test-only-token-not-a-credential";
const currentRun = { databaseId: 3, createdAt: "2026-10-31T17:19:16-05:00", event: "workflow_dispatch" };

function runDeployment(shell, { keyError = "", workflowRuns, noWait = false } = {}) {
  const workflow = workflowRuns !== undefined;
  // realpath: GitHub's Windows runners use a short 8.3 TEMP path (RUNNER~1) while
  // PowerShell reports the long one, so the mocked-CLI check would never match.
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), "decision-key-preflight-")));
  try {
    // Match az.cmd's parenthesized launcher so unquoted length(key1) fails as on real Windows.
    writeFileSync(join(dir, "az.cmd"), `@echo off\r\nif exist "%~dp0mock-az.cjs" (\r\n  "${process.execPath}" "%~dp0mock-az.cjs" %*\r\n) else (\r\n  exit /b 1\r\n)\r\n`);
    writeFileSync(join(dir, "mock-az.cjs"), `
const args = process.argv.slice(2);
const starts = (...parts) => parts.every((part, i) => args[i] === part);
const fail = (message) => { console.error("ERROR: " + message); process.exit(1); };
if (starts("version")) console.log(JSON.stringify({ "azure-cli": "fixture" }));
else if (starts("bicep", "version")) console.log("Bicep CLI fixture");
else if (starts("account", "show")) console.log(JSON.stringify({ id: "test-subscription", name: "fixture", user: { name: "fixture" } }));
else if (starts("group", "exists")) console.log("true");
else if (starts("cognitiveservices", "account", "show")) console.log("test-foundry");
else if (starts("cognitiveservices", "account", "keys", "list")) {
  if (process.env.TEST_KEY_ERROR) fail(process.env.TEST_KEY_ERROR);
  const format = args[args.indexOf("--output") + 1];
  if (format !== "none") console.log(JSON.stringify({ key1: ${JSON.stringify(fakeKey)}, key2: ${JSON.stringify(fakeKey)} }));
}
else if (starts("cognitiveservices", "account", "deployment", "show")) console.log("Microsoft-Decision-1");
else if (starts("deployment", "group", "create")) {
  if (!process.env.TEST_WORKFLOW_RUNS) fail("STOP_AFTER_PREFLIGHT");
  if (args[args.indexOf("--template-file") + 1].endsWith("main.bicep")) {
    console.log(JSON.stringify({ defaultHostname: { value: "fixture.azurestaticapps.net" } }));
  } else if (!args.includes("startDate=2026-09-01")) fail("The budget must preserve its existing start date");
}
else if (starts("rest")) console.log("2026-09-01T00:00:00Z");
else if (starts("staticwebapp", "secrets", "list")) console.log(${JSON.stringify(fakeToken)});
else fail("Unexpected mock command: " + args.join(" "));
`);
    if (workflow) {
      writeFileSync(join(dir, "gh.cmd"), `@echo off\r\n"${process.execPath}" "%~dp0mock-gh.cjs" %*\r\n`);
      writeFileSync(join(dir, "mock-gh.cjs"), `
const { readFileSync } = require("node:fs");
const args = process.argv.slice(2);
const starts = (...parts) => parts.every((part, i) => args[i] === part);
if (starts("auth", "status") || starts("workflow", "run")) {}
else if (starts("secret", "set", "AZURE_STATIC_WEB_APPS_API_TOKEN")) {
  if (readFileSync(0, "utf8").trim() !== ${JSON.stringify(fakeToken)}) process.exit(1);
}
else if (starts("run", "list")) console.log(process.env.TEST_WORKFLOW_RUNS);
else if (starts("run", "watch")) {
  if (args[2] !== "3") { console.error("Watched the wrong workflow run"); process.exit(1); }
}
else { console.error("Unexpected mock command: " + args.join(" ")); process.exit(1); }
`);
    }
    const harness = join(dir, "run-preflight.ps1");
    writeFileSync(harness, `
$ErrorActionPreference = 'Stop'
if ((Get-Command az -ErrorAction Stop).Source -ne (Join-Path $PSScriptRoot 'az.cmd')) {
  throw 'The test must use the mocked Azure CLI, never a real Azure session.'
}
${workflow ? `
if ((Get-Command gh -ErrorAction Stop).Source -ne (Join-Path $PSScriptRoot 'gh.cmd')) {
  throw 'The test must use the mocked GitHub CLI, never a real GitHub session.'
}
function Get-Date {
  param([string]$Format)
  $now = [DateTime]::Parse('2026-10-31T22:19:16Z', [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::RoundtripKind)
  if ($Format) { return $now.ToString($Format, [Globalization.CultureInfo]::InvariantCulture) }
  return $now
}
function Start-Sleep { param([int]$Seconds) }
function Invoke-RestMethod {
  return [pscustomobject]@{ live = $true; deployment = 'dep-decision-1'; limits = @{ perIpPerMinute = 10; dailyCallCap = 500 } }
}
` : ""}
& '${deploy.replaceAll("'", "''")}' -Yes ${workflow ? `-BudgetEmail alerts@example.com ${noWait ? "-NoWait" : ""}` : "-SkipGitHub"}
exit $LASTEXITCODE
`);
    const result = spawnSync(shell, [
      "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
      "-File", harness,
    ], {
      encoding: "utf8",
      timeout: 30000,
      windowsHide: true,
      env: {
        ...process.env,
        PATH: dir + delimiter + process.env.PATH,
        TEST_KEY_ERROR: keyError,
        TEST_WORKFLOW_RUNS: workflow ? JSON.stringify(workflowRuns) : "",
      },
    });
    assert.equal(result.error, undefined);
    assert.equal(result.status, workflow ? 0 : 1, result.stdout + result.stderr);
    const output = result.stdout + result.stderr;
    assert.ok(!output.includes(fakeKey), "The preflight must not print either key");
    assert.ok(!output.includes(fakeToken), "The deployment must not print its token");
    return output;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

for (const shell of ["powershell.exe", "pwsh.exe"]) {
  test(`${shell}: key access passes the Windows launcher without exposing keys`, { skip: process.platform !== "win32" }, () => {
    const output = runDeployment(shell);
    assert.match(output, /key access confirmed/);
    assert.match(output, /STOP_AFTER_PREFLIGHT/);
    assert.doesNotMatch(output, /Your account needs/);
  });

  test(`${shell}: an Azure authorization failure identifies the account permission`, { skip: process.platform !== "win32" }, () => {
    const output = runDeployment(shell, { keyError: "(AuthorizationFailed) The client does not have authorization to list keys." });
    assert.match(output, /Microsoft\.CognitiveServices\/accounts\/listKeys\/action on proj-middagskos-resource/);
    assert.doesNotMatch(output, /key access confirmed|STOP_AFTER_PREFLIGHT/);
  });

  test(`${shell}: a CLI failure is not reported as missing Azure permissions`, { skip: process.platform !== "win32" }, () => {
    const output = runDeployment(shell, { keyError: "argument --output: invalid choice" });
    assert.match(output, /argument --output: invalid choice/);
    assert.match(output, /Fix the error above and re-run/);
    assert.doesNotMatch(output, /Your account needs|key access confirmed|STOP_AFTER_PREFLIGHT/);
  });

  test(`${shell}: multiple workflow runs select only the recent dispatch in UTC`, { skip: process.platform !== "win32" }, () => {
    const output = runDeployment(shell, {
      workflowRuns: [
        { databaseId: 1, createdAt: "2026-10-31T22:19:16Z", event: "push" },
        { databaseId: 2, createdAt: "2026-10-31T23:00:00+01:00", event: "workflow_dispatch" },
        currentRun,
      ],
      noWait: true,
    });
    assert.match(output, /follow it at https:\/\/github\.com\/[^ ]+\/actions\/runs\/3/);
    assert.match(output, /Done\. Web demo: https:\/\/fixture\.azurestaticapps\.net/);
  });

  test(`${shell}: a single workflow run is watched and the live site is checked`, { skip: process.platform !== "win32" }, () => {
    const output = runDeployment(shell, { workflowRuns: [currentRun] });
    assert.match(output, /watching run 3/);
    assert.match(output, /deploy workflow succeeded/);
    assert.match(output, /API live on deployment dep-decision-1/);
  });

  test(`${shell}: an empty workflow run list falls back to the Actions link`, { skip: process.platform !== "win32" }, () => {
    const output = runDeployment(shell, { workflowRuns: [], noWait: true });
    assert.match(output, /Could not find the run; follow it at https:\/\/github\.com\/[^ ]+\/actions/);
    assert.match(output, /Done\. Web demo: https:\/\/fixture\.azurestaticapps\.net/);
  });
}
