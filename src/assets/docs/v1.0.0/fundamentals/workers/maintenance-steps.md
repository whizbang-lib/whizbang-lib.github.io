---
title: Maintenance Steps
pageType: concept
version: 1.0.0
category: Fundamentals
order: 11
description: >-
  How a package adds work to the periodic maintenance cycle, and why work that
  reads or repairs stored state belongs there rather than on a timer of its own.
tags: 'workers, maintenance, housekeeping, settledness, extension'
codeReferences:
  - src/Whizbang.Core/Workers/IMaintenanceStep.cs
  - src/Whizbang.Core/Workers/MaintenanceWorker.cs
testReferences:
  - tests/Whizbang.Core.Tests/Workers/MaintenanceWorkerStepTests.cs
---

# Maintenance steps {#maintenance-steps}

{verified: MaintenanceWorkerStepTests.Cycle_RunsEveryRegisteredStep_InRegistrationOrderAsync, MaintenanceWorkerStepTests.Step_ReceivesTheCyclesScopedProviderAsync, MaintenanceWorkerStepTests.FailingStep_IsLogged_AndTheNextStepStillRunsAsync, MaintenanceWorkerStepTests.CanceledStep_PropagatesCancellationAsync}

The maintenance worker runs the framework's housekeeping on an interval: retention sweeps, dead-letter
recovery, integrity bookkeeping, the stuck-row sentinel. Before each cycle it has already decided three
things: the schema is ready, the service has settled (or the deferral limit forces the cycle anyway),
and it is the configured time.

A package that needs to read or repair stored state periodically wants exactly those decisions. A timer
of its own would have to make each of them again, and the usual way that goes wrong is a startup pass
that queries tables the schema pass has not created yet, or a sweep that lands in the middle of a bulk
load. So such work is written as a step, and the cycle runs it.

```csharp{
title: "A maintenance step"
description: "Registers periodic work that runs inside the maintenance cycle, after the schema is ready and the service has settled."
framework: "NET10"
category: "Workers"
difficulty: "INTERMEDIATE"
tags: ["maintenance", "workers", "housekeeping", "extension"]
tests: ["MaintenanceWorkerStepTests.Cycle_RunsEveryRegisteredStep_InRegistrationOrderAsync"]
}
public sealed class PruneExpiredDraftsStep : IMaintenanceStep {
  public string Name => "prune-expired-drafts";

  public async Task RunAsync(IServiceProvider services, CancellationToken cancellationToken) {
    var drafts = services.GetRequiredService<IDraftStore>();
    await drafts.PruneExpiredAsync(cancellationToken);
  }
}

services.TryAddEnumerable(ServiceDescriptor.Scoped<IMaintenanceStep, PruneExpiredDraftsStep>());
```

How steps run:

- **Last in the cycle, in registration order,** after the built-in housekeeping, so what a step reads
  has been through this cycle's own cleanup first.
- **In the cycle's service scope.** A step resolves scoped services, the work coordinator among them,
  from the provider it is given.
- **Best-effort per step.** A step that throws is logged by name and the next one runs; one broken step
  never switches the others off. It runs again next cycle.
- **Cancellation is shutdown** and propagates; it is never logged as a step failure.
- **Register with `TryAddEnumerable`** so a registration method called twice does not run the step twice.

The saga package's [stranded-saga sweep](../sagas/completion-orchestration#stranded-sagas) is a step.
