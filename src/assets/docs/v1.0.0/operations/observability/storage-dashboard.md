---
title: Storage Dashboard
pageType: guide
verifiedAgainstCommit: 9ea0fecd
verifiedDate: 2026-10-29
version: 1.0.0
category: Observability
order: 10
description: >-
  The Grafana dashboard for storage that ships in the library repository: how to import it, its
  variables, what each panel shows and the PromQL behind it, and the test that keeps its queries in
  step with the meters.
tags: 'grafana, dashboard, storage, metrics, prometheus, table-statistics, bloat, growth, event-store, maintenance, capabilities'
codeReferences:
  - dashboards/grafana/whizbang-storage.json
  - src/Whizbang.Core/Observability/TableStatisticsMetrics.cs
  - src/Whizbang.Core/Observability/MaintenanceMetrics.cs
  - src/Whizbang.Core/Capabilities/CapabilityMetrics.cs
  - src/Whizbang.Core/Observability/WhizbangMeters.cs
testReferences:
  - tests/Whizbang.Documentation.Component.Tests/StorageDashboardTests.cs
  - tests/Whizbang.Documentation.Component.Tests/DeclaredInstruments.cs
---

# Storage Dashboard

`dashboards/grafana/whizbang-storage.json` in the library repository is a Grafana dashboard for a service's storage: how large every `wh_` table is and what the size is made of, how fast it grows, which tables carry space they cannot use and what maintenance is doing about it, which event types the event store's bytes belong to, and the state of the storage extensions. It reads three meters through Prometheus: `Whizbang.TableStatistics`, `Whizbang.Maintenance` and `Whizbang.Capabilities` (see the [Metrics Reference](metrics#table-statistics)).

{verified: StorageDashboardTests.EveryMetricTheDashboardNames_IsDeclaredByAMeterInTheLibraryAsync, StorageDashboardTests.TheDashboard_NamesNoEnvironment_ItsDataSourceAndScopeAreVariablesAsync}

## Import it {#import}

1. Export the three meters. `WhizbangMeters.All` names every meter the library creates, these three included:

   ```csharp{title="Export every Whizbang meter to Prometheus" description="Adds every meter the library creates, the storage meters among them, to the OpenTelemetry metrics pipeline with a Prometheus exporter" framework="NET10" category="Observability" difficulty="BEGINNER" tags=["metrics", "prometheus", "opentelemetry", "dashboard"] unverified="host wiring for a third-party exporter; the meter list is verified by the metrics reference"}
   builder.Services.AddOpenTelemetry()
       .WithMetrics(metrics => {
         metrics.AddMeter([.. WhizbangMeters.All]);
         metrics.AddPrometheusExporter();
       });
   ```

2. In Grafana, open **Dashboards**, **New**, **Import**, and upload `whizbang-storage.json` (or paste its contents).
3. Choose the Prometheus data source in the **Data source** variable at the top of the dashboard. Nothing else in the file names an environment.

The dashboard's `uid` is `whizbang-storage`, so importing a newer copy replaces the older one rather than adding a second.

## Variables {#variables}

{verified: StorageDashboardTests.TheDashboard_NamesNoEnvironment_ItsDataSourceAndScopeAreVariablesAsync, StorageDashboardTests.TheLiteralSelectorCheck_SeesANamedDatabaseAsync, StorageDashboardTests.TheRewriteThreshold_DefaultsToTheDatabasesDefaultOfThreeAsync}

| Variable | What it selects | Default |
|----------|-----------------|---------|
| `datasource` | The Prometheus data source | The first Prometheus data source |
| `job` | The service, by the `job` label Prometheus gives its series | All |
| `database` | The database, by the `database` tag every table-statistics gauge carries ([One series per database](metrics#table-statistics-database)) | All |
| `rewrite_threshold` | Where the bloat panel draws its rewrite line | `3` |

Why they are what they are:

- **No environment is named in the file.** Every panel and every variable query takes its data source from `${datasource}`, and every query selects the service and the database through `$job` and `$database`, never by a name. One file serves every deployment, and a deployment's names never reach the repository. A test fails if any data source in the file is not the variable or any query matches `job` or `database` against a literal. {verified: StorageDashboardTests.TheDashboard_NamesNoEnvironment_ItsDataSourceAndScopeAreVariablesAsync, StorageDashboardTests.TheLiteralSelectorCheck_SeesANamedDatabaseAsync}
- **`rewrite_threshold` is a text box, default 3.** The maintenance cycle queues a table for a rewrite at the database setting `table_rewrite_bloat_threshold`, whose default is 3.0 ([how bloat is measured](../infrastructure/storage-maintenance#how-bloat-is-measured)). Grafana cannot read that setting, so the line is a variable: set it to the service's value if it was changed. {verified: StorageDashboardTests.TheRewriteThreshold_DefaultsToTheDatabasesDefaultOfThreeAsync}
- **The maintenance panels select by `job` only.** The maintenance meter is not per database, so it has no `database` tag to select on.

## What each panel shows {#panels}

Every instance of a service reports the same catalog reading for the same table, and the event-type sample is reported by one instance at a time. So every query over a table-statistics gauge first takes the **max across instances** for each table (or event type and part) in each database, and only then sums. A plain `sum()` would count each table once per running instance. {verified: StorageDashboardTests.EveryTableStatisticsQuery_TakesTheMaxAcrossInstancesAsync, StorageDashboardTests.TheMaxCheck_SeesAPlainSumAsync}

```promql{title="Total size of every wh_ table, each table counted once" description="Takes the largest reading of each table across instances, then sums the tables, so the total does not grow with the number of instances" category="Observability" difficulty="INTERMEDIATE" tags=["grafana", "prometheus", "table-statistics", "storage"] tests=["StorageDashboardTests.EveryTableStatisticsQuery_TakesTheMaxAcrossInstancesAsync"]}
sum(max by (database, table_name) (whizbang_table_estimated_bytes{job=~"$job",database=~"$database"}))
```

### Size {#panels-size}

| Panel | Shows | Reads |
|-------|-------|-------|
| Total size | Every `wh_` table: heap, TOAST and indexes | `whizbang_table_estimated_bytes` |
| Event store share | `wh_event_store` plus `wh_event_body` as a share of the total | `whizbang_table_estimated_bytes` |
| Growth, last day | How much every table together grew over 24 hours | `delta()` of `whizbang_table_estimated_bytes` |
| Live rows | Every table's planner row estimate, summed | `whizbang_table_live_rows` |
| Largest tables | The fifteen largest tables over time | `whizbang_table_estimated_bytes` |
| Size by component | Heap, TOAST and index bytes, stacked; they add up to the total | `whizbang_table_component_bytes` |
| Components per table | The split for each of the largest tables | `whizbang_table_component_bytes` |

### Growth {#panels-growth}

Growth has no instrument of its own: it is the change in the size and row gauges, which every Prometheus-compatible backend computes.

| Panel | Shows | Reads |
|-------|-------|-------|
| Growth per day, total | Bytes added per day: the derivative over 6 hours, scaled to a day, so a burst shows within hours | `deriv()` of `whizbang_table_estimated_bytes` |
| Fastest-growing tables | The ten tables that grew most in 24 hours | `delta()` of `whizbang_table_estimated_bytes` |
| Rows added per day | The ten tables whose row count grew most in 24 hours | `delta()` of `whizbang_table_live_rows` |
| Bytes per row | Size over live rows for the largest tables. Tables with no rows are left out rather than divided by zero. A rising line under a flat row count is bloat or wider rows | `whizbang_table_estimated_bytes`, `whizbang_table_live_rows` |

```promql{title="Bytes added per day across every wh_ table" description="The per-second derivative of each table's size over six hours, taken once per table, summed and scaled to a day" category="Observability" difficulty="INTERMEDIATE" tags=["grafana", "prometheus", "growth", "storage"] tests=["StorageDashboardTests.EveryMetricTheDashboardNames_IsDeclaredByAMeterInTheLibraryAsync"]}
sum(max by (database, table_name) (deriv(whizbang_table_estimated_bytes{job=~"$job",database=~"$database"}[6h]))) * 86400
```

### Bloat and rewrites {#panels-bloat}

| Panel | Shows | Reads |
|-------|-------|-------|
| Bloat ratio | The ten highest ratios, one line per table and `method`, with the rewrite threshold as a dashed line. `method="estimate"` is the catalog estimate every table has; `method="approx"` is a measurement taken before a table is queued for a rewrite | `whizbang_table_bloat_ratio` |
| Measured for a rewrite | The tables measured with `pgstattuple_approx`, with the measured ratio. One at or over the threshold is in the rewrite queue | `whizbang_table_bloat_ratio{method="approx"}` |
| Maintenance rows by task | Rows each maintenance task removed or processed per second. A reaping task at zero while its table grows is losing to churn | `whizbang_maintenance_rows_affected_total` |
| Maintenance task duration, p95 | Each task's per-cycle wall time at the 95th percentile | `whizbang_maintenance_task_duration_milliseconds_bucket` |
| Unused index bytes | Indexes nothing has scanned since the statistics were last reset, largest first. A report only: nothing is dropped ([Unused indexes](metrics#unused-indexes)) | `whizbang_table_unused_index_bytes` |

### Bytes per event type {#panels-event-types}

Read from the sampled event-type gauges, which split each type's bytes into parts: `data` and `metadata` in the body table, `pointer` for the event-store row, and `outbox_metadata` for the metadata outbox rows carry inline ([Parts](metrics#event-type-bytes-parts)).

| Panel | Shows | Reads |
|-------|-------|-------|
| Top event types by bytes | The fifteen largest types, every part counted | `whizbang_event_store_estimated_type_bytes` |
| Event store bytes by part | Where the bytes sit, stacked by part | `whizbang_event_store_estimated_type_bytes` |
| Bytes per event type by part | Each large type split into its parts | `whizbang_event_store_estimated_type_bytes` |
| Mean bytes per event by part | The mean stored size of one row of each part. Metadata larger than the payload is what slimming is for | `whizbang_event_store_sampled_bytes_per_event_bytes` |
| Metadata share | Body metadata and outbox metadata as a share of every sampled byte | `whizbang_event_store_estimated_type_bytes` |

### Extensions and queues {#panels-extensions}

| Panel | Shows | Reads |
|-------|-------|-------|
| Postgres capability state | Each storage extension and setting the Postgres provider probed, per database, with its state (`Ready`, `Provisionable`, `NotPermitted`, `NeedsServerChange`, `NoPrivilege`, `Missing`, `Unknown`) and whether the configuration requires it ([states](../infrastructure/postgres-extensions#states)) | `whizbang_capability_state{provider="postgres"}` |
| Queue depths | Unprocessed rows per queue: inbox, outbox and the dead-letter slices | `whizbang_queue_estimated_depth_messages` |

## Metric names in Prometheus {#prometheus-names}

{verified: StorageDashboardTests.TheExposedName_FollowsTheUnitAndTheKind_SoAWrongSuffixIsReportedAsync, StorageDashboardTests.PrometheusUnit_SpellsTheUnitTheWayTheExporterDoesAsync}

The queries use the names the OpenTelemetry Prometheus exporter gives the instruments: dots become underscores, the unit is appended unless the name already ends with it (with `ms` spelled `milliseconds`, `s` spelled `seconds`, `By` spelled `bytes`, and an annotation in braces such as `{message}` dropped), a counter gains `_total`, and a histogram is exposed as `_bucket`, `_sum` and `_count`. So `whizbang.table.estimated_bytes` (unit `bytes`) is `whizbang_table_estimated_bytes`, but `whizbang.event_store.sampled_bytes_per_event` (unit `bytes`) is `whizbang_event_store_sampled_bytes_per_event_bytes`, and `whizbang.maintenance.task_duration` (unit `ms`) is read as `whizbang_maintenance_task_duration_milliseconds_bucket`.

## The drift test {#drift-test}

{verified: StorageDashboardTests.EveryMetricTheDashboardNames_IsDeclaredByAMeterInTheLibraryAsync, StorageDashboardTests.AMetricNoMeterDeclares_IsReportedAsync, StorageDashboardTests.TheDeclaredInstruments_AreReadFromTheMeterDefinitionsAsync, StorageDashboardTests.Parse_ReadsPositionalUnits_ConstantNames_AndSkipsForwardersAsync}

A renamed instrument would leave a panel that silently shows nothing, so `StorageDashboardTests` fails the build instead. It reads every `whizbang_` metric the dashboard's panel queries and variable queries name, and requires each to be a name a meter in the library declares, as Prometheus exposes it.

```mermaid{caption="The drift test: the declared names come from the meter definitions in src/, never from a list kept by hand, and every metric the dashboard names must be one of them." tests=["StorageDashboardTests.EveryMetricTheDashboardNames_IsDeclaredByAMeterInTheLibraryAsync", "StorageDashboardTests.AMetricNoMeterDeclares_IsReportedAsync", "StorageDashboardTests.TheDeclaredInstruments_AreReadFromTheMeterDefinitionsAsync"]}
flowchart LR
  S["src/**/*.cs<br/>meter.Create...(name, unit)"] --> D[Declared instruments<br/>name, unit, kind]
  D --> P[Prometheus names<br/>unit suffix, _total, _bucket]
  J[whizbang-storage.json<br/>every expr and variable query] --> N[Metrics named]
  P --> C{Every named metric declared?}
  N --> C
  C -->|yes| G[Pass]
  C -->|no| F[Fail, naming the metric]
```

How the declared names are found, and why:

- **From the meter definitions, not a list.** Every call to a meter's factory methods (`CreateCounter`, `CreateHistogram`, `CreateObservableGauge` and the rest, and the library's `CreatePassiveCounter`) in the C# source under `src/` is read for its name, unit and kind. A list kept by hand would drift exactly the way the test exists to catch. {verified: StorageDashboardTests.TheDeclaredInstruments_AreReadFromTheMeterDefinitionsAsync}
- **Names and units given by constants are resolved**, from the same file or, where a constant is declared once, from anywhere in the source. A constant declared twice with different values resolves to nothing rather than to either, so an ambiguous name cannot pass by luck.
- **A forwarder is skipped.** A call whose name is a parameter (as inside `PassiveCounter` itself) declares nothing of its own; the instrument is declared where the name is written. {verified: StorageDashboardTests.Parse_ReadsPositionalUnits_ConstantNames_AndSkipsForwardersAsync}
- **The suffix must be right, not just the stem.** A query naming an instrument without its unit suffix, a gauge with `_total` or a counter without it reads nothing in Prometheus, so each fails the test. {verified: StorageDashboardTests.TheExposedName_FollowsTheUnitAndTheKind_SoAWrongSuffixIsReportedAsync}
- **It cannot pass vacuously.** It requires more than ten named metrics, and a control test shows a misspelled name being reported. {verified: StorageDashboardTests.AMetricNoMeterDeclares_IsReportedAsync}
- **Component, not unit.** The test reads the repository's source and the dashboard from the file system, which puts it in `Whizbang.Documentation.Component.Tests`.

A panel added to the dashboard is checked from the moment it is saved to the file; a metric it needs that no meter declares yet fails the build until the meter exists.
