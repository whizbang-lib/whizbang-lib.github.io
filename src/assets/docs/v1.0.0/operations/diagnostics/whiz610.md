---
title: 'WHIZ610: Type Name Read Before the Log Level Is Checked'
pageType: troubleshooting
version: 1.0.0
description: >-
  A repository check: Whizbang library code reads a type's name, namespace or
  assembly-qualified name for a log call at Information or below, or for an
  activity's name, before the log level or a listener says the text is needed
category: Diagnostics
severity: Error
tags:
  - diagnostics
  - repository-check
  - type-names
  - logging
  - performance
  - analyzer
codeReferences:
  - tools/Whizbang.RepoAnalyzers/EagerLogTypeNameAnalyzer.cs
  - src/Whizbang.Core/TypeNameFormatter.cs
  - src/Whizbang.Core/Observability/WhizbangActivitySource.cs
testReferences:
  - tests/Whizbang.RepoAnalyzers.Tests/EagerLogTypeNameAnalyzerTests.cs
  - tests/Whizbang.Core.Unit.Messaging.Tests/Messaging/ReceptorInvokerSkipLoggingTests.cs
  - tests/Whizbang.Core.Unit.Messaging.Tests/Observability/DispatchActivityTests.cs
---

# WHIZ610: Type Name Read Before the Log Level Is Checked

**Severity**: Error
**Raised by**: `Whizbang.RepoAnalyzers` (Roslyn analyzer)

This is a check on the Whizbang repository's own code. It runs only on the library projects under `src/` and never ships in a package, so an application that uses Whizbang never sees it. Tests, tools, samples and benchmarks have it turned off (`TypeNaming.OutsideLibrary.globalconfig`). See [Repository Checks and Diagnostic IDs](../../../contributors/repository-checks.md) for the whole block.

## What it means {#what-it-means}

Library code reads a type's name through the shared naming code (any method of a `[TypeNameAuthority]` class that takes a `Type`, such as `TypeNameFormatter.ForLog`, `NamespaceOf` or `AssemblyQualifiedName`) and passes the result to something that may not need it, without checking first:

- **A log call at `Information` or below**: a `[LoggerMessage]` method at that level (a level passed as a parameter counts as below `Warning`), `LogTrace`, `LogDebug`, `LogInformation`, or `Log` and `ILogger.Log` with a level below `Warning`.
- **An activity's name**: `ActivitySource.StartActivity` or `CreateActivity`, whose name argument is built whether or not anything listens.

The name counts as passed when it is the argument itself or reaches it through an interpolated string, a concatenation, a conditional or a coalesce. A local that holds the name is held to the same rule when every read of it is a log argument.

```csharp{title="The reads WHIZ610 reports" description="A type name read for a debug log and for an activity name before anything says either is consumed." framework="NET10" category="Diagnostics" difficulty="INTERMEDIATE" tags=["whiz610", "repository-check", "type-names", "logging", "analyzer"] tests=["EagerLogTypeNameAnalyzerTests.UnguardedLogArgument_IsReportedAsync", "EagerLogTypeNameAnalyzerTests.TheInterfaceLogMethod_IsRecognizedAsync"]}
internal sealed partial class OrderStage(ILogger logger, ActivitySource source) {
  public void Skip(Type messageType) {
    LogSkipped(logger, TypeNameFormatter.ForLog(messageType));                // WHIZ610
    logger.LogDebug("{Ns}", TypeNameFormatter.NamespaceOf(messageType));       // WHIZ610
    source.StartActivity($"Dispatch {TypeNameFormatter.ForLog(messageType)}"); // WHIZ610
  }

  [LoggerMessage(Level = LogLevel.Debug, Message = "Skipped {MessageType}")]
  private static partial void LogSkipped(ILogger logger, string messageType);
}
```

The report sits on the read and quotes it.
{verified: EagerLogTypeNameAnalyzerTests.Descriptor_IsARepositoryRuleReportedAsAnErrorAsync, EagerLogTypeNameAnalyzerTests.UnguardedLogArgument_IsReportedAsync}

## Why it matters {#why-it-matters}

The runtime caches a type's name, namespace and assembly-qualified name behind a weak handle, and any garbage collection can drop that cache. A path that runs once per message and reads a name for a debug log therefore allocates again after every collection, even with debug logging off and nobody reading the text. The assembly-qualified name is built afresh on every read. Under load, collections are frequent, so the cost recurs on every busy path that reads a name it never uses.

Before this rule, about twenty sites in the library read a name this way, among them the lifecycle-stage skip logs, the stream id generation and inheritance logs, and the name of every dispatch and perspective sync activity. Each now reads the name only once the level is enabled or a listener is attached
{verified: ReceptorInvokerSkipLoggingTests.Skip_WithDebugOff_ReadsNoTypeNameAsync, ReceptorInvokerSkipLoggingTests.Skip_WithDebugOn_IsLoggedByTheTypesNameAsync, DispatchActivityTests.StartForType_WithNothingListening_BuildsNoNameAndAllocatesNothingAsync, DispatchActivityTests.StartForType_WithAListener_NamesTheActivityByTheTypeAsync}.

## How to fix it {#how-to-fix}

Check before reading. Any of these shapes clears the report:

- `if (logger.IsEnabled(LogLevel.Debug)) { ... }` around the call, including `logger?.IsEnabled(...) == true` and a condition that `&&`s the check with something else.
- An earlier `if (!logger.IsEnabled(LogLevel.Debug)) return;` (or `throw`, `continue`, `break`) in an enclosing block.
- A local `bool` set from an `IsEnabled` call and tested before the call.
- `logger.IsEnabled(...) ? Log(...) : ...` and `logger.IsEnabled(...) && Log(...)`.
- For an activity name, `source.HasListeners()` in any of the same shapes. Library code that names an activity for a type calls `WhizbangActivitySource.StartForType`, which checks for a listener before it builds the name.

```csharp{title="Clearing WHIZ610" description="The same reads behind the level check and the listener check." framework="NET10" category="Diagnostics" difficulty="INTERMEDIATE" tags=["whiz610", "repository-check", "type-names", "logging", "analyzer"] tests=["EagerLogTypeNameAnalyzerTests.GuardedOrNotALowLevelLogArgument_IsNotReportedAsync"]}
public void Skip(Type messageType) {
  if (logger.IsEnabled(LogLevel.Debug)) {
    LogSkipped(logger, TypeNameFormatter.ForLog(messageType));
  }

  if (source.HasListeners()) {
    source.StartActivity($"Dispatch {TypeNameFormatter.ForLog(messageType)}");
  }
}
```

A read the code needs whatever the level (a key, a routing decision, an exception message) is not a log read and is not reported. Such reads go through `TypeNameFormatter`, which reads each form of a type's name once and keeps it with the type, so a later read allocates nothing even after a collection (see [Each form is read once per type](../../fundamentals/identity/type-formatting.md#names-read-once-per-type)). That caching does not clear WHIZ610: the rule reports a low-level log or activity read through the shared naming code whether the form is cached or not, and the check is the fix.

The `[LoggerMessage]` level matters: a `Warning` or `Error` message is not reported, because those levels are on in production and the paths that log them are rare. Raising a debug message to `Warning` to silence the rule is the wrong fix.
{verified: EagerLogTypeNameAnalyzerTests.GuardedOrNotALowLevelLogArgument_IsNotReportedAsync}

## What it does not see {#what-it-does-not-see}

- **A name passed into a helper that only logs it.** The rule follows a value into a recognized log call, not into an arbitrary method: `Report(TypeNameFormatter.ForLog(t))` is not reported even when `Report` only logs its argument, because no analyzer can know what a callee does with a string. The fix for such a helper is to take the `Type` and read the name inside its own check, as the stream id report now does.
- **A check behind a helper property or method.** `if (DebugOn) { ... }` where `DebugOn` wraps `IsEnabled` is not recognized and is reported. This fails safe; call `IsEnabled` directly.
- **A check outside a lambda or local function.** A check in the enclosing method does not guard a call inside a lambda or a local function, which may run anywhere, so that call is still reported.
- **Reads inside a `catch` clause.** These are not reported. They run only after an exception was thrown, which costs far more than the name.

{verified: EagerLogTypeNameAnalyzerTests.ACheckOutsideALambda_DoesNotGuardTheCallInsideItAsync, EagerLogTypeNameAnalyzerTests.ACheckOutsideALocalFunction_DoesNotGuardTheCallInsideItAsync, EagerLogTypeNameAnalyzerTests.GuardedOrNotALowLevelLogArgument_IsNotReportedAsync, EagerLogTypeNameAnalyzerTests.UnguardedLogArgument_IsReportedAsync}

## Where it applies {#where-it-applies}

WHIZ610 is an error in every project under `src/`, not only in code known to run per message. Nothing in the code says which methods run once per message, so a list of them would go stale, while the rule costs a startup log a single `IsEnabled` check. Outside `src/`, `TypeNaming.OutsideLibrary.globalconfig` turns it off.

## Related

- [WHIZ607](whiz607.md), which routes every type-name read in the library through the shared naming code that WHIZ610 watches
- [Type Names in Library Code](../../../contributors/type-naming.md)
- [Repository Checks and Diagnostic IDs](../../../contributors/repository-checks.md)
