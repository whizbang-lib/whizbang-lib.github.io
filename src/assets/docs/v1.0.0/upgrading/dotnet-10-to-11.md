---
title: Moving from .NET 10 to .NET 11
pageType: guide
audience: [consumer]
version: 1.0.0
category: Upgrading
order: 2
verifiedAgainstCommit: 078dc17d1
verifiedDate: 2026-11-20
description: >-
  What changes for an application that runs Whizbang when it moves its target framework from net10.0
  to net11.0: which package build it gets, runtime async in that build, dependencies, generators,
  wire and storage formats, and a staged move of a fleet. Every package has carried both builds since
  0.4457.0.
tags: >-
  upgrading, net11.0, net10.0, target framework, runtime async, migration, nuget, dependencies,
  rolling upgrade
codeReferences:
  - src/Directory.Build.props
  - Directory.Build.targets
  - Directory.Build.props
  - Directory.Packages.props
  - global.json
  - docs/RELEASING.md
testReferences:
  - .github/scripts/tests/TestSuiteFrameworkLegs.Tests.ps1
  - .github/scripts/tests/Install-DotnetSdk.Tests.ps1
lastMaintainedCommit: '078dc17d1'
---

# Moving from .NET 10 to .NET 11

Every Whizbang runtime package carries two builds, `lib/net10.0` and `lib/net11.0`, starting with
0.4457.0. Both are built from the same source and both run the full test suite before a release is
published, each framework in its own test job. An application can stay on .NET 10 or move to .NET 11
without waiting for Whizbang, and it does not change Whizbang versions to do so.

This page is for an application that changes its own `TargetFramework` from `net10.0` to `net11.0`.
An application that stays on .NET 10 has nothing to do.

## Before you start

- **Use 0.4457.0 or later.** Releases up to 0.2626.0 carry `lib/net10.0` only. A .NET 11 application
  can still reference them, and NuGet then uses the `net10.0` build, but neither those builds nor
  that combination were tested on .NET 11.
- **Install the .NET 11 SDK** where the application builds. Building the application needs it;
  Whizbang itself has no further requirement.
- **Upgrade Whizbang and .NET in separate deployments** when you can. Each is easier to roll back on
  its own, and the [upgrade guide](upgrade-guide.md) lists what changes between Whizbang releases.

## What changes

| Area | On net10.0 | On net11.0 |
|---|---|---|
| The Whizbang build NuGet picks | `lib/net10.0` | `lib/net11.0` |
| How Whizbang's async methods run | Compiler-generated state machines | [Runtime async](../operations/performance/profiling.md#runtime-async), from 0.4521.0 |
| Live stack traces of Whizbang frames (profilers, debuggers, `new StackTrace()`) | `MoveNext` frames of state machines | The real call chain |

Change the target framework, restore, build and run the application's tests:

```xml{title="Moving an application to net11.0" description="The application's own project file. NuGet then selects the net11.0 build of every Whizbang package." category="Configuration" difficulty="BEGINNER" tags=["upgrading", "net11.0", "target framework", "csproj"] unverified="project configuration; NuGet's framework selection"}
<PropertyGroup>
  <TargetFramework>net11.0</TargetFramework>
</PropertyGroup>
```

## What does not change

- **The API.** Both builds are compiled from the same source, and the library has no code that is
  compiled for one framework only, so every type and member is the same on both.
- **Wire and storage formats.** Messages, envelopes, stored events and perspective rows are
  serialized by the same code on both builds. No migration runs because a service changed its target
  framework.
- **Exception stack traces, logs and traces.** An exception's stack trace looks the same as before,
  and caller information on message hops is captured at compile time, not by walking the stack.
- **Measured cost.** Benchmarks of dispatch, execution and throughput showed no measurable difference
  in time or allocations with runtime async on; see [the numbers](../operations/performance/profiling.md#runtime-async).
- **Dependencies.** The `net11.0` build depends on the same minimum versions as the `net10.0` build:
  as of 0.4521.0, `Microsoft.Extensions.*` and `Microsoft.EntityFrameworkCore` 10.0.15 and
  `Npgsql.EntityFrameworkCore.PostgreSQL` 10.0.0, and Whizbang's tests run on those versions on both
  frameworks. A dependency version in a package is a minimum, so an application that references a
  newer version gets the newer one, as NuGet always resolves it.
- **Source generators and analyzers.** They are the same `netstandard2.0` assemblies for both
  frameworks, built against the .NET 10 SDK's compiler (Roslyn 5.0), so they run under either SDK.
- **Configuration.** No setting is read differently on .NET 11.

## Your own code and runtime async

Runtime async in the Whizbang `net11.0` build does not turn it on for your code. Your projects are
compiled with your own settings, and runtime-async and state-machine methods await each other freely.
To turn runtime async on for your own `net11.0` projects, or to keep one project off it, see
[your own code](../operations/performance/profiling.md#runtime-async-your-code).

## A fleet that moves one service at a time

Services on .NET 10 and services on .NET 11 can share a database and a broker while a fleet moves,
because the formats do not depend on the framework. Keep every service on the same Whizbang release
during that move, so the only difference between them is the framework. A Whizbang upgrade during
a mixed deployment follows the [rolling upgrade](../operations/startup/rolling-upgrades.md) rules as
it always does.

## Rolling back

Changing the target framework back to `net10.0` is a build change only. When the Whizbang release
stayed the same, nothing was migrated by the move, so a rolled-back service starts against the same
schema it left.

## Related

- [Runtime async on .NET 11](../operations/performance/profiling.md#runtime-async)
- [Upgrade guide](upgrade-guide.md): behavior changes between Whizbang releases
- [Installation](../getting-started/installation.md)
- [Rolling upgrades](../operations/startup/rolling-upgrades.md)
