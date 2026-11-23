---
title: 'WHIZ037: A Constructed Or Parsed Guid Flows Into An Id'
pageType: troubleshooting
verifiedAgainstCommit: '7b794a96'
verifiedDate: 2026-11-23
description: >-
  Warning reported when a Guid built with new Guid(...) or read with Guid.Parse or Guid.TryParse is written to a
  message id, an event id or a [StreamId] member. Such a value carries whatever version its source had, so it may not be
  the UUIDv7 that event and message ids must be.
version: 1.0.0
category: Diagnostics
severity: Warning
tags:
  - diagnostics
  - guid
  - uuidv7
  - time-ordering
  - streamid
  - analyzer
  - identity
codeReferences:
  - src/Whizbang.Generators/NonTimeOrderedIdAnalyzer.cs
  - src/Whizbang.Generators/DiagnosticDescriptors.cs
  - src/Whizbang.Core/Validation/GuidOrderingValidator.cs
testReferences:
  - tests/Whizbang.Generators.Tests/NonTimeOrderedIdAnalyzerTests.cs
lastMaintainedCommit: '7b794a96'
---

# WHIZ037: A Constructed Or Parsed Guid Flows Into An Id

**Severity**: Warning
**Category**: Whizbang.SourceGeneration

## Description

Event and message ids must be UUIDv7, and the framework refuses any other version where they enter (see
[Time-ordering checks](../../fundamentals/identity/whizbang-ids#time-ordering-checks)). Stream ids should be UUIDv7 for
index locality (see [Stream id versions](../../fundamentals/identity/whizbang-ids#stream-id-versions)).

[Guid interception](../../fundamentals/identity/whizbang-ids#guid-interception) makes `Guid.NewGuid()` return a UUIDv7,
but it cannot reach a constructor or a value read from the wire. A Guid built with `new Guid(bytes)` or
`new Guid("...")`, or read with `Guid.Parse` or `Guid.TryParse`, carries whatever version its source had. WHIZ037 names
that flow at compile time, before the id is refused at runtime
{verified: NonTimeOrderedIdAnalyzerTests.FlaggedShape_ReportsWHIZ037WarningAsync}.

### When it fires

The value is one of these shapes:

- `new Guid(...)` with arguments (bytes, a string, or components);
- `Guid.Parse(...)`;
- `Guid.TryParse(...)`, through its `out` value.

And it is written to one of these targets:

- a property or field named `MessageId` or `EventId`;
- a member marked `[StreamId]`;
- the argument of the `MessageId` or `EventId` constructor.

The value can be written directly, or through a local whose initializer is one of the shapes, or which is the `out`
argument of `Guid.TryParse`.

### When it does not fire

{verified: NonTimeOrderedIdAnalyzerTests.QuietShape_ReportsNothingAsync, NonTimeOrderedIdAnalyzerTests.DerivedId_IsQuietAsync}

- `MessageId.From(...)`, `EventId.From(...)`, `Parse` and the explicit cast on a strong id: they already refuse a
  non-v7 Guid at runtime.
- A string literal that is itself a UUIDv7, and an interpolated string whose fixed leading text sets version 7.
- The framework's own minting: `TrackedGuid.New()`, a strong id's `New()`, and an id derived from a message id such as
  `GeneratedStreamIdentity.Derive(...)`.
- A parsed Guid that never reaches an id, or is written to a member that is not an id.

## Diagnostic Message

```text{title="WHIZ037 message" description="{0} is the shape (new Guid(...), Guid.Parse or Guid.TryParse) and {1} the target member or type" category="Diagnostics" difficulty="BEGINNER" tags=["WHIZ037", "Guid", "Diagnostics"] unverified="message text read from the descriptor"}
{Shape} flows into {Target}; event and message ids must be UUIDv7 (time-ordered) and stream ids should be. Mint it with TrackedGuid.New() or a [WhizbangId] type, or derive it from a message id.
```

## Common Causes

1. **Ids rebuilt from bytes or strings**, for example an id read from a file, a header or a legacy table and written to
   `MessageId`.
2. **A stream id parsed from an external key**, such as a route value, written to a `[StreamId]` property.
3. **Test data** built from fixed v4 literals.

## How to Fix

Mint the id with `TrackedGuid.New()` or a `[WhizbangId]` type's `New()`. When the value comes from outside your system,
pass it through the strong id's checked `From` or `Parse`, which refuse a non-v7 value with a clear error at the
boundary. For an outside value that is legitimately not UUIDv7, such as a stream id from an external identity
provider, declare its type with [`[WhizbangId(AcceptAnyVersion = true)]`](../../fundamentals/identity/whizbang-ids#accept-any-version).

### Before (reports WHIZ037)

```csharp{title="A parsed Guid written to a message id" description="Guid.Parse carries whatever version the string had, so WHIZ037 is reported" category="Diagnostics" difficulty="BEGINNER" tags=["WHIZ037", "Guid", "Analyzer"] tests=["NonTimeOrderedIdAnalyzerTests.FlaggedShape_ReportsWHIZ037WarningAsync"]}
public static void Run(Envelope e, string s) {
  e.MessageId = Guid.Parse(s);   // WHIZ037
}

public static MessageId Run(byte[] b) => new MessageId(new Guid(b));   // WHIZ037
```

### After (no diagnostic)

```csharp{title="Minted or checked ids" description="TrackedGuid.New(), a strong id's New() and the checked From are quiet" category="Diagnostics" difficulty="BEGINNER" tags=["WHIZ037", "TrackedGuid", "Identity"] tests=["NonTimeOrderedIdAnalyzerTests.QuietShape_ReportsNothingAsync"]}
public static void Run(Envelope e) {
  e.MessageId = MessageId.New();
}

// From refuses a non-v7 Guid at runtime, so it is not reported
public static MessageId Run(string s) => MessageId.From(Guid.Parse(s));
```

## Suppressing

Suppress WHIZ037 only where the value is known to be a UUIDv7 that the analyzer cannot see, for example a Guid
restored from bytes your own system wrote from a UUIDv7. A suppressed warning does not change the runtime check: a
non-v7 event or message id is still refused.

```csharp{title="Suppress WHIZ037 with a pragma" description="Pragma suppression around a value known to be UUIDv7" category="Diagnostics" difficulty="BEGINNER" tags=["WHIZ037", "Suppression", "Pragma"] unverified="suppression syntax; not exercised by a test"}
#pragma warning disable WHIZ037
envelope.MessageId = new Guid(storedV7Bytes);
#pragma warning restore WHIZ037
```

## Related

- [Time-ordering checks](../../fundamentals/identity/whizbang-ids#time-ordering-checks)
- [Stream id versions](../../fundamentals/identity/whizbang-ids#stream-id-versions)
- [Guid interception](../../fundamentals/identity/whizbang-ids#guid-interception)
- [WHIZ055: Guid.NewGuid() Usage](whiz055)
- [WHIZ058: GUID Call Intercepted](whiz058)
