---
title: Build Cost
pageType: guide
version: 1.0.0
category: Performance
order: 1
description: >-
  What Whizbang's analyzers and source generators add to your build, how to measure it yourself, why
  the generators keep their output cached across unrelated edits in the IDE, and how the library
  guards both in its own tests and CI.
tags: 'build, performance, analyzers, source-generators, incremental, ide, binlog, ReportAnalyzer'
codeReferences:
  - src/Whizbang.Generators.Shared/Utilities/EquatableArray.cs
  - src/Whizbang.Generators/build/SoftwareExtravaganza.Whizbang.Generators.props
  - src/Whizbang.Generators/build/SoftwareExtravaganza.Whizbang.Generators.targets
  - scripts/build-cost/Test-NoOpRebuild.ps1
  - .github/workflows/ci.yml
testReferences:
  - tests/Whizbang.Generators.Tests/BuildCost/GeneratorCachingTests.cs
  - tests/Whizbang.Generators.Tests/BuildCost/ConsumerCorpus.cs
  - .github/scripts/tests/Test-NoOpRebuild.Tests.ps1
---

# Build Cost

A project that references the Whizbang packages runs Whizbang's analyzers and source generators on
every build, and in the IDE on most keystrokes. This page shows what that costs, how to measure it in
your own project, and what the library does to keep it small.

## What Whizbang adds

Measured on a sample service build of about 20 seconds:

| Component | What it does | Measured cost |
|-----------|--------------|---------------|
| Analyzers | Report `WHIZ` diagnostics as you type and build | about 3 ms |
| Source generators | Emit the dispatcher, receptor registry, JSON context, perspective code and message registry | about 0.3 s |

Your numbers depend on the size of your project, so measure them yourself.

## Measuring it yourself

Ask the compiler to report analyzer and generator time, then read the per-assembly totals in the
detailed log:

```bash{
title: "Report analyzer and generator time in a build"
description: "Builds with ReportAnalyzer on and detailed verbosity, so the compiler prints the time spent in each analyzer and generator assembly."
category: "Performance"
difficulty: "INTERMEDIATE"
tags: ["build", "analyzers", "source-generators", "ReportAnalyzer"]
}
dotnet build -p:ReportAnalyzer=true -v:d
```

Look for `Total analyzer execution time` and `Total generator execution time`, then the lines that
name the Whizbang assemblies.

For a large solution, write a binary log instead and open it in the MSBuild Structured Log Viewer.
Its performance summary lists targets and tasks by time, and with `ReportAnalyzer` on it lists each
analyzer and generator under the compiler task:

```bash{
title: "Write a binary log with analyzer timing"
description: "Captures a binary log that the MSBuild Structured Log Viewer can summarize by target, task, analyzer and generator."
category: "Performance"
difficulty: "INTERMEDIATE"
tags: ["build", "binlog", "analyzers", "source-generators"]
}
dotnet build -p:ReportAnalyzer=true -bl
```

## Incremental generators and the IDE

Source generators run whenever the compilation changes. In the IDE that means on keystrokes, not only
on build. A generator that regenerates its output after every edit makes the editor recompute
everything built on that output, and the IDE feels slower the larger the project gets.

Whizbang's generators are incremental. Each one reads only what it needs and compares what it read
with the last run. When an edit does not change what a generator reads, its output stays cached and
nothing downstream is recomputed. Examples of such edits:

- a comment;
- a method body in a file that declares no messages, receptors or perspectives;
- the body of a receptor's `HandleAsync`.

An edit that does change what a generator reads, such as adding a message or changing a receptor's
signature, regenerates the affected output, as it should.

Two generators look across the whole compilation: the JSON context generator and the polymorphic
receptor discovery. They still read types across the compilation on each edit, because any type could
be a message or a receptor's message, but they compare the result with the last run and skip
generating output when nothing changed.

## How Whizbang guards this

| Guard | What fails it | Where it runs |
|-------|---------------|---------------|
| Generator caching test | Any generator producing new or changed output after a comment, an unrelated method body or a receptor body edit | Every test run of the generators project |
| No-op rebuild check | A second build with nothing changed running `CoreCompile` or the generator merge step in any project | CI job "Build · No-op rebuild does no work" |

The generator caching test, [`GeneratorCachingTests`](https://github.com/whizbang-lib/whizbang/blob/develop/tests/Whizbang.Generators.Tests/BuildCost/GeneratorCachingTests.cs),
runs every generator in the package together over a consumer-like project, applies one edit, and fails
naming each generator that regenerated.
{verified: GeneratorCachingTests.UnrelatedEdit_RegeneratesNothingAsync}

The no-op rebuild check, `scripts/build-cost/Test-NoOpRebuild.ps1` in the library repository, builds
a sample service twice and fails if the second build did work, naming the project and the input that
was newer than its output. You can run it against your own project with `-Project`.

## Keeping your own build fast

**Generated files on disk.** The generators package sets `EmitCompilerGeneratedFiles` to `true` and
writes generated files to `.whizbang/cache/`, unless your project sets it. Whizbang extracts the
[message registry](../../extending/source-generators/message-registry) and the
[pinned-type ledger](../../fundamentals/identity/pinned-type-ledger) from those files after each
build. Writing them costs a little disk time on every build. In a project where you do not need either
artifact, turn both off and the files are no longer written:

```xml{
title: "Stop writing generated files to disk"
description: "Turns off the message registry extraction and the on-disk copy of generated files in a project that needs neither."
category: "Performance"
difficulty: "INTERMEDIATE"
tags: ["build", "source-generators", "EmitCompilerGeneratedFiles", "msbuild"]
}
<PropertyGroup>
  <WhizbangEmitMessageRegistry>false</WhizbangEmitMessageRegistry>
  <EmitCompilerGeneratedFiles>false</EmitCompilerGeneratedFiles>
</PropertyGroup>
```

Setting `EmitCompilerGeneratedFiles` to `false` alone, while the message registry is on, means the
registry and the ledger are no longer updated after a build. Turn it back on when you want to inspect
the generated code.

**Check `ReportAnalyzer` output now and then.** If a Whizbang analyzer or generator shows up near the
top of your build's analyzer list, or its time grows out of proportion to your project, report it with
the log attached.

## Related

- [Performance Tuning](../deployment/performance-tuning): runtime performance
- [Message Registry](../../extending/source-generators/message-registry)
- [Pinned-Type Ledger](../../fundamentals/identity/pinned-type-ledger)
