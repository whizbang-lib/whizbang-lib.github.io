---
title: Policy Engine Component
pageType: concept
verifiedAgainstCommit: 1b31f58d
verifiedDate: 2026-07-16
version: 1.0.0
category: Components
order: 6
description: >-
  Component reference for the shipped policy engine (predicate-based routing
  policies) and the resilience primitives that cover retry and circuit-breaker
  concerns
tags: 'policies, cross-cutting, resilience, circuit-breaker, retry, rate-limiting'
codeReferences:
  - src/Whizbang.Core/Policies/IPolicyEngine.cs
  - src/Whizbang.Core/Policies/PolicyEngine.cs
  - src/Whizbang.Core/Policies/PolicyConfiguration.cs
  - src/Whizbang.Core/Policies/PolicyContext.cs
  - src/Whizbang.Core/Resilience/CircuitBreaker.cs
  - src/Whizbang.Core/Resilience/CircuitBreakerOptions.cs
  - src/Whizbang.Core/Workers/WorkerRetryOptions.cs
testReferences:
  - tests/Whizbang.Policies.Tests/PolicyEngineTests.cs
  - tests/Whizbang.Core.Tests/Resilience/CircuitBreakerTests.cs
  - tests/Whizbang.Core.Tests/Resilience/StreamRateLimiterTests.cs
  - tests/Whizbang.Core.Tests/Resilience/SubscriptionRetryHelperTests.cs
lastMaintainedCommit: '01f07906'
---

# Policy Engine Component

:::updated
Earlier drafts of this page described an **attribute-based cross-cutting policy system** — `[Retry]`, `[Timeout]`, `[Cache]`, `[CircuitBreaker]` attributes woven around receptors via an `IPolicyOf<T>` interface and a generated `PolicyWeaver`. **That system did not ship.** What v1.0.0 actually provides is:

1. **`IPolicyEngine`** — a predicate-based *routing/configuration* policy engine (`AddPolicy` / `MatchAsync`). See [Policy-Based Routing](policies.md) for the full guide.
2. **Resilience primitives** in `Whizbang.Core.Resilience` — a programmatic `CircuitBreaker<TResult>`, a `StreamRateLimiter`, and subscription retry helpers — plus worker-level retry with exponential backoff via `WorkerRetryOptions`.

This page documents those shipped components.
:::

## The Policy Engine (`IPolicyEngine`)

The shipped policy engine matches a message's context against ordered, named predicates and returns the first matching policy's configuration:

```csharp{title="IPolicyEngine contract" description="The shipped policy engine interface — ordered named policies, first-match-wins evaluation, decision-trail recording" category="API" difficulty="BEGINNER" tags=["policy-engine", "interface", "routing"] tests=["PolicyEngineTests.PolicyEngine_ShouldMatchSinglePolicyAsync", "PolicyEngineTests.PolicyEngine_ShouldMatchFirstMatchingPolicyAsync", "PolicyEngineTests.PolicyEngine_ShouldReturnNullWhenNoPolicyMatchesAsync", "PolicyEngineTests.PolicyEngine_ShouldRecordDecisionInTrailAsync"]}
public interface IPolicyEngine {
  // Policies are evaluated in the order they are added.
  void AddPolicy(
    string name,
    Func<PolicyContext, bool> predicate,
    Action<PolicyConfiguration> configure
  );

  // Returns the configuration for the first matching policy, or null if no match.
  // Records every evaluation in context.Trail.
  Task<PolicyConfiguration?> MatchAsync(PolicyContext context);
}
```

`PolicyEngine` is the default implementation. It handles routing-shaped concerns — topics, transport publish/subscribe targets, stream ids, execution strategy selection, partitioning, concurrency limits, and persistence-size guards — **not** retry/timeout/cache wrapping. See [Policy-Based Routing](policies.md) for predicates, the fluent `PolicyConfiguration` API, pooling, and the decision trail.

## Resilience Primitives

Cross-cutting resilience is provided by concrete, programmatic components rather than attributes.

### CircuitBreaker&lt;TResult&gt;

`Whizbang.Core.Resilience.CircuitBreaker<TResult>` wraps any async operation to prevent cascading failures during sustained outages. It is options-configured and returns a caller-supplied fallback value while the circuit is open:

```csharp{title="Wrap an operation in a circuit breaker" description="Creates a CircuitBreaker with options and executes an operation with a fallback value returned while the circuit is open" category="Configuration" difficulty="INTERMEDIATE" tags=["circuit-breaker", "resilience", "fallback"] tests=["CircuitBreakerTests.ExecuteAsync_Success_ReturnsResultAsync", "CircuitBreakerTests.ExecuteAsync_CircuitOpen_ReturnsFallbackWithoutExecutingAsync"]}
using Whizbang.Core.Resilience;

var breaker = new CircuitBreaker<ServiceResult>(new CircuitBreakerOptions {
  FailureThreshold = 5,            // consecutive failures before opening (default 5)
  InitialCooldownSeconds = 3,      // first cooldown (default 3); doubles per re-open
  CooldownBackoffMultiplier = 2.0, // 3s → 6s → 12s → 24s → ... (default 2.0)
  MaxCooldownSeconds = 300,        // backoff cap (default 300)
  SuccessCacheDurationSeconds = 5  // cache successful results (default 5; 0 disables)
});

var result = await breaker.ExecuteAsync(
  operation: ct => CallExternalServiceAsync(ct),
  fallbackValue: ServiceResult.Unavailable,
  cancellationToken: stoppingToken
);
```

Key behaviors (all verified against the implementation):

- **State machine**: `Closed → Open → HalfOpen → Closed` (or back to `Open` on a half-open failure). Current state is observable via the `State` property (`CircuitBreakerState` enum).
- **Escalating cooldown**: each consecutive open doubles the cooldown (`InitialCooldownSeconds × CooldownBackoffMultiplier^n`) up to `MaxCooldownSeconds`; the cooldown resets when the circuit closes.
- **Open-circuit fast-fail**: while open and inside the cooldown, `ExecuteAsync` returns `fallbackValue` without invoking the operation.
- **Success caching**: a successful result is cached for `SuccessCacheDurationSeconds` and returned without re-executing the operation — set `0` to disable.
- **Observability**: `ConsecutiveFailures` and `CurrentCooldownSeconds` are exposed for metrics/tests.

#### Circuit States

```mermaid{caption="CircuitBreaker state machine — Closed opens once consecutive failures reach the threshold, moves to HalfOpen after the cooldown, then closes on a successful probe or re-opens with a doubled cooldown on a half-open failure." tests=["CircuitBreakerTests.ExecuteAsync_FailuresReachThreshold_OpensCircuitAsync", "CircuitBreakerTests.ExecuteAsync_CooldownExpired_TransitionsToHalfOpenAsync", "CircuitBreakerTests.ExecuteAsync_HalfOpenSuccess_ClosesCircuitAndResetsBackoffAsync", "CircuitBreakerTests.ExecuteAsync_HalfOpenFailure_ReopensWithEscalatedCooldownAsync"]}
stateDiagram-v2
    [*] --> Closed: Initial
    Closed --> Open: FailureThreshold<br/>consecutive failures
    Open --> HalfOpen: After<br/>cooldown
    HalfOpen --> Closed: Success
    HalfOpen --> Open: Failure<br/>(cooldown doubles)
```

### Worker retry with exponential backoff

Message-processing retry is a **worker concern**, configured via `WorkerRetryOptions` rather than per-handler attributes:

```csharp{title="WorkerRetryOptions defaults" description="Worker completion retry configuration — exponential backoff from 1s doubling to a 60s cap" category="Configuration" difficulty="INTERMEDIATE" tags=["retry", "backoff", "worker", "options"] unverified="options DTO — default field values, no dedicated behavioral test in the coverage map"}
public class WorkerRetryOptions {
  public int RetryTimeoutSeconds { get; set; } = 1;        // base timeout; first retry after 1s
  public bool EnableExponentialBackoff { get; set; } = true;
  public double BackoffMultiplier { get; set; } = 2.0;     // 1s → 2s → 4s → 8s → 16s → 32s → 60s
  public int MaxBackoffSeconds { get; set; } = 60;         // cap — failing messages block their stream
}
```

The backoff cap is deliberately low: same-stream messages process in order (by UUIDv7), so a single failing message blocks all later messages in that stream until it completes or dead-letters.

### Other resilience components

- **`StreamRateLimiter`** (`Whizbang.Core.Resilience`) — per-stream rate limiting, configured via `StreamRateLimiterOptions`.
- **`SubscriptionRetryHelper` / `SubscriptionResilienceOptions`** — retry/backoff for transport subscription establishment.
- **`ThrottleRetryOptions`** (`Whizbang.Core.Workers`) — throttle-aware retry tuning for transport publishing.

## What Is *Not* Shipped

For clarity, the following do **not** exist in v1.0.0 — do not reference them in application code:

| Not shipped | Use instead |
|-------------|-------------|
| `[Retry]` attribute on receptors | `WorkerRetryOptions` (worker-level, applies to message processing) |
| `[Timeout]` attribute | `CancellationToken`-based timeouts in your handler; lease deadlines cancel hung dispatches automatically |
| `[Cache]` attribute | Standard `IMemoryCache` / your own caching in lenses |
| `[CircuitBreaker]` attribute | `CircuitBreaker<TResult>` (programmatic, options-based) |
| `IPolicyOf<T>` / `PolicyWeaver` / `[WhizbangPolicy]` | `IPolicyEngine` for routing decisions; resilience primitives above for fault handling |

## Best Practices

1. **Route with policies, protect with primitives** — `IPolicyEngine` decides *where/how* a message flows; `CircuitBreaker<TResult>` protects *calls to fragile dependencies*.
2. **Don't retry non-transient errors** — validation failures should dead-letter, not retry.
3. **Keep retry caps low** — a failing message blocks its whole stream (ordered processing).
4. **Choose fallback values deliberately** — an open circuit returns the fallback silently; make it distinguishable from a real result.
5. **Monitor breaker state** — `State`, `ConsecutiveFailures`, and `CurrentCooldownSeconds` are cheap to export as metrics.

## Related Documentation

- [Policy-Based Routing](policies.md) - Full guide to `IPolicyEngine`, `PolicyContext`, `PolicyConfiguration`, and the decision trail
- [Receptors](../../fundamentals/receptors/receptors.md) - Message handling components
- [Dispatcher](../../fundamentals/dispatcher/dispatcher.md) - How messages reach receptors
- [Object Pooling](pooling.md) - `PolicyContext` pooling
