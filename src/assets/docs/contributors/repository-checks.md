---
title: Repository Checks and Diagnostic IDs
pageType: reference
audience: [contributor]
status: current
order: 5
description: The build errors this repository raises on its own code and tests (WHIZ600 to WHIZ606), what each one protects, and how a new diagnostic gets its ID from the one registry of every WHIZ ID
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

## Giving a new diagnostic its ID

`diagnostic-ids.txt` at the repository root lists every ID: its status, the project that defines it, and its meaning. A new diagnostic takes the lowest free number in its block there, and its row is added in the same change. A repository check takes the next number in the WHIZ600 block; anything that ships takes a number outside it.

A retired ID is never given a new meaning, so a suppression or a search for it can never match something else. Seventeen `EFCORE###` IDs and `WSAGA004` shipped before the single form and keep their IDs, because consumers may suppress them by name. They are listed as legacy, and that set only shrinks.

`.github/scripts/Test-DiagnosticIds.ps1` enforces the registry on every pull request. It reads `src/`, `tools/` and the MSBuild error codes, and fails when:

- an ID is defined but not listed, or listed but not defined (unless retired);
- an ID is listed under a project that does not define it;
- an ID is outside the `WHIZ###` form and not legacy;
- one ID is defined with two meanings.
