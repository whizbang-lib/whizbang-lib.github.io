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
  - .github/scripts/Invoke-BuildWithinMemory.ps1
  - src/Whizbang.Data.EFCore.Postgres.Generators/Templates/MigrationScriptsTemplate.cs
  - src/Whizbang.Generators/PerspectiveRunnerGenerator.cs
  - src/Whizbang.Core/Perspectives/PerspectiveRunnerBase.cs
  - src/Whizbang.Generators/Templates/PerspectiveRunnerClassTemplate.cs
  - src/Whizbang.Generators/ConcreteSubtypeIndex.cs
  - src/Whizbang.Generators/ReceptorDiscoveryGenerator.cs
  - benchmarks/Whizbang.BuildCost.Benchmarks/BuildCostRunner.cs
  - benchmarks/Whizbang.BuildCost.Benchmarks/BuildCostEvaluator.cs
  - benchmarks/Whizbang.BuildCost.Benchmarks/BuildCostOptions.cs
  - benchmarks/Whizbang.BuildCost.Benchmarks/BuildCostThresholds.cs
  - benchmarks/Whizbang.BuildCost.Benchmarks/ConsumerCorpus.cs
  - benchmarks/Whizbang.BuildCost.Benchmarks/build-cost-thresholds.json
  - .github/workflows/build-cost-timing.yml
testReferences:
  - tests/Whizbang.Generators.Tests/BuildCost/GeneratorCachingTests.cs
  - tests/Whizbang.Generators.Tests/BuildCost/BuildCostBenchmarkTests.cs
  - .github/scripts/tests/Test-NoOpRebuild.Tests.ps1
  - .github/scripts/tests/Invoke-BuildWithinMemory.Tests.ps1
  - tests/Whizbang.Generators.Tests/MigrationScriptsEmittedOnceGenerationTests.cs
  - tests/Whizbang.Generators.Tests/PerspectiveRunnerGeneratedSizeTests.cs
  - tests/Whizbang.Generators.Tests/ConcreteSubtypeIndexTests.cs
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

Your numbers depend on the size of your project, so measure them yourself. A small sample hides any
cost that grows with the amount of code: until
[whizbang#1655](https://github.com/whizbang-lib/whizbang/pull/1655), the GUID interceptor generator asked the compiler to resolve every `x.Method(...)` call in the project, interception on or off. That
was negligible on the sample and took over three minutes of a large solution's unit-test rebuild. It
now resolves only calls named like a GUID factory (`NewGuid`, `CreateVersion7`, `NewDatabaseFriendly`,
`NewSequential`, `NewUuid7`).

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

## Compiler memory

Time is not the only cost. Everything a generator emits is source the compiler parses, binds and holds
in memory, so generated text that grows with your project grows the compiler's memory with it.

Whizbang emits content that is the same for every type once per assembly, never once per type. The
library's migration set is the main example: several megabytes of SQL that every Whizbang `DbContext`
needs. Before [whizbang#2391](https://github.com/whizbang-lib/whizbang/pull/2391), each context's
generated schema extensions embedded their own copy. An assembly with 13 contexts compiled about
120 MB of identical generated source, and its compile peaked at 18.9 GB. The set is now generated once,
into an internal `WhizbangMigrationScripts` class that every context reads, and the same assembly
peaks at 7.9 GB. The migration texts are unchanged, so no recorded migration hash moves.
{verified: MigrationScriptsEmittedOnceGenerationTests.TheMigrationSetIsEmittedOnceForEveryContextAsync}

### Perspective runners

Each perspective gets a generated runner that loads its model, applies events and saves the row and
cursor. Before [whizbang#2481](https://github.com/whizbang-lib/whizbang/pull/2481), every runner
carried its own copy of the full runner logic, about 200 KB of generated source per perspective, nearly
all of it the same for every perspective. That PR generated the shared logic once per assembly as a base
class; since [whizbang#2469](https://github.com/whizbang-lib/whizbang/issues/2469) it is not generated at
all, but lives in Whizbang.Core as `PerspectiveRunnerBase<TPerspective, TModel>`, one copy for the whole
application, covered by Whizbang.Core's own tests. Each runner derives from
it and holds only what its perspective varies: its event list, its traits, its `Apply` dispatch, its
empty model, any overrides it needs and its registrations. A simple runner is about 4 KB. Runner
behavior, AOT safety and the runners' DI constructors are unchanged.

| Perspectives in the assembly | Generated source after | Before (one full runner each) |
|------------------------------|------------------------|-------------------------------|
| 1 | about 4 KB | about 208 KB |
| 2 | about 8 KB | about 416 KB |
| 1,000 | about 4.35 MB | about 208 MB |

With no generated base, the saving starts with the first perspective.
{verified: PerspectiveRunnerGeneratedSizeTests.ARunner_EmitsOnlyWhatItsPerspectiveVaries_NotTheSharedRunnerLogicAsync, PerspectiveRunnerGeneratedSizeTests.ASecondPerspective_AddsOnlyItsOwnRunner_NoRunnerBaseIsGeneratedAsync, PerspectiveRunnerGeneratedSizeTests.AnAssemblyWithNoPerspective_GetsNoRunnerBaseAsync, PerspectiveRunnerGeneratedSizeTests.TwoRunnersAndTheirSharedBase_CompileAsync}

The assembly's size does not show this kind of growth: the compiler stores identical text literals
once, so the 13 copies cost memory while compiling but almost nothing in the built file. To see what
the generators emit into your project, turn on `EmitCompilerGeneratedFiles` (see below) and compare
the size of the generated files with your own source.

## How Whizbang guards this

| Guard | What fails it | Where it runs |
|-------|---------------|---------------|
| Generator caching test | Any generator producing new or changed output after a comment, an unrelated method body or a receptor body edit | Every test run of the generators project |
| GUID candidate filter test | The GUID interceptor's syntax filter admitting an ordinary method call, so the compiler resolves calls the generator never intercepts | Every test run of the generators project |
| No-op rebuild check | A second build with nothing changed running `CoreCompile` or the generator merge step in any project | CI job "Build · No-op rebuild does no work" |
| Syntax predicate guard | A generator's syntax predicate that is not a public `Is...Candidate` method, or one that admits ordinary code | Every test run of the generators component tests |
| Generated JSON files check | The pinned-type ledger or opt-in message registry not written, not updated after a change, or rewritten on a build that did not recompile, with generated files off | CI job "Build · No-op rebuild does no work" |
| Generated migration set test | A generated project carrying more than one copy of the migration set, or a context that does not read the shared one | Every test run of the generators project |
| Generated runner size test | A perspective runner carrying the shared runner logic, or more than one runner base in an assembly | Every test run of the generators project |
| Build memory guard | A full-solution build that succeeds but peaks above 13 GB, counting the build's processes and the shared compiler server | CI jobs "Build · Compile", "Build · Analyzers" and the net10.0 build |
| Generator and analyzer timing | A generator or analyzer, or the total of either, slower than its threshold over a large generated consumer | CI job "Build · Generator and analyzer timing" (advisory) |

The generator caching test, [`GeneratorCachingTests`](https://github.com/whizbang-lib/whizbang/blob/develop/tests/Whizbang.Generators.Tests/BuildCost/GeneratorCachingTests.cs),
runs every generator in the package together over a consumer-like project, applies one edit, and fails
naming each generator that regenerated.
{verified: GeneratorCachingTests.UnrelatedEdit_RegeneratesNothingAsync}

The no-op rebuild check, `scripts/build-cost/Test-NoOpRebuild.ps1` in the library repository, builds
a sample service twice and fails if the second build did work, naming the project and the input that
was newer than its output. You can run it against your own project with `-Project`.

The syntax predicate guard, [`SyntaxCandidateGuardTests`](https://github.com/whizbang-lib/whizbang/blob/develop/tests/Whizbang.Generators.Component.Tests/BuildCost/SyntaxCandidateGuardTests.cs),
covers the cost a generator adds to code that is not Whizbang's. A syntax predicate runs on every node
of every changed file, and each node it admits goes to a transform that binds symbols, so a broad
predicate costs a share of your whole build however little of Whizbang you use. The guard requires
every predicate in every generator package to be a public static `Is...Candidate` method, then runs
each one over a corpus of ordinary code and fails naming any predicate that admits a node. A predicate
that cannot be narrowed without changing output needs an explicit exemption with a reason.
{verified: SyntaxCandidateGuardTests.EveryCandidateMethod_AdmitsNoOrdinaryCodeAsync}

The generated JSON files check, `scripts/build-cost/Test-GeneratedJsonFiles.ps1`, builds a small
consumer with `EmitCompilerGeneratedFiles` off. It fails unless the default build writes the ledger
and no registry or generated source, a build with `WhizbangEmitMessageRegistry=true` writes the
registry too, a new `[PinnedId]` message reaches both files, and a build with nothing changed
compiles nothing and runs neither extraction step.

The build memory guard, `.github/scripts/Invoke-BuildWithinMemory.ps1`, runs the build and samples the
memory of its processes and the compiler server every two seconds. A build that fails keeps its own
exit code; a build that succeeds over the budget fails with an error naming the peak. The budget leaves
headroom below the 16 GB of a hosted CI runner, so growth shows up as a failed check on the pull
request that caused it, not as a runner that runs out of memory and hangs. The CI builds also set
`DOTNET_GCConserveMemory=7`, which makes the shared compiler server return memory between projects
instead of holding what the largest one used.

The timing job is described in [The build-cost benchmark](#the-build-cost-benchmark) below.

## The build-cost benchmark

The library repository's `benchmarks/Whizbang.BuildCost.Benchmarks` tool measures how long each of
Whizbang's generators and analyzers takes over a large generated consumer.

**What it measures.** The tool generates a consumer project of 1,000 features (each a set of messages,
receptors and perspectives) and 3,000 files of ordinary code, then runs every generator and analyzer in
the five generator packages over it, as a build does. Each generator runs with a fresh generator driver
per run and reports its own time; each analyzer assembly is timed over the compilation the generators
produced. One warm-up run is discarded, and each number is the median of five timed runs. The report
has one row per generator, one per analyzer assembly, and a total for each, with its threshold and
whether it passed.

**The thresholds.** `benchmarks/Whizbang.BuildCost.Benchmarks/build-cost-thresholds.json` holds a
threshold in milliseconds for each generator, for each analyzer assembly, and for the generators and
analyzers in total. A row slower than its threshold is marked over, and the tool exits with a failure.
The initial values were set at about six times a local measurement (a CI runner assumed twice as slow,
then a margin of three) with a 500 ms floor, and are tightened from the job's results. After their fixes
in [whizbang#2481](https://github.com/whizbang-lib/whizbang/pull/2481), the perspective runner and
receptor generators were tightened to about 2.5 times a build-server measurement:

| Threshold | Before | After |
|-----------|--------|-------|
| `PerspectiveRunnerGenerator` | 25,900 ms | 2,300 ms |
| `ReceptorDiscoveryGenerator` | 24,300 ms | 5,300 ms |
| All generators (`generatorsTotalMs`) | 94,800 ms | 52,200 ms |

**Where it runs.** The "Build Cost Timing" workflow (job "Build · Generator and analyzer timing") runs
the tool on a GitHub-hosted runner when a pull request or a push to `develop` changes the generator
projects, the repository's analyzers or the benchmark, every Monday, and on demand. Its report is the
job summary and an artifact. Timing varies from run to run, so the check is advisory: no ruleset
requires it.

**Running it yourself.** From the library repository, build the benchmark (which builds the generator
packages), then run it:

```bash{
title: "Run the build-cost benchmark"
description: "Builds the generator packages and the benchmark, then times every generator and analyzer over the generated consumer against the thresholds file."
category: "Performance"
difficulty: "INTERMEDIATE"
tags: ["build", "benchmark", "source-generators", "analyzers"]
}
dotnet build benchmarks/Whizbang.BuildCost.Benchmarks -c Release
dotnet run -c Release --no-build --framework net11.0 --project benchmarks/Whizbang.BuildCost.Benchmarks -- --output timing.md
```

| Option | Default | Meaning |
|--------|---------|---------|
| `--runs` | 5 | Timed runs after the warm-up |
| `--features` | 1000 | Features of messages, receptors and perspectives in the consumer |
| `--ordinary-files` | 3000 | Files of ordinary code in the consumer |
| `--thresholds` | the copy beside the tool | The thresholds file to compare against |
| `--output` | none | Also write the report to this file |
{verified: BuildCostBenchmarkTests.Options_Defaults_AreFiveRunsOverAThousandFeaturesAndThreeThousandFilesAsync, BuildCostBenchmarkTests.Options_Parse_ReadsEveryOptionAsync, BuildCostBenchmarkTests.Evaluate_ComparesEachKindWithItsOwnThresholdAsync, BuildCostBenchmarkTests.Thresholds_Parse_ReadsEveryMapAndTotalAsync}

Smaller `--features` values are useful for seeing how a generator's time grows with the size of the
consumer.

### Generator time by consumer size

[whizbang#2481](https://github.com/whizbang-lib/whizbang/pull/2481) fixed the two generators whose time
grew fastest with the consumer:

- **Perspective runner generator.** It copied and edited the full runner template, about 190 KB of
  text, for every perspective. The shared logic is now emitted once per assembly (see
  [Perspective runners](#perspective-runners)), and the per-runner template is read once per run.
- **Receptor discovery generator.** A receptor declared on an interface or base type is widened to the
  concrete messages that implement it, and every non-sealed message class counts as polymorphic, so a
  large consumer asks for hundreds of them. Each was found by its own walk of every type in the
  compilation and its references. One walk now answers them all, with the same subtypes in the same
  order.
{verified: ConcreteSubtypeIndexTests.Build_ExaminesEachTypeOnce_WhateverTheNumberOfBaseTypesAsync, ConcreteSubtypeIndexTests.SubtypesOf_ABaseClass_AreTheConcreteClassesThatInheritItInDiscoveryOrderAsync, ConcreteSubtypeIndexTests.SubtypesOf_TwoNamesOfOneType_AreTheSameSubtypes_EachListedOnceAsync}

Measured on a build server, median of three runs, with 3,000 files of ordinary code:

| Features | Perspective runner generator | Receptor discovery generator | All generators |
|----------|------------------------------|------------------------------|----------------|
| 250 | 7,796 ms, now 383 ms | 3,431 ms, now 970 ms | 28.2 s, now 19.3 s |
| 500 | 15,111 ms, now 597 ms | 6,289 ms, now 1,320 ms | 40.8 s, now 21.5 s |
| 1,000 | 32,089 ms, now 911 ms | 13,453 ms, now 2,102 ms | 69.2 s, now 26.8 s |

Nothing changes in your project: a large consumer builds faster.

## Keeping your own build fast

**Generated files on disk.** The generators package does not write generated files to disk. The
[pinned-type ledger](../../fundamentals/identity/pinned-type-ledger) is on by default and is read
from the built assembly after each compile, so it stays current without any generated files. The
[message registry](../../extending/source-generators/message-registry) is IDE tooling for the VS Code
extension and is off by default. Both extraction steps are skipped on a build that did not recompile.
If you use the VS Code extension, turn the registry on in the project:

```xml{
title: "Turn on the message registry for the VS Code extension"
description: "Embeds the message registry in the assembly and writes .whizbang/cache/message-registry.json after each build that recompiles."
category: "Performance"
difficulty: "BEGINNER"
tags: ["build", "source-generators", "WhizbangEmitMessageRegistry", "msbuild"]
}
<PropertyGroup>
  <WhizbangEmitMessageRegistry>true</WhizbangEmitMessageRegistry>
</PropertyGroup>
```

To inspect the generated code, set `EmitCompilerGeneratedFiles` to `true`. The files go to
`.whizbang/cache/` unless your project sets `CompilerGeneratedFilesOutputPath`. Writing them costs a
little disk time on every build, so leave it off when you are not reading them. Neither the ledger
nor the registry depends on it.

**Check `ReportAnalyzer` output now and then.** If a Whizbang analyzer or generator shows up near the
top of your build's analyzer list, or its time grows out of proportion to your project, report it with
the log attached.

## Related

- [Performance Tuning](../deployment/performance-tuning): runtime performance
- [Message Registry](../../extending/source-generators/message-registry)
- [Pinned-Type Ledger](../../fundamentals/identity/pinned-type-ledger)
