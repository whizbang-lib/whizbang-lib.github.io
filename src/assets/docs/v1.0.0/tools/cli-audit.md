---
title: Auditing Whizbang Packages
pageType: guide
audience: [consumer]
status: current
version: 1.0.0
category: Tools
order: 10
description: >-
  Check the Whizbang package versions a project actually resolves against
  published security advisories with `whizbang audit`, and fail a CI build on
  an affected version.
tags: >-
  security, advisories, audit, cve, ghsa, osv, cli, ci, github actions,
  vulnerabilities
codeReferences:
  - tools/Whizbang.CLI/Audit/AuditCommand.cs
  - tools/Whizbang.CLI/Audit/ProjectAssetsReader.cs
  - tools/Whizbang.CLI/Audit/OsvClient.cs
  - tools/Whizbang.CLI/Audit/AuditReport.cs
  - tools/Whizbang.CLI/Audit/AuditReportFormatter.cs
  - tools/Whizbang.CLI/Program.cs
testReferences:
  - tests/Whizbang.CLI.Component.Tests/Audit/AuditCommandTests.cs
  - tests/Whizbang.CLI.Component.Tests/Audit/ProjectAssetsReaderTests.cs
  - tests/Whizbang.CLI.Tests/Audit/OsvClientTests.cs
  - tests/Whizbang.CLI.Component.Tests/Audit/AuditReportTests.cs
  - tests/Whizbang.CLI.Tests/Audit/AuditReportFormatterTests.cs
---

# Auditing Whizbang Packages

`whizbang audit` answers one question: **does a published security advisory affect a Whizbang package version this project uses?** It reads the versions restore resolved, asks the [OSV database](https://osv.dev) about exactly those versions, and prints what it found and which version to upgrade to. Its exit code makes it a CI gate.

It runs only when you run it. The Whizbang libraries never check for advisories at startup or at run time.

## Running it

The command ships in the Whizbang CLI tool (package `SoftwareExtravaganza.Whizbang.CLI`, command `whizbang`), in versions that list `audit` in `whizbang --help`. Run it after `dotnet restore`, from the folder that holds your projects or pointed at one:

```bash{title="Audit the projects under the current folder" description="Restores, then checks every project under the current directory against published advisories." category="Tools" difficulty="BEGINNER" tags=["cli", "audit", "security", "advisories"]}
dotnet restore
whizbang audit
```

```bash{title="Audit one solution with a stricter threshold" description="Checks every project the solution lists and fails only on high or critical advisories." category="Tools" difficulty="BEGINNER" tags=["cli", "audit", "solution", "fail-on"]}
whizbang audit --project ./MyService.slnx --fail-on high
```

| Option | Meaning | Default |
|--------|---------|---------|
| `--project`, `-p <path>` | A project file, a `.sln` or `.slnx` solution (every project it lists), or a directory (every project under it) | The current directory |
| `--fail-on <level>` | The lowest severity that fails the audit: `low`, `moderate`, `high`, `critical`, or `none` to report without failing | `moderate` |
| `--timeout <seconds>` | How long to wait for OSV, across every request, before giving up | `15` |
| `--json` | Write the report as JSON instead of a table | Off |
| `--help`, `-h` | Show the command's help | |

## What it checks

1. **The versions your build actually uses.** For each project, the command reads `obj/project.assets.json`, the file `dotnet restore` writes. It lists every package restore resolved for every target framework, **transitive packages included**. A project that references only `SoftwareExtravaganza.Whizbang.Data.EFCore.Postgres` still uses `Whizbang.Core`, `Whizbang.Data.Postgres` and others underneath, and an advisory against any of them ships in your build. The command keeps only `SoftwareExtravaganza.Whizbang.*` packages. Project references (building Whizbang from source) are not published packages and are left out. If a project has not been restored, the command says to run `dotnet restore` first and exits with code 2. It does not guess.
2. **The advisories that affect exactly those versions.** It sends one batch query to `https://api.osv.dev` for every package and version, follows OSV's paging, and fetches each advisory it reports. OSV carries the GitHub-reviewed advisories that NuGet Audit and Dependabot also report, and this site's [Security Advisories](../fundamentals/security/security-advisories.md) page is generated from the same OSV records. The requests are anonymous: no token and no credentials. That also guarantees that only **published** advisories are reported, never drafts.
3. **The upgrade target.** For each advisory, the command reports the nearest fixed version above the one you resolve. It reads that version only from the advisory's entry for that package, so an advisory that covers several packages, Whizbang or not, cannot point you at another package's fix.

Other packages in your build are outside this command's scope. NuGet Audit (the `NU1901` to `NU1904` warnings `dotnet restore` raises) already covers every package, Whizbang included. Use `whizbang audit` when you want an explicit, Whizbang-only gate with exit codes that tell "affected" apart from "could not check", whatever your NuGet Audit settings are.

## Output

With nothing to report:

```text
No published advisory affects the Whizbang packages this project uses (5 packages checked).
```

When an advisory applies, a table lists each affected package version, then each advisory's summary and link, then a verdict against `--fail-on`:

```text
Package                             Version   Advisory                              Severity  Upgrade to
SoftwareExtravaganza.Whizbang.Core  0.2615.0  GHSA-xxxx-xxxx-xxxx (CVE-2026-NNNNN)  high      0.2616.0 or later

GHSA-xxxx-xxxx-xxxx: <the advisory's summary>
  https://osv.dev/vulnerability/GHSA-xxxx-xxxx-xxxx

1 advisory affects the Whizbang packages this project uses (5 packages checked). 1 at or above moderate: the audit fails.
```

An advisory with no published fix says `no fixed version published` in the last column. An advisory whose record carries no severity is shown as `unknown`, and it fails the audit at every threshold except `none`, because a missing severity is not evidence of a harmless advisory.

`--json` writes the same report as JSON, with nothing else on standard output, so it can be piped or saved:

```json{title="The --json report" description="Every package version checked, and every finding with all of its keys; a missing CVE, summary or fix is null." category="Tools" difficulty="BEGINNER" tags=["cli", "audit", "json", "report"]}
{
  "packagesChecked": 5,
  "failOn": "moderate",
  "fails": true,
  "packages": [
    { "id": "SoftwareExtravaganza.Whizbang.Core", "version": "0.2615.0" }
  ],
  "findings": [
    {
      "package": "SoftwareExtravaganza.Whizbang.Core",
      "version": "0.2615.0",
      "advisoryId": "GHSA-xxxx-xxxx-xxxx",
      "cve": "CVE-2026-NNNNN",
      "severity": "high",
      "summary": "<the advisory's summary>",
      "fixedVersion": "0.2616.0",
      "url": "https://osv.dev/vulnerability/GHSA-xxxx-xxxx-xxxx"
    }
  ]
}
```

## Exit codes

| Code | Meaning |
|------|---------|
| `0` | No advisory at or above `--fail-on` affects the packages checked. Advisories below the threshold are still listed. |
| `1` | At least one advisory at or above `--fail-on` affects a package version the project uses. |
| `2` | **The check could not run**: no restore output, OSV unreachable, answering with an error, or slower than `--timeout`, or bad arguments. Nothing is known about the packages. |

A failed check is never reported as "no advisories". Code `2` fails a CI step just as code `1` does. That is deliberate: a check that did not run must not pass. A pipeline that wants to tell the two apart, for example to retry on `2`, can branch on the code.

## In GitHub Actions

Run the audit on pull requests and on a schedule. A new advisory can be published against a version you already ship, so a build that passed last week can fail today without any change on your side.

```yaml{title="GitHub Actions: audit Whizbang packages on every PR and weekly" description="Restores the solution, installs the Whizbang CLI and fails the job when an advisory at or above moderate affects a resolved Whizbang package." category="Tools" difficulty="BEGINNER" tags=["github-actions", "ci", "audit", "security"]}
name: Whizbang advisory audit

on:
  pull_request:
  schedule:
    - cron: '0 6 * * 1'   # Mondays 06:00 UTC: catch advisories published after you shipped

permissions:
  contents: read

jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-dotnet@v5
        with:
          dotnet-version: '10.0.x'
      - run: dotnet restore
      - run: dotnet tool install --global SoftwareExtravaganza.Whizbang.CLI
      # Exit 1: an advisory at or above the threshold. Exit 2: the check could not run.
      - run: whizbang audit --fail-on moderate
```

The job needs no secrets and no token. For a reproducible build, pin the tool with `--version` (or a local tool manifest) and move the pin when you upgrade Whizbang. To keep the report as a build artifact, write it with `--json`:

```yaml{title="Keep the JSON report as an artifact" description="Saves the audit report even when the audit fails the job." category="Tools" difficulty="INTERMEDIATE" tags=["github-actions", "ci", "audit", "artifact"]}
      - run: whizbang audit --json > whizbang-audit.json
      - if: always()
        uses: actions/upload-artifact@v4
        with:
          name: whizbang-audit
          path: whizbang-audit.json
```

## See also

- [Security Advisories](../fundamentals/security/security-advisories.md): every published advisory against a Whizbang package, generated from OSV.
- The repository's [security policy](https://github.com/whizbang-lib/whizbang/blob/main/SECURITY.md), for reporting a vulnerability privately.
