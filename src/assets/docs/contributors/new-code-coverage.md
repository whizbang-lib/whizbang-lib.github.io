---
title: Keeping New Code at 100% Coverage and Zero Sonar Findings
pageType: guide
audience: [contributor]
status: current
order: 4
description: The standard for every pull request, every line a PR adds to the library is executed by a test and no Sonar finding stays open on it, and the repository recipe that saves one report of the checks, the findings and the uncovered lines, for people and for an AI assistant alike
tags: contributing, coverage, tdd, ci, sonarcloud, pull-requests, ai-assistant
---

# Keeping New Code at 100% Coverage and Zero Sonar Findings

The quality gate passes at 80% coverage on new code and on ratings alone. The standard this project holds is stricter: **every line a pull request adds to the library is executed by a test**, and **no Sonar finding of any type or severity stays open on the new code**, code smells and analyzer suggestions included. The 3% a gate would let through is exactly where defects hide: cancellation rethrows, failure logs, defensive returns, the branch taken only when something went wrong.

This page is the procedure, and it is written for two readers: a contributor at a terminal, and the AI assistant a contributor works with. Everything below is a script in the repository, so the procedure improves in one place rather than living in anyone's memory or notes. The scripts print a human report by default and JSON with `-Json` for an assistant to parse.

## What CI does on every pull request

The Quality job merges every test suite's coverage report and submits the Sonar analysis, then:

1. Computes the **uncovered new lines**: each line the PR adds under `src/` that the merged report knows about and that no test executed. This is the same list SonarCloud shows as "uncovered new lines"; the counts agree.
2. Waits for the Sonar analysis of this run and lists **every open finding on the new code**: bugs, vulnerabilities, code smells, analyzer suggestions surfaced as issues, and hotspots to review.
3. Uploads both lists as the `pr-quality-gate` artifact and posts them in one comment on the PR (updated in place on every run).
4. **Fails the job when either list is not empty.**

The per-suite coverage reports (`coverage-unit`, `coverage-postgres-efcore-1` to `-4`, `coverage-postgres-dapper`, `coverage-azureblob`, `coverage-rabbitmq`, `coverage-servicebus-*`) are artifacts too, so the whole computation can be reproduced locally.

## The recipe and the three scripts

`scripts/Invoke-PrHealth.ps1 -PullRequest <n>` runs the whole recipe and saves one report under `.whizbang/cache/pr-health/` (the ignored cache): the checks, the Sonar gate and findings, and the uncovered new lines, with a verdict and an exit code of 0 only when everything is clean. It is the loop a contributor or an assistant runs: run, read, fix, push, run again. The three scripts underneath answer one question each; all run with PowerShell Core on any platform, `gh` must be authenticated, and each takes `-OutFile` to save its report.

| Script | What it answers |
|---|---|
| `Watch-PrChecks.ps1 -PullRequest <n>` | Which checks have settled and how. Prints each check as it lands, exits 0 when all passed, 1 when any failed (with links), 2 on timeout. `-Once` for a snapshot. |
| `Get-SonarPrFindings.ps1 -PullRequest <n>` | The Sonar gate's conditions and every open finding of any type on new code, grouped by file. `-WaitForAnalysis` waits for the analysis the scanner just submitted; `-FailOnAny` is what CI passes. Works without a token. |
| `Find-UncoveredNewLines.ps1 -CoverageRoot <dir> -BaseRef origin/develop [-DownloadFromRun <run id>]` | The lines to cover. With `-DownloadFromRun` it first downloads every coverage artifact of that CI run; the run id is in the "CI Result" check's link. `-FailOnAny` is what CI passes. |

```bash{
title: "Reproduce the coverage gate for a pull request"
description: "Download the CI run's coverage artifacts and list every new library line that no test executed, exactly as the Quality job does."
category: "Contributing"
difficulty: "BEGINNER"
tags: ["coverage", "pull-requests", "ci"]
}
pwsh scripts/Invoke-PrHealth.ps1 -PullRequest 732            # the whole recipe, one saved report
pwsh scripts/Watch-PrChecks.ps1 -PullRequest 732 -Once
pwsh scripts/Get-SonarPrFindings.ps1 -PullRequest 732
pwsh scripts/Find-UncoveredNewLines.ps1 -CoverageRoot coverage-ci -BaseRef origin/develop -DownloadFromRun 34273934997
```

The same computation runs against a local coverage run: point `-CoverageRoot` at the directory your test runs wrote their `*.cobertura.xml` into.

## How to cover a line

The lines the gate reports are rarely the happy path. They are the branches a test has to reach on purpose:

- **A latency or cadence branch** (a claim that took too long, a beat that came late): inject a `TimeProvider` and drive it with `FakeTimeProvider` from `Microsoft.Extensions.TimeProvider.Testing`. Never wait on real time in a test.
- **A failure log** (the catch that records what went wrong and carries on): a fake dependency that throws the exception the catch handles, and an `ILogger` that collects entries so the test asserts the log line.
- **A cancellation rethrow** (`catch (OperationCanceledException) when (token.IsCancellationRequested) { throw; }`): a fake that cancels the token and throws `OperationCanceledException(token)`; assert the loop or tick ends and nothing was logged as a failure.
- **A defensive return that a contract makes unreachable** (a database function declared to return exactly one row): do not leave it red and do not test around it. Restructure so the unreachable guard disappears, and say why in a comment. That is the only kind of removal coverage may cause; behavior is never deleted to make a number green.
- **A public member nothing calls**: it is an unwired member, not a coverage gap. Remove it, or wire it and test the caller.

`ai-docs/tdd-strict.md` and `ai-docs/coverage-exclusions.md` in the library repository carry the finer rules, including when `[ExcludeFromCodeCoverage]` is legitimate (rarely, and never on a method that has any tested behavior).

## Sonar findings

Every open finding on the new code is fixed at its source, tests included, or resolved with a written reason where the rule is wrong for the case. The finding that most often needs a reason is S2077 on a SQL string that interpolates a **schema-qualified function name**. That name is a validated constant, never input, and a function name cannot be a bind parameter, so the accepted fix is the documented `#pragma warning disable S2077` with the reason on the line, the way the coordinators do it. A finding on anything that is actually input is fixed at its source.

## For an AI assistant

The library repository ships a `/pr-health <n>` command (`.claude/commands/pr-health.md`) that runs `Invoke-PrHealth.ps1`, reads the saved report, fixes what it lists (failed checks, Sonar findings, uncovered lines), re-runs the affected test projects one at a time, and goes around again. An assistant working on a PR should reach for that command rather than polling the checks page, querying Sonar by hand, or reconstructing coverage from memory; the saved report is the record of what was checked. When you make one of the scripts better, every contributor's assistant gets the improvement.
