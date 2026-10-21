---
title: 'Convention-bound parameters: suppressed unused-parameter findings'
pageType: troubleshooting
verifiedAgainstCommit: 053d4778
verifiedDate: 2026-10-21
description: >-
  The analyzer package suppresses IDE0060, CA1801, RCS1163 and S1172 on a parameter the framework requires on a
  method it binds by shape rather than by interface, so a consumer's quality gate does not flag it.
version: 1.0.0
category: Diagnostics
severity: Info
tags:
  - diagnostics
  - analyzer
  - suppressor
  - collective-events
  - code-quality
codeReferences:
  - src/Whizbang.Generators/Suppressors/ConventionBoundParameterSuppressor.cs
  - src/Whizbang.Generators/CollectiveApplyShape.cs
  - src/Whizbang.Core/Perspectives/CollectiveApplyForAttribute.cs
testReferences:
  - tests/Whizbang.Generators.Tests/Suppressors/ConventionBoundParameterSuppressorTests.cs
  - tests/Whizbang.Generators.Component.Tests/ConventionBoundParameterGuardTests.cs
lastMaintainedCommit: '053d4778'
---

# Convention-bound parameters

**Suppressions**: WHIZS001 (IDE0060), WHIZS002 (CA1801), WHIZS003 (Roslynator RCS1163), WHIZS004 (Sonar S1172)

## Why a finding appears

Most framework entry points are interface members (`IReceptor`, `IPerspectiveFor`), and analyzers already exempt
interface members from unused-parameter rules. A `[CollectiveApplyFor]` handler is different: the generator binds it
by its shape, so no interface tells an analyzer that its event parameter is required. A handler that never reads the
event, such as one that sets a constant, is then flagged:

```csharp{
title: "A handler that does not read its event"
description: "The event parameter names the event the handler applies, so it stays even though the body never reads it."
framework: "NET10"
category: "Diagnostics"
difficulty: "BEGINNER"
tags: ["collective-events", "analyzer", "suppressor"]
tests: ["ConventionBoundParameterGuardTests.WithTheSuppressor_NoUnusedParameterFindingRemainsAsync"]
}
public sealed class JobCollectivePerspective {
  [CollectiveApplyFor]
  public ICollectiveSpec<JobModel> ArchiveAll(ArchiveJobsCollectiveEvent e) =>
    new CollectiveSpec<JobModel>(s => s.SetProperty(j => j.Archived, true));
}
```

## What the package does

The analyzer package ships a `DiagnosticSuppressor`, `ConventionBoundParameterSuppressor`, that suppresses the four
rules above on **exactly** the event parameter of a handler the generator binds:

- the method carries `[CollectiveApplyFor]`,
- it returns `ICollectiveSpec<TModel>`,
- its first parameter is a collective event, and an optional second one is `ICollectiveQuery`.

Nothing else is suppressed. The `ICollectiveQuery` parameter is optional, so a handler that does not read it leaves it
out instead (see [Handler shapes](../../fundamentals/messaging/collective-events.md#handler-shapes)). A method with the
attribute but another shape is not bound, so its findings stay.

## Where the suppression holds

A suppressor runs inside the consumer's build, so it holds in the IDE, in `dotnet build`, and for analyzers that run
in the build. The compiler records a suppressed finding as suppressed in its error log (`suppressedInSource`), and
SonarScanner for .NET skips results marked that way, so the finding does not reach SonarQube Cloud either. A
suppressed finding is reported as suppressed, not hidden, so it remains auditable.

{verified: ConventionBoundParameterSuppressorTests.TheEventParameterOfABoundHandler_IsSuppressedAsync, ConventionBoundParameterSuppressorTests.TheQueryParameter_IsNotSuppressedAsync, ConventionBoundParameterSuppressorTests.AMethodTheGeneratorDoesNotBind_IsNotSuppressedAsync, ConventionBoundParameterGuardTests.WithoutTheSuppressor_TheRulesFlagTheEventParameterAsync, ConventionBoundParameterGuardTests.WithTheSuppressor_NoUnusedParameterFindingRemainsAsync}
