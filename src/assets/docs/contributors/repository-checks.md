---
title: Repository Checks and Diagnostic IDs
pageType: reference
audience: [contributor]
status: current
order: 5
description: The build errors this repository raises on its own code and tests (WHIZ600 to WHIZ609), what each one protects, and how a new diagnostic gets its ID from the one registry of every WHIZ ID
tags: contributing, analyzers, diagnostics, testing, sharding, ci
---

# Repository Checks and Diagnostic IDs

Every build diagnostic in this repository has one ID form, `WHIZ` and three digits, and each ID is unique. The shipped generators and analyzers use most of the range. The **WHIZ600 to WHIZ699** block is for checks that guard this repository's own code and tests: they run in its builds and never ship in a package.

## The repository checks

| ID | Raised by | What it catches |
|---|---|---|
| [WHIZ600](../v1.0.0/operations/diagnostics/whiz600.md) | `Directory.Build.targets` | A test project declares no `WhizbangTestTags`. |
| [WHIZ601](../v1.0.0/operations/diagnostics/whiz601.md) | `Directory.Build.targets` | A test project declares no `WhizbangTestType`. |
| [WHIZ602](../v1.0.0/operations/diagnostics/whiz602.md) | `Directory.Build.targets` | A test project declares a `WhizbangTestType` no test runner knows. |
| [WHIZ603](../v1.0.0/operations/diagnostics/whiz603.md) | `Whizbang.TestAnalyzers` | `IsNotNull()` on a `Nullable<T>` subject, an assertion that cannot fail under the pinned TUnit. |
| [WHIZ604](../v1.0.0/operations/diagnostics/whiz604.md) | `Whizbang.RepoAnalyzers` | A `JsonDocument` created and dropped without being disposed. |
| [WHIZ605](../v1.0.0/operations/diagnostics/whiz605.md) | `Whizbang.TestAnalyzers` | A test class in a sharded test project without exactly one `Shard*` category. |
| [WHIZ606](../v1.0.0/operations/diagnostics/whiz606.md) | `Whizbang.RepoAnalyzers` | A settings property whose name says it holds a credential is a plain `string`. |
| [WHIZ607](../v1.0.0/operations/diagnostics/whiz607.md) | `Whizbang.RepoAnalyzers` | Library code reads a type, namespace or assembly name, or resolves a type from a string, outside the shared naming code. |
| [WHIZ608](../v1.0.0/operations/diagnostics/whiz608.md) | `Whizbang.RepoAnalyzers` | A suppression of WHIZ607 that does not say why. |
| [WHIZ609](../v1.0.0/operations/diagnostics/whiz609.md) | `Whizbang.TestAnalyzers` | A test class with an `[After(Test)]` hook that is also disposable, so TUnit tears it down twice. |

WHIZ600 to WHIZ604 were `WHZ0001` to `WHZ0005` until they moved into the single ID form. A suppression or severity setting that names an old ID no longer applies.

## WHIZ605: every test class runs in exactly one shard

CI splits a large test project across runners with `[Category=ShardN]` filters. A test class with no shard category matches no filter, so its tests stop running while every job stays green. A class with two shard categories runs twice.

A test project opts in with `<WhizbangShardedTests>true</WhizbangShardedTests>`. In an opted-in project, every non-abstract class with a `[Test]` method must carry exactly one `[Category("ShardN")]`, counting categories it inherits, or `[Category("Benchmark")]` and no shard, for classes the scheduled benchmark job runs instead.

```csharp
[Category("Shard5")]
public class IntegrityDeliverySqlTests : EFCoreTestBase {
  [Test]
  public async Task Lease_ReturnsDueDeliveriesInArrivalOrderAsync() {
    // ...
  }
}
```

The rule fails the build, so a new class without a shard is caught in the editor rather than after a CI run. `ShardCoverageGuardTests` checks the same rule at test time as a second line of defense.

{verified: ShardCategoryAnalyzerTests.TestClass_WithTwoShardCategories_ReportsBothShardsAsync, ShardCategoryAnalyzerTests.TestClass_WithExactlyOneShard_ReportsNothingAsync, ShardCategoryAnalyzerTests.ShardOnABaseClass_IsCountedForTheDerivedClassAsync, ShardCoverageGuardTests.EveryTestClass_DeclaresExactlyOneShardCategoryAsync}

## WHIZ607 and WHIZ608: type names come from one place

Every type name the library reads comes from the shared naming code (`TypeNameFormatter`, `EventTypeMatchingHelper`,
`TypeFormatter` and `MultiPassMessageTypeBinder` at runtime, `TypeNameUtilities` in the generators, each marked
`[TypeNameAuthority]`). WHIZ607 fails a library build that reads a name anywhere else, and WHIZ608 fails an exception
to it that does not say why. Both apply to projects under `src/` only. [Type Names in Library Code](type-naming.md)
lists which helper gives which form and the banned-symbol backstop.

{verified: TypeNameSourceAnalyzerTests.Descriptors_AreTheRepositoryRulesReportedAsErrorsAsync, TypeNameSourceAnalyzerTests.Runtime_ANameReadOffATypeOrAssembly_IsReportedAsync, TypeNameSourceAnalyzerTests.Suppression_WithoutAJustification_IsReportedAsync}

## Docs tags point at published pages {#docs-tag-targets}

Every `<docs>` tag in the code names a page on this site, and CI checks that the page and its anchor exist. The `Test · Pipeline scripts` job runs `.github/scripts/Test-DocsTagTarget.ps1`, which makes a shallow clone of this site's `develop` branch and resolves each tag the way the site does:

- **Pages** resolve as the router resolves them: `<path>.md`, then `<path>/_folder.md`, then `<path>/<leaf>.md`, in each version folder (newest first) and then at the root. Matching is case-sensitive. A page under `drafts/` does not count, because the site does not serve it at that address.
- **Anchors** follow the site's heading rule: the slug of the heading text, numbered duplicates (`-1`, `-2`), an explicit `{#id}`, or an HTML `id` or `name` attribute. Fenced code blocks are skipped.
- **What is scanned:** `.cs` and `.sql` files under `src`, `tests`, `samples` and `tools`. A tag counts only when a `//` or `--` comment marker comes before it on the same line, which covers comments and generator-emitted `/// <docs>` strings.

The script exits 0 when every target resolves, 1 on a finding, and 2 when the clone fails or holds no pages, so a fetch problem fails the job instead of passing it unchecked.

**The baseline only shrinks.** Targets that already dangled when the check landed are listed in `.github/scripts/docs-tag-target-baseline.txt`. A new dangling target fails the check, and so does a baselined target that no tag uses any more: delete its line in the same pull request. A baselined target that now resolves, because a page or heading was added on this site, is reported as a warning only, since no pull request in the library caused it; delete its line when the warning appears.

Two consequences of checking against another repository:

- **Land the docs page first.** A tag pointing at a page that exists only in an open docs pull request fails until that pull request merges.
- **Removing a docs page or heading turns the check red** for every tag that names it. Adding one that fixes a baselined target only raises a warning to delete that line.

Run it locally against a docs checkout next to the repository:

```bash
pwsh .github/scripts/Test-DocsTagTarget.ps1 -DocsRoot ../whizbang-lib.github.io
```

## Sonar's complexity and parameter limits fail the build {#sonar-queue-rules}

The merge queue's quality gate runs SonarCloud, which flags a method whose cognitive complexity is over 15 (3 for a property accessor) under rule S3776, and one with more than 7 parameters under S107. The analyzer package ships both rules turned off, so until #2515 they surfaced only in the queue and cost a queue run each time.

The root `.editorconfig` now turns both rules on for `src/**.cs` at the same limits, and the build treats them as errors, so a local build and PR CI fail on them before the queue does. Split a large method into helpers, or group related parameters into a small value type. A real exception takes `[SuppressMessage]` with a justification that says why.

Test, sample, benchmark and tool code keep both rules off, because the gate does not check them there. `SonarQueueRulesTests` in `tests/Whizbang.RepoAnalyzers.Tests` runs the build's own analyzer over code under each folder, one member over each limit and one exactly at it, so the test fails if either rule or its scope changes.

## Giving a new diagnostic its ID

`diagnostic-ids.txt` at the repository root lists every ID: its status, the project that defines it, and its meaning. A new diagnostic takes the lowest free number in its block there, and its row is added in the same change. A repository check takes the next number in the WHIZ600 block; anything that ships takes a number outside it.

A retired ID is never given a new meaning, so a suppression or a search for it can never match something else. Seventeen `EFCORE###` IDs and `WSAGA004` shipped before the single form and keep their IDs, because consumers may suppress them by name. They are listed as legacy, and that set only shrinks.

`.github/scripts/Test-DiagnosticIds.ps1` enforces the registry on every pull request. It reads `src/`, `tools/` and the MSBuild error codes, and fails when:

- an ID is defined but not listed, or listed but not defined (unless retired);
- an ID is listed under a project that does not define it;
- an ID is outside the `WHIZ###` form and not legacy;
- one ID is defined with two meanings.
