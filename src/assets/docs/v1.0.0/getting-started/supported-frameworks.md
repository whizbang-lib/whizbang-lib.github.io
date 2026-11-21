---
title: Supported Frameworks
pageType: reference
audience: [consumer]
version: 1.0.0
category: Getting Started
order: 3
verifiedAgainstCommit: 346aba6df
verifiedDate: 2026-11-20
description: >-
  The .NET versions Whizbang packages are built and tested for (net10.0 and net11.0 since
  0.4457.0), the support policy that follows Microsoft's .NET support lifecycle, and how a target
  framework is added for a new .NET release and dropped when Microsoft's support ends.
tags: >-
  supported frameworks, support policy, target framework, net10.0, net11.0, LTS, STS,
  end of support, lifecycle, nuget
codeReferences:
  - src/Directory.Build.props
  - Directory.Build.props
  - global.json
  - docs/RELEASING.md
  - CHANGELOG.md
testReferences:
  - .github/scripts/tests/TestSuiteFrameworkLegs.Tests.ps1
lastMaintainedCommit: '346aba6df'
---

# Supported Frameworks

Whizbang supports each .NET version for as long as Microsoft supports it. This page lists the
versions the packages are built for today, what the support policy means in practice, and how a
version is added or dropped.

## Current targets

| .NET version | Target framework | Microsoft support | In Whizbang packages since |
|---|---|---|---|
| .NET 10 | `net10.0` | Long-term support (LTS) | The first release |
| .NET 11 | `net11.0` | Standard-term support (STS) | 0.4457.0 |

Every Whizbang runtime package carries both builds, `lib/net10.0` and `lib/net11.0`, and NuGet
picks the one that matches the application's target framework. Both are compiled from the same
source, so the API is the same on both. Before a release is published, the full test suite runs on
each framework in its own test job, and a release ships only when both pass. Development alphas
carry both builds too.

The two builds differ in one way: from 0.4521.0, the `net11.0` build uses .NET 11's runtime async,
and the `net10.0` build keeps compiler-generated state machines. [Moving from .NET 10 to .NET
11](../upgrading/dotnet-10-to-11.md) covers what that means for an application.

The source generators and analyzers are `netstandard2.0` assemblies, as the compiler requires, and
are the same for both frameworks. They are built against the .NET 10 SDK's compiler, so the .NET 10
SDK or later builds an application that uses them.

An application on an older .NET, such as .NET 8 or .NET 9, cannot reference the packages: NuGet
reports that the package is not compatible with the application's framework.

## Support policy

- **Each .NET version is supported for as long as Microsoft supports it.** A Whizbang target
  framework stays in the packages until Microsoft's support for that .NET version ends. Microsoft
  publishes the end-of-support date of every version in its
  [.NET support policy](https://dotnet.microsoft.com/platform/support/policy/dotnet-core).
- **Extended support.** Extended support beyond Microsoft's window may be available; contact the
  maintainers.

## What LTS and STS mean here

LTS and STS are Microsoft's release types, and they set how long Microsoft supports a .NET version.
Microsoft releases a new major version of .NET every November. Even-numbered versions are long-term
support (LTS) releases, supported for three years. Odd-numbered versions are standard-term support
(STS) releases, supported for two years. Microsoft's support policy page holds the dates.

Whizbang treats both types the same way: it supports each one for as long as Microsoft does.
Choosing between them is the application's decision. An application that wants the longest time
between framework moves can stay on the LTS version, and an application that wants the newest runtime
can move to the STS version. The same Whizbang release serves both, so neither choice holds back a
Whizbang upgrade.

## How a target framework is added

When Microsoft releases a new major version of .NET, Whizbang adds it as a target framework. The
library moves its own development to the new version, every package gains a build for it, and the
full test suite runs on it alongside the frameworks already supported. The release that first
carries the new build says so in the [changelog](https://github.com/whizbang-lib/whizbang/blob/main/CHANGELOG.md).

Adding a framework does not remove one. .NET 11 was added in 0.4457.0, and the `net10.0` build
continued unchanged beside it.

## How a target framework is dropped

When Microsoft ends support for a .NET version, Whizbang drops that target framework from its
packages. The drop is announced in the changelog ahead of the release that makes it, so an
application still on that version has notice to move to a supported one first.

Releases published before the drop stay on nuget.org and keep their build for the dropped framework.
Releases after the drop no longer carry it.

## Related

- [Installation](installation.md)
- [Moving from .NET 10 to .NET 11](../upgrading/dotnet-10-to-11.md)
- [Upgrade guide](../upgrading/upgrade-guide.md): behavior changes between Whizbang releases
- [Version numbers](installation.md#version-numbers)
