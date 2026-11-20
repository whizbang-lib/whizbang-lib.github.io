---
title: Hooks and Middleware
pageType: guide
verifiedAgainstCommit: 0bc6065b
verifiedDate: 2026-08-05
version: 1.0.0
category: Extensibility
order: 1
description: >-
  Where cross-cutting work goes in Whizbang: receptor interceptors before a
  receptor runs, lifecycle receptors at later stages, and the framework's own
  tracing, retry and audit. Replaces the removed pipeline behaviors.
tags: >-
  extensibility, receptor-interceptor, middleware, hooks, cross-cutting-concerns,
  lifecycle, upgrading
codeReferences:
  - src/Whizbang.Core/Security/IReceptorInterceptor.cs
  - src/Whizbang.Core/Security/ReceptorInterceptorPipeline.cs
  - src/Whizbang.Core/SystemEvents/SystemEventServiceCollectionExtensions.cs
testReferences:
  - tests/Whizbang.Core.Unit.Dispatcher.Tests/Security/ReceptorInterceptorDispatchTests.cs
  - tests/Whizbang.Core.Unit.Dispatcher.Tests/SystemEvents/CommandAuditDispatchTests.cs
lastMaintainedCommit: '01f07906'
---

# Hooks and Middleware

Whizbang has no wrapping middleware chain around a receptor. Cross-cutting work hooks in at the points the framework
already owns, so it runs on every path a message takes (local dispatch, cascade, inbox delivery and every lifecycle
stage) without a receptor having to opt in:

| You want to | Use |
|-------------|-----|
| Decide, before a receptor runs, whether it may handle a message (authorization, tenancy, rate limits, allowlists) | A [receptor interceptor](#receptor-interceptors) (`IReceptorInterceptor`) |
| Run code at a later point in a message's life (after it is stored, after perspectives caught up) | A [lifecycle receptor](../../fundamentals/receptors/lifecycle-receptors.md) with `[FireAt]` |
| Trace or time message handling | The framework's [tracing](../../operations/observability/tracing.md) and OpenTelemetry integration |
| Retry a failed delivery, or park one for review | The inbox retry policy and the [dead-letter queue](../../operations/dead-letter-queue/internal-dlq.md) |
| Audit commands | [Command auditing](../../fundamentals/security/audit-logging.md#command-auditing) (`EnableCommandAudit()`) |

## Receptor interceptors {#receptor-interceptors}

An `IReceptorInterceptor` is asked immediately before every receptor invocation. It sees the receptor type, the
message envelope and the scope context the receptor would read, and answers allow or deny. Every registered
interceptor must allow; the first denial decides what happens to the message.
{verified: ReceptorInterceptorDispatchTests.LocalInvoke_DeniedReceptor_DoesNotRunAndAppendsNothingAsync, ReceptorInterceptorDispatchTests.LocalInvoke_InterceptorSeesTheScopeContextTheReceptorSeesAsync, ReceptorInterceptorDispatchTests.Cascade_DeniedReceptorOfTheCascadedEvent_DoesNotRunAsync}

```csharp{title="Receptor interceptor" description="An interceptor that denies receptors outside the caller's tenant, registered once as a singleton." category="Extensibility" difficulty="INTERMEDIATE" tags=["Extending", "Extensibility", "Receptors", "Interceptors"] tests=["ReceptorInterceptorDispatchTests.LocalInvoke_DeniedReceptor_DoesNotRunAndAppendsNothingAsync", "ReceptorInterceptorDispatchTests.LocalInvoke_InterceptorSeesTheScopeContextTheReceptorSeesAsync"]}
public sealed class TenantRequiredInterceptor : IReceptorInterceptor {
  public ValueTask<InterceptorResult> CanInvokeAsync(
      Type receptorType, IMessageEnvelope envelope, IScopeContext? context, CancellationToken ct = default) =>
    new(context?.Scope.TenantId is null
      ? InterceptorResult.Deny(DeniedAction.DeadLetter, "No tenant in scope")
      : InterceptorResult.Allowed);
}

services.AddSingleton<IReceptorInterceptor, TenantRequiredInterceptor>();
```

An interceptor decides; it does not wrap the receptor, so it cannot change the message or the receptor's result. With
none registered, no dispatch path does any interceptor work. An interceptor that applies to a synchronous receptor
(`ISyncReceptor`) must complete synchronously. What each `DeniedAction` does on local dispatch and on inbox delivery,
and how `[RequirePermission]` is enforced with `DefaultRequirePermissionInterceptor`, is on the
[Receptor Permission Gate](../../fundamentals/security/security.md#receptor-permission-gate) page.
{verified: ReceptorInterceptorDispatchTests.NoInterceptors_ReceptorRuns_AndTheDispatcherHoldsNoPipelineAsync, ReceptorInterceptorDispatchTests.LocalInvoke_DropQuiet_SkipsTheReceptorWithoutThrowingAsync}

The framework runs its own admission work at the same gate, after every interceptor allowed: command auditing records
each receptor admitted to handle a command, so a denied receptor is never audited.
{verified: CommandAuditDispatchTests.DeniedReceptor_IsNotAudited_WhateverTheRegistrationOrderAsync}

## Upgrading from pipeline behaviors {#upgrading}

:::breaking
`IPipelineBehavior<TRequest, TResponse>` and `PipelineBehavior<TRequest, TResponse>` (namespace
`Whizbang.Core.Pipeline`) and `CommandAuditPipelineBehavior<TCommand, TResponse>` are removed
([#2470](https://github.com/whizbang-lib/whizbang/issues/2470)). The dispatcher never ran a pipeline behavior, so a
behavior an application registered never ran either, and `EnableCommandAudit()` audited nothing.
:::

What to do with code that used them:

- **A behavior that checked or rejected a message before the receptor** (authorization, validation that should stop
  the message): move it to an `IReceptorInterceptor` and deny with the `DeniedAction` that fits.
- **A behavior that logged or timed handling**: use the framework's [tracing](../../operations/observability/tracing.md),
  or allow from an interceptor after logging what it needs.
- **A behavior that retried**: delivery retry belongs to the inbox and its retry policy; a receptor that calls an
  unreliable dependency retries that call itself.
- **Command auditing**: keep `EnableCommandAudit()`. `AddSystemEvents(o => o.EnableCommandAudit())` is enough, and a
  command type that should be audited must implement `ICommand`. See
  [Command auditing](../../fundamentals/security/audit-logging.md#command-auditing).
- **Registrations** of `typeof(IPipelineBehavior<,>)` no longer compile; delete them.

## Further Reading

- [Receptor Permission Gate](../../fundamentals/security/security.md#receptor-permission-gate) - interceptors in full
- [Lifecycle Receptors](../../fundamentals/receptors/lifecycle-receptors.md) - running code at a lifecycle stage
- [Custom Receptors](custom-receptors.md) - advanced receptor patterns
- [System Events](../../fundamentals/events/system-events.md#command-auditing) - command auditing on the system-event side
