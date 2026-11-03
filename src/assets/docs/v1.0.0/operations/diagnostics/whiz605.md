---
title: 'WHIZ605: Test Class Without Exactly One Shard Category'
pageType: troubleshooting
version: 1.0.0
description: >-
  A repository check: a test class in a sharded Whizbang test project carries
  no Shard category, or more than one, so CI would run it in no slice or in two
category: Diagnostics
severity: Error
tags:
  - diagnostics
  - repository-check
  - testing
  - sharding
  - analyzer
codeReferences:
  - src/Whizbang.TestAnalyzers/ShardCategoryAnalyzer.cs
testReferences:
  - tests/Whizbang.TestAnalyzers.Tests/ShardCategoryAnalyzerTests.cs
---

# WHIZ605: Test Class Without Exactly One Shard Category

**Severity**: Error
**Raised by**: `Whizbang.TestAnalyzers` (Roslyn analyzer)

This is a check on the Whizbang repository's own code and tests. It runs only in this repository's test projects and never ships in a package, so an application that uses Whizbang never sees it. See [Repository Checks and Diagnostic IDs](../../../contributors/repository-checks.md) for the whole block.

## What it means

The test project sets `<WhizbangShardedTests>true</WhizbangShardedTests>`, and a non-abstract class with a TUnit `[Test]` method carries no `[Category("ShardN")]`, two of them, or one beside `[Category("Benchmark")]`. Categories on base classes count.

```csharp{title="The class WHIZ605 reports" description="A test class in a sharded project with a category but no Shard category." category="Diagnostics" difficulty="BEGINNER" tags=["whiz605", "repository-check", "sharding", "analyzer"] tests=["ShardCategoryAnalyzerTests.TestClass_WithNoShardCategory_ReportsWhiz605Async", "ShardCategoryAnalyzerTests.TestClass_WithTwoShardCategories_ReportsBothShardsAsync"]}
[Category("Integration")]
public class OrdersTests {
  [Test]
  public void Run() {
  }
}
```

## Why it matters

CI runs a sharded project as `[Category=ShardN]` slices, one per runner. A class with no shard category matches no slice, so its tests stop running while every job stays green. A class with two runs on two runners.

## How to fix it

Give the class exactly one shard category, placed by measured cost (`scripts/Measure-TestShards.ps1` in the library repository), or `[Category("Benchmark")]` and no shard for a class the scheduled benchmark job runs instead:

```csharp{title="Clearing WHIZ605" description="Exactly one Shard category puts the class in one CI slice." category="Diagnostics" difficulty="BEGINNER" tags=["whiz605", "repository-check", "sharding", "analyzer"] tests=["ShardCategoryAnalyzerTests.TestClass_WithExactlyOneShard_ReportsNothingAsync", "ShardCategoryAnalyzerTests.TestClass_WithBenchmarkAndNoShard_ReportsNothingAsync"]}
[Category("Integration")]
[Category("Shard3")]
public class OrdersTests {
  [Test]
  public void Run() {
  }
}
```

## Related

- [Repository Checks and Diagnostic IDs](../../../contributors/repository-checks.md), which explains the rule in more depth
