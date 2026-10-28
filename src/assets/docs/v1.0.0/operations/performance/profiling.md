---
title: Profiling a Service Running Whizbang
pageType: guide
audience: [consumer]
verifiedAgainstCommit: 0d3c20e63
verifiedDate: 2026-10-28
version: 1.0.0
category: Performance
order: 2
description: >-
  How to profile a service that runs Whizbang: the triage order from dotnet-counters to dotnet-trace
  to Linux perf, the Whizbang meters and traces to start from for a slow outbox drain, an inbox
  backlog or perspective lag, when to go to the database instead, lock contention and allocation
  traces, and the runtime settings a host can try and measure.
tags: >-
  profiling, performance, dotnet-counters, dotnet-trace, perf, contention, allocations, thread pool,
  server gc, DATAS, sockets, runtime settings
codeReferences:
  - src/Whizbang.Core/Observability/TransportMetrics.cs
  - src/Whizbang.Core/Observability/PerspectiveMetrics.cs
  - src/Whizbang.Core/Observability/WorkCoordinatorMetrics.cs
  - src/Whizbang.Core/Observability/InboxMetrics.cs
  - src/Whizbang.Core/Observability/PinnedPoolMetrics.cs
  - src/Whizbang.Core/Observability/TableStatisticsMetrics.cs
  - src/Whizbang.Core/Observability/WhizbangMeters.cs
  - src/Whizbang.Core/Observability/WhizbangActivitySource.cs
  - src/Whizbang.Data.Postgres/Notifications/NotifyMetrics.cs
  - src/Whizbang.Observability/DependencyInjection/WhizbangMeterRegistration.cs
testReferences:
  - tests/Whizbang.Core.Tests/Observability/TransportMetricsTests.cs
  - tests/Whizbang.Core.Tests/Observability/PerspectiveMetricsTests.cs
  - tests/Whizbang.Core.Tests/Observability/WorkCoordinatorMetricsTests.cs
  - tests/Whizbang.Core.Tests/Observability/InboxMetricsTests.cs
  - tests/Whizbang.Observability.Tests/WhizbangActivitySourceTests.cs
  - tests/Whizbang.Observability.Tests/DependencyInjection/WhizbangMeterRegistrationTests.cs
---

# Profiling a Service Running Whizbang

This page shows how to find out why a service that runs Whizbang is slow: which tool to reach for
first, which Whizbang meters and traces narrow the search, and when the answer is in the database
rather than in the process. It ends with a table of runtime settings the hosting application can try
and measure.

:::tip
This page adapts Egor Bogatov's [Blazing Fast .NET](https://github.com/EgorBo/BlazingFastDotnet)
guide (MIT license) to services running Whizbang. The upstream guide goes further into code-level
tuning, JIT codegen and NativeAOT, and is worth reading in full. It is not official Microsoft
guidance, and neither are the settings below.
:::

## Start in the database

Most slowdowns seen in Whizbang services so far have been in SQL, not in .NET code: a claim query
that scans a growing table, a notification query that scans the outbox, or maintenance running
during a bulk load. The Whizbang workers spend most of their time waiting on the database, so a
slow statement shows up in the process as a worker that is idle and waiting, not one that is busy.
A CPU profile of the process will not find it.

Before you profile the process, look at the statement statistics. These pages cover it:

- [Work coordinator performance tuning](../../fundamentals/work-coordinator/performance-tuning.md#measurement)
  ranks the coordinator's statements from `pg_stat_statements` and maps symptoms to settings.
- [Table statistics](../observability/metrics.md#table-statistics) reports queue depths, table
  sizes and bloat as metrics, and [unused indexes](../observability/metrics.md#unused-indexes).
- [Postgres extensions](../infrastructure/postgres-extensions.md) explains how to make
  `pg_stat_statements` available.
- [Storage maintenance](../infrastructure/storage-maintenance.md) covers vacuum, retention and the
  maintenance tasks that compete with the workload.
- [Troubleshooting: high latency](../deployment/troubleshooting.md#issue-4-high-latency) covers the
  slow query log and missing indexes.

Profile the process when the database is not the bottleneck: its CPU is low, statements are fast,
and the service still falls behind.

## Triage order

Start with the cheapest tool and go deeper only when it cannot answer the question.

```mermaid{caption="Profiling triage: counters say what kind of bottleneck it is, traces say where, perf and JIT disassembly say why."}
flowchart LR
  A[Service is slow] --> B{Database busy or<br/>statements slow?}
  B -- yes --> DB[Statement statistics<br/>and table statistics]
  B -- no --> C[dotnet-counters<br/>what kind of bottleneck]
  C --> D[dotnet-trace<br/>where]
  D --> E[Linux perf and<br/>JIT disassembly<br/>why]
```

Install the tools once:

```bash{
title: "Install the .NET diagnostic tools"
description: "Installs dotnet-counters, dotnet-trace and dotnet-symbol as global tools."
category: "Performance"
difficulty: "BEGINNER"
tags: ["profiling", "dotnet-counters", "dotnet-trace", "dotnet-symbol"]
}
dotnet tool install -g dotnet-counters
dotnet tool install -g dotnet-trace
dotnet tool install -g dotnet-symbol
```

In a container, either install the tools in the image you profile or run them from a sidecar that
shares the process namespace. Microsoft's
[diagnostics in containers](https://learn.microsoft.com/dotnet/core/diagnostics/diagnostics-in-containers)
page covers both.

### 1. dotnet-counters: what kind of bottleneck

[dotnet-counters](https://learn.microsoft.com/dotnet/core/diagnostics/dotnet-counters) is a
low-overhead first look. Run it while the service is under its normal load, not while it is idle.
It reads both the runtime's counters and any `Meter` by name, so the Whizbang meters work with it
directly:

```bash{
title: "Watch runtime and Whizbang meters together"
description: "Monitors the System.Runtime meter next to the Whizbang meters for the outbox, inbox, perspectives and work coordinator, then saves the same set to CSV for later comparison."
category: "Performance"
difficulty: "BEGINNER"
tags: ["profiling", "dotnet-counters", "metrics", "meters"]
}
dotnet-counters monitor -p <pid> \
  --counters System.Runtime,Whizbang.Transport,Whizbang.Perspectives,Whizbang.WorkCoordinator

dotnet-counters collect -p <pid> --format csv -o counters.csv \
  --counters System.Runtime,Whizbang.Transport,Whizbang.Perspectives,Whizbang.WorkCoordinator,Npgsql
```

Read the runtime counters ([System.Runtime metrics](https://learn.microsoft.com/dotnet/core/diagnostics/built-in-metrics-runtime))
for the shape of the problem:

| What you see | What it suggests | Next step |
|--------------|------------------|-----------|
| `dotnet.process.cpu.time` near the core count | CPU bound in the process | A CPU trace (below) |
| CPU low, work still slow | Waiting: database, broker, a lock or the thread pool | The Whizbang timings below, then a contention trace |
| `dotnet.thread_pool.queue.length` keeps growing | Thread pool starvation, often blocking calls on pool threads | A trace with the default profiles; look for sync-over-async |
| `dotnet.monitor.lock_contentions` climbing quickly | Lock contention | [Contention trace](#lock-contention) |
| `dotnet.gc.pause.time` or `dotnet.gc.collections` high | Allocation pressure | [Allocation trace](#allocations) and the [GC settings](#runtime-settings) |
| `dotnet.exceptions` climbing | Exceptions on a hot path, often retries | Logs for the exception, then the retry counters below |

### 2. dotnet-trace: where

[dotnet-trace](https://learn.microsoft.com/dotnet/core/diagnostics/dotnet-trace) collects an
EventPipe trace on any OS without root. It sees managed frames only.

```bash{
title: "Collect and read a CPU trace"
description: "Collects ten seconds with the default profiles, prints the top methods as text, and converts the trace for speedscope."
category: "Performance"
difficulty: "INTERMEDIATE"
tags: ["profiling", "dotnet-trace", "cpu", "speedscope"]
}
# Default profiles: dotnet-common and dotnet-sampled-thread-time
dotnet-trace collect -p <pid> --duration 00:00:00:10

dotnet-trace report trace.nettrace topN -n 20               # top methods by exclusive time
dotnet-trace report trace.nettrace topN -n 20 --inclusive
dotnet-trace convert trace.nettrace --format Speedscope     # open at https://www.speedscope.app
```

The `cpu-sampling` profile that older guides use has been removed from `dotnet-trace collect`. The
defaults above replace it. Run `dotnet-trace list-profiles` to see what your version offers.

Take the trace once the service is warmed up and under load, the same as the counters. A trace taken
during startup is mostly JIT and migrations.

### 3. Linux perf and JIT disassembly: why

When a trace names a hot method and you need to know why it is slow (cache misses, false sharing,
bounds checks that were not removed), use Linux `perf`, which sees native frames and the generated
machine code. Set these in the service's environment before it starts:

```bash{
title: "Environment for profiling with Linux perf"
description: "Lets perf name JIT-compiled frames. Set on the profiled process only, not in normal production."
category: "Performance"
difficulty: "ADVANCED"
tags: ["profiling", "perf", "linux", "jit"]
}
DOTNET_PerfMapEnabled=1
DOTNET_PerfMapStubGranularity=3
DOTNET_JitFramed=1
DOTNET_EnableWriteXorExecute=0
```

[`DOTNET_PerfMapEnabled`](https://learn.microsoft.com/dotnet/core/runtime-config/debugging-profiling)
is documented by Microsoft and can add up to 20% overhead while code is being JIT-compiled. The other
three come from the upstream guide. None of them belong in a normal production deployment.

Wait for the service to reach steady state, then record and symbolize:

```bash{
title: "Record, symbolize and report with perf"
description: "Records five seconds of a warmed-up process, injects JIT symbols, and writes a text report, annotated assembly and a flame graph."
category: "Performance"
difficulty: "ADVANCED"
tags: ["profiling", "perf", "linux", "flamegraph"]
}
perf record -k 1 -g -F 3999 -p <pid> -o perf.data -- sleep 5
perf inject --input perf.data --jit --output perfjit.data

perf report --input perfjit.data --no-children --percent-limit 1 --stdio > perf_report.txt
perf annotate --stdio2 -i perfjit.data --percent-limit 1 -M intel > perf.asm

git clone --depth 1 https://github.com/brendangregg/FlameGraph
perf script -i perfjit.data | ./FlameGraph/stackcollapse-perf.pl | ./FlameGraph/flamegraph.pl > flamegraph.svg
```

If frames from the runtime or libraries show as addresses, download their symbols with
`dotnet-symbol --symbols <publish folder>/*.dll` (and `*.so`).

To see the machine code the JIT produced for one method, set `DOTNET_JitDisasm` to the method name
and `DOTNET_JitStdOutFile` to a file path on the service process. A method is compiled several times
as it tiers up; judge the last version, marked `Tier1` or `FullOpts`. The upstream guide's
[JIT codegen section](https://github.com/EgorBo/BlazingFastDotnet/blob/main/SKILL.md#inspecting-jit-codegen)
explains how to read it.

## Whizbang starting points

Whizbang publishes a `Meter` per subsystem; the [metrics reference](../observability/metrics.md)
lists every instrument. Subscribe all of them with `AddWhizbangInstrumentation()` rather than by name.
The three symptoms below cover most performance questions.

### Slow outbox drain

The outbox backlog grows, or events reach other services late.

| Instrument | Meter | What it tells you |
|------------|-------|-------------------|
| `whizbang.queue.estimated_depth` with `queue_name=outbox` | `Whizbang.TableStatistics` | Whether the backlog is growing or draining |
| `whizbang.transport.outbox.publish.duration` | `Whizbang.Transport` | Time spent sending to the broker |
| `whizbang.transport.outbox.readiness_wait.duration` | `Whizbang.Transport` | Time waiting for the transport to be ready |
| `whizbang.transport.outbox.publish_throttled`, `publish_retries`, `messages_failed` | `Whizbang.Transport` | The broker pushing back or failing sends |
| `whizbang.perspective.claim.duration` | `Whizbang.Perspectives` | Time of each `claim_work` call, which hands out outbox work as well as perspective work |
| `whizbang.work_coordinator.flush.duration` | `Whizbang.WorkCoordinator` | Time to store a flush's rows |

Read it this way:

- **Publish duration high, throttling non-zero:** the broker is the limit. Look at the broker's
  quotas and the transport's batching options, not at the process.
- **Claim or flush duration high:** the database is the limit. Go to
  [outbox publish throughput](../../fundamentals/work-coordinator/performance-tuning.md#outbox-publish-throughput-is-too-low)
  and the statement statistics.
- **All three low and the backlog still grows:** the publisher is not being woken or not getting
  threads. Check `whizbang.postgres.notifications.signals_received` on `Whizbang.Postgres.Notifications`,
  then take a trace.

### Inbox backlog

Messages wait on the broker, or the inbox table grows.

| Instrument | Meter | What it tells you |
|------------|-------|-------------------|
| `whizbang.queue.estimated_depth` with `queue_name=inbox` | `Whizbang.TableStatistics` | Stored messages not yet processed |
| `whizbang.transport.inbox.receive.duration` | `Whizbang.Transport` | The whole receive: store, process, complete |
| `whizbang.transport.inbox.dedup.duration` | `Whizbang.Transport` | The insert that stores and deduplicates the message |
| `whizbang.transport.inbox.processing.duration` | `Whizbang.Transport` | Your receptors and the lifecycle stages |
| `whizbang.transport.inbox.concurrency_wait.duration` | `Whizbang.Transport` | Time a message waited for a free handler slot |
| `whizbang.transport.inbox.concurrent_messages` | `Whizbang.Transport` | Handlers running now |
| `whizbang.inbox.dispatch.duration_ms` | `Whizbang.WorkCoordinator` | Per-message dispatch time, tagged with the message type |
| `whizbang.gate.hold_duration_ms` | `Whizbang.WorkCoordinator` | How long callers hold a work coordinator gate slot, tagged with the caller |

Read it this way:

- **Concurrency wait high, concurrent messages at the limit:** handlers are the bottleneck. If their
  processing time is mostly database time, adding concurrency adds load to the same database. See
  [inbox handler throughput](../../fundamentals/work-coordinator/performance-tuning.md#inbox-handler-throughput-is-too-low).
- **Dedup duration high:** the inbox insert is slow. That is a database question.
- **Dispatch duration high for one message type:** profile that receptor. Turn on the `Whizbang.Tracing`
  spans (below) to see its time per call.
- **Gate hold duration high:** something holds the coordinator gate. The gate's timeout warning
  names the holders; see [gate and inbox dispatch](../observability/metrics.md#work-coordinator).

### Perspective lag

Read models fall behind the events.

| Instrument | Meter | What it tells you |
|------------|-------|-------------------|
| `whizbang.perspective.batch.duration` | `Whizbang.Perspectives` | One drain cycle, end to end |
| `whizbang.perspective.claim.duration` | `Whizbang.Perspectives` | Claiming the work |
| `whizbang.perspective.event_load.duration` | `Whizbang.Perspectives` | Loading the events to apply |
| `whizbang.perspective.runner.duration` | `Whizbang.Perspectives` | Running your perspective code and saving the model, per stream |
| `whizbang.perspective.checkpoint.duration` | `Whizbang.Perspectives` | Reading the cursor |
| `whizbang.perspective.batch.event_count`, `batch.stream_groups` | `Whizbang.Perspectives` | How much each cycle carries |
| `whizbang.perspective.empty_batches` | `Whizbang.Perspectives` | Cycles that found no work |
| `whizbang.perspective.errors`, `rewinds` | `Whizbang.Perspectives` | Failures and rewinds that repeat work |

Compare the parts with the whole. When claim, event load and checkpoint make up most of the batch
time, the database is the limit. When the runner dominates, the cost is in the perspective's own code
or in saving its model; take a CPU trace and an [allocation trace](#allocations). Small batches with
few events and a high rate of empty batches mean the worker is caught up and waking often, which is
an idle cost, not lag.

### Connections

All three symptoms can come from waiting for a database connection rather than for a statement.

| Instrument | Meter | What it tells you |
|------------|-------|-------------------|
| `whizbang.workers.pinned_pool.borrow.duration`, `borrow.timeouts` | `Whizbang.Workers.PinnedPool` | Waiting for a [pinned worker connection](../../fundamentals/workers/pinned-connection-pool.md) |
| `db.client.connection.npgsql.pending_requests`, `db.client.connection.npgsql.timeouts` | `Npgsql` | Requests waiting for a pooled connection, and the ones that gave up |
| `db.client.connection.count`, `db.client.connection.max` | `Npgsql` | Pool usage against its limit |

A pool at its limit with requests pending looks like slow SQL from inside the process. Check it
before blaming a statement. Behind a connection pooler, see
[notifications and pgbouncer](../../fundamentals/work-coordinator/notifications-and-pgbouncer.md).

### Traces

Whizbang emits `Activity` spans from these sources. Add them to your OpenTelemetry tracing with
`AddSource`:

| ActivitySource | What it covers |
|----------------|----------------|
| `Whizbang.Execution` | Dispatch and the serial executor |
| `Whizbang.Transport` | Receiving a message from the transport |
| `Whizbang.Tracing` | Receptor invocations, lifecycle stages and perspective runs, when [tracing](../observability/tracing.md#configuration) turns them on |
| `Whizbang.Hosting` | Startup and transport provisioning |

A span shows how long a call took and what it was waiting on. It does not show why the process was
busy. Use spans to pick the slow operation, then a trace or perf to see inside it.

## Lock contention {#lock-contention}

When CPU is low, work is slow and `dotnet.monitor.lock_contentions` climbs, record contention events
with their stacks:

```bash{
title: "Collect a lock contention trace"
description: "Records the runtime's contention events, each with the stack that waited on the lock."
category: "Performance"
difficulty: "INTERMEDIATE"
tags: ["profiling", "dotnet-trace", "contention", "locks"]
}
dotnet-trace collect -p <pid> --clrevents contention --duration 00:00:00:30
```

Open the trace in PerfView or Visual Studio and group the contention events by stack. When the
stacks end in your own code, the fix is usually to hold the lock for less time or to split the shared
state; the upstream guide's
[contention section](https://github.com/EgorBo/BlazingFastDotnet/blob/main/SKILL.md#contention-on-shared-state)
shows striped counters and padding against false sharing. When they end in Whizbang code, open an
issue with the trace and the stacks.

`--clrevents` is ignored when a `--profile` or `--providers` option also configures the runtime
provider, so run it on its own.

## Allocations {#allocations}

When GC pause time or collection counts are high, find which types and stacks allocate:

```bash{
title: "Collect an allocation trace"
description: "Records garbage collections and sampled object allocations with their stacks."
category: "Performance"
difficulty: "INTERMEDIATE"
tags: ["profiling", "dotnet-trace", "allocations", "gc"]
}
dotnet-trace collect -p <pid> --profile gc-verbose --duration 00:00:00:30
```

The allocations are sampled, so read them as proportions, not totals. Large strings or byte arrays
on the receive path often come from message bodies; compare with
`whizbang.transport.body_offload.bytes` and the
[body offload](../observability/metrics.md#transport) counters. Before changing code to allocate
less, try the GC settings below and measure; they are cheaper to try and to undo.

## Runtime settings to measure {#runtime-settings}

These are settings of the .NET runtime, not of Whizbang. Whizbang sets none of them and does not
depend on any of them. The hosting application chooses them, sets them in its own environment or
`runtimeconfig.json`, and keeps them only if a measurement shows a gain.

:::warning[These can stop helping]
Each of these trades one cost for another, and the right value depends on the workload, the hardware
and the .NET version. The runtime's own defaults change between versions (the thread pool spin limit
below is 70 in .NET 10 and 1024 on the runtime's main branch), so a setting that helped on one
version can do nothing, or hurt, on the next. Change one at a time, measure it under real load
against a baseline, write down why you kept it, and measure it again after every .NET upgrade.
:::

Environment variable values for the thread pool and GC settings are read as hexadecimal: `20` means
32. Values in `runtimeconfig.json` are decimal. Write hex values with a `0x` prefix to avoid the
mistake.

| Setting | Environment variable | `runtimeconfig.json` property | Default | Try | Measure | Verified against |
|---------|----------------------|-------------------------------|---------|-----|---------|------------------|
| Thread pool spin limit | `DOTNET_ThreadPool_UnfairSemaphoreSpinLimit` (hex) | `System.Threading.ThreadPool.UnfairSemaphoreSpinLimit` | 70 in .NET 10 | `0` to stop idle workers spinning; `0x400` to favor wake latency | CPU time when idle and under load; throughput | Runtime source: [release/10.0](https://github.com/dotnet/runtime/blob/release/10.0/src/libraries/System.Private.CoreLib/src/System/Threading/PortableThreadPool.WorkerThread.cs), [main](https://github.com/dotnet/runtime/blob/main/src/libraries/System.Private.CoreLib/src/System/Threading/LowLevelLifoSemaphore.cs) |
| Thread pool hill climbing | `DOTNET_HillClimbing_Disable` | `System.Threading.ThreadPool.HillClimbing.Disable` | Enabled | `1` in the environment, `true` in `runtimeconfig.json`, to disable | Time to steady state; `dotnet.thread_pool.thread.count` swinging | Runtime source: [PortableThreadPool.HillClimbing.cs](https://github.com/dotnet/runtime/blob/release/10.0/src/libraries/System.Private.CoreLib/src/System/Threading/PortableThreadPool.HillClimbing.cs) |
| Server GC | `DOTNET_gcServer` | `System.GC.Server` (MSBuild `ServerGarbageCollection`) | Workstation for a standalone app; a host such as ASP.NET Core chooses its own | `1` | Throughput, GC pause time, memory | [GC configuration: workstation vs. server](https://learn.microsoft.com/dotnet/core/runtime-config/garbage-collector#workstation-vs-server) |
| DATAS | `DOTNET_GCDynamicAdaptationMode` | `System.GC.DynamicAdaptationMode` (MSBuild `GarbageCollectionAdaptationMode`) | `1`, on since .NET 9 | `0` to turn off; prefer tuning the two below first | Throughput against memory | [GC configuration: DATAS](https://learn.microsoft.com/dotnet/core/runtime-config/garbage-collector#dynamic-adaptation-to-application-sizes-datas) |
| DATAS target TCP | `DOTNET_GCDTargetTCP` (hex) | `System.GC.DTargetTCP` | 2 (percent) | `1` to add heaps sooner | GC pause time, heap count, memory | [GC configuration: target TCP](https://learn.microsoft.com/dotnet/core/runtime-config/garbage-collector#target-tcp) |
| DATAS gen0 budget | `DOTNET_GCDGen0GrowthPercent` (hex) | `System.GC.DGen0GrowthPercent` | 100 (percent) | `0xC8` (200) for fewer gen0 collections | Gen0 collections against memory | [GC configuration: gen0 max budget](https://learn.microsoft.com/dotnet/core/runtime-config/garbage-collector#gen0-max-budget-settings), .NET 10 and later |
| Socket inline completions | `DOTNET_SYSTEM_NET_SOCKETS_INLINE_COMPLETIONS` | None | `0` | `1` | Throughput and latency of database and broker calls | [Networking configuration](https://learn.microsoft.com/dotnet/core/runtime-config/networking#socket-inline-completions) |
| Socket thread count | `DOTNET_SYSTEM_NET_SOCKETS_THREAD_COUNT` (decimal) | None | Calculated; the processor count when inline completions are on | `1` to the processor count | Same as above | [Networking configuration](https://learn.microsoft.com/dotnet/core/runtime-config/networking#socket-thread-count) |

Notes on each:

- **Thread pool spin limit and hill climbing** apply to the portable thread pool, which .NET uses on
  every OS unless the application turns on `UseWindowsThreadPool`. Neither is in Microsoft's runtime
  configuration docs; the names above are the ones the runtime reads, linked to its source. A service
  that is idle most of the time and still uses CPU is the case where `0` for the spin limit is worth
  measuring.
- **Server GC** uses more memory than workstation GC in exchange for throughput, and with DATAS on it
  starts with one heap and adds heaps under load. Measure memory as well as throughput, and set
  container memory limits with it in mind.
- **Socket inline completions** run the code after an `await` on a socket directly on the I/O thread.
  In a Whizbang service that code includes database driver and broker client continuations and
  whatever runs after them. If any of it blocks or runs long, every socket served by that thread
  waits. The setting applies to Linux and macOS, where .NET uses its own socket event loop.

To set them in the project rather than the environment, use `runtimeconfig.template.json` next to
the project file:

```json{
title: "Runtime settings in runtimeconfig.template.json"
description: "Sets server GC with DATAS tuned and the thread pool spin limit for the hosting application. Values here are decimal. Illustrative values only: measure each one before keeping it."
category: "Performance"
difficulty: "ADVANCED"
tags: ["runtime settings", "gc", "DATAS", "thread pool", "runtimeconfig"]
}
{
  "configProperties": {
    "System.GC.Server": true,
    "System.GC.DGen0GrowthPercent": 200,
    "System.Threading.ThreadPool.UnfairSemaphoreSpinLimit": 0
  }
}
```

Socket settings have no `runtimeconfig.json` form; set them as environment variables in the
deployment.

## See also

- [Blazing Fast .NET](https://github.com/EgorBo/BlazingFastDotnet), the upstream guide this page
  adapts (MIT license)
- [Metrics reference](../observability/metrics.md)
- [Tracing](../observability/tracing.md)
- [Performance tuning](../deployment/performance-tuning.md)
- [Troubleshooting guide](../deployment/troubleshooting.md)
- [Work coordinator performance tuning](../../fundamentals/work-coordinator/performance-tuning.md)
- [Build cost](build-cost.md), for what the analyzers and generators add to a build
