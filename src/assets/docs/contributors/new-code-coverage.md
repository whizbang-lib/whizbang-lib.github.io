---
title: Keeping New Code at 100% Coverage
pageType: guide
audience: [contributor]
status: current
order: 4
description: The standard for every pull request, every line a PR adds to the library is executed by a test, and the repository scripts that show which lines are not, watch the PR's checks, and read the Sonar findings, for people and for an AI assistant alike
tags: contributing, coverage, tdd, ci, sonarcloud, pull-requests, ai-assistant
---

# Keeping New Code at 100% Coverage

The quality gate passes at 80% coverage on new code. The standard this project holds is stricter: **every line a pull request adds to the library is executed by a test**, and the security rating on new code is A. The 3% a gate would let through is exactly where defects hide: cancellation rethrows, failure logs, defensive returns, the branch taken only when something went wrong.

This page is the procedure, and it is written for two readers: a contributor at a terminal, and the AI assistant a contributor works with. Everything below is a script in the repository, so the procedure improves in one place rather than living in anyone's memory or notes. The scripts print a human report by default and JSON with `-Json` for an assistant to parse.

## What CI does on every pull request

The Quality job merges every test suite's coverage report, then:

1. Computes the **uncovered new lines**: each line the PR adds under `src/` that the merged report knows about and that no test executed. This is the same list SonarCloud shows as "uncovered new lines"; the counts agree.
2. Uploads the list as the `uncovered-new-lines` artifact and posts it as a comment on the PR (updated in place on every run).
3. **Fails the job when the list is not empty.**

The per-suite coverage reports (`coverage-unit`, `coverage-postgres-efcore-1` to `-4`, `coverage-postgres-dapper`, `coverage-azureblob`, `coverage-rabbitmq`, `coverage-servicebus-*`) are artifacts too, so the whole computation can be reproduced locally.

## The three scripts

All three live in `scripts/` and run with PowerShell Core on any platform. `gh` must be authenticated.

| Script | What it answers |
|---|---|
| `Watch-PrChecks.ps1 -PullRequest <n>` | Which checks have settled and how. Prints each check as it lands, exits 0 when all passed, 1 when any failed (with links), 2 on timeout. `-Once` for a snapshot. |
| `Get-SonarPrFindings.ps1 -PullRequest <n>` | Why the Sonar gate failed: each failing condition with its actual value, and every open vulnerability, bug and hotspot with file, line, rule and message. Works without a token. |
| `Find-UncoveredNewLines.ps1 -CoverageRoot <dir> -BaseRef origin/develop [-DownloadFromRun <run id>]` | The lines to cover. With `-DownloadFromRun` it first downloads every coverage artifact of that CI run; the run id is in the "CI Result" check's link. `-FailOnAny` is what CI passes. |

```bash{
title: "Reproduce the coverage gate for a pull request"
description: "Download the CI run's coverage artifacts and list every new library line that no test executed, exactly as the Quality job does."
category: "Contributing"
difficulty: "BEGINNER"
tags: ["coverage", "pull-requests", "ci"]
}
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

## Security rating

The same gate requires the security rating on new code to be A. The finding that most often breaks it is S2077 on a SQL string that interpolates a **schema-qualified function name**. That name is a validated constant, never input, and a function name cannot be a bind parameter, so the accepted fix is the documented `#pragma warning disable S2077` with the reason on the line, the way the coordinators do it. A finding on anything that is actually input is fixed at its source.

## For an AI assistant

The library repository ships a `/pr-health <n>` command (`.claude/commands/pr-health.md`) that sequences the three scripts: wait for the checks, read the findings, list the uncovered lines, fix, re-run the affected test projects one at a time, and go around again. An assistant working on a PR should reach for that command rather than polling the checks page or reconstructing coverage by hand. When you make one of the scripts better, every contributor's assistant gets the improvement.
