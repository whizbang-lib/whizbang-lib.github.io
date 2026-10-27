---
title: 'WHIZ006: Multiple Stream ID Attributes'
pageType: troubleshooting
verifiedAgainstCommit: 2d72e086
verifiedDate: 2026-10-27
description: >-
  Warning reported on each extra [StreamId] attribute when a type marks more than one property or primary-constructor
  parameter with [StreamId]. Only the first is used; the others are ignored.
version: 1.0.0
category: Diagnostics
severity: Warning
tags:
  - diagnostics
  - streamid
  - source-generator
  - analyzer
codeReferences:
  - src/Whizbang.Generators/DiagnosticDescriptors.cs
  - src/Whizbang.Generators/Analyzers/StreamIdAttributeAnalyzer.cs
  - src/Whizbang.Generators/Utilities/StreamIdSelection.cs
  - src/Whizbang.Core/StreamIdAttribute.cs
  - src/Whizbang.Generators/StreamIdGenerator.cs
  - src/Whizbang.Generators/PerspectiveDiscoveryGenerator.cs
testReferences:
  - tests/Whizbang.Generators.Tests/Analyzers/StreamIdAttributeAnalyzerTests.cs
  - tests/Whizbang.Generators.Tests/DiagnosticDescriptorsTests.cs
  - tests/Whizbang.Generators.Tests/StreamIdOverrideGeneratorTests.cs
lastMaintainedCommit: 'b0bc0d9e'
---

# WHIZ006: Multiple Stream ID Attributes

**Severity**: Warning
**Category**: Whizbang.SourceGeneration

## Description

A message has one stream ID. When the stream ID generator builds an extractor for a type, it uses the **first**
`[StreamId]` it finds and ignores any others. WHIZ006 warns about each `[StreamId]` that is ignored, so a second
attribute can no longer pass the build while doing nothing.

The analyzer looks at the `[StreamId]` attributes the type declares itself, on properties and on primary-constructor
parameters, and at the `[StreamId]` it inherits. It decides which one is used the way the generator does, searching
the type and then each base type in turn, nearest first:

1. at each level, a `[StreamId(Override = true)]`, on a property or on a record's primary-constructor parameter;
2. otherwise, at that level, a `[StreamId]` property, the first in declaration order;
3. when no level has either, the type's own first `[StreamId]` constructor parameter.

The warning is reported on every attribute the type declares that is not the one used, at the attribute itself, and
names the property that is used.

Inheritance makes two cases easy to miss
{verified: StreamIdAttributeAnalyzerTests.ADerivedStreamIdOverAnInheritedOne_ReportsWhiz006NamingTheDerivedOneAsync, StreamIdAttributeAnalyzerTests.ADerivedParameterStreamIdUnderAnInheritedProperty_ReportsWhiz006NamingTheInheritedOneAsync}:

- **A derived property hides an inherited one.** The derived type's `[StreamId]` property is used and the base's is
  ignored, so the warning is reported on the derived attribute.
- **An inherited property beats a derived record's parameter.** A `[StreamId]` property anywhere in the base chain is
  found before a constructor parameter, so the derived record's `[StreamId]` parameter is the one ignored, and the
  warning names the inherited property.

### Overriding an inherited stream ID on purpose

A common design puts a default `[StreamId]` on a base command or event and lets each derived type declare its own key.
Mark the derived one `[StreamId(Override = true)]` and it is the stream ID, ahead of the inherited one, with no
WHIZ006
{verified: StreamIdAttributeAnalyzerTests.ADerivedOverridePropertyOverAnInheritedOne_IsNotReportedAsync, StreamIdAttributeAnalyzerTests.ADerivedOverrideParameterOverAnInheritedProperty_IsNotReportedAsync, StreamIdAttributeAnalyzerTests.AnOverrideTwoLevelsBelowTheInheritedStreamId_IsNotReportedAsync, StreamIdOverrideGeneratorTests.AnEventOverrideParameter_IsTheStreamIdAheadOfAnInheritedPropertyAsync}.
This works on a property and on a record's primary-constructor parameter, where the override also beats the inherited
property that would otherwise win, and the generator uses the same property.

```csharp{title="A derived stream ID that overrides an inherited one" description="Override = true says the derived key replaces the base's default stream ID on purpose, so WHIZ006 is not reported and AckId is the stream ID." framework="NET10" category="Diagnostics" difficulty="INTERMEDIATE" tags=["Diagnostics", "WHIZ006", "StreamId", "Inheritance", "Override"] tests=["StreamIdAttributeAnalyzerTests.ADerivedOverridePropertyOverAnInheritedOne_IsNotReportedAsync", "StreamIdOverrideGeneratorTests.ACommandOverrideParameter_IsTheStreamIdAheadOfAnInheritedPropertyAsync"]}
using Whizbang.Core;

public abstract class CommandBase : ICommand {
  [StreamId] public virtual System.Guid StreamId { get; set; }
}

public class AcknowledgeAlert : CommandBase {
  [StreamId(Override = true)] public System.Guid AckId { get; set; }   // the stream ID, no WHIZ006
}
```

WHIZ006 is still reported where the option does not apply:

- **Two `[StreamId]` declared on one type**, override or not. An override is used ahead of a plain one beside it, and
  the plain one is reported; of two overrides, the first is used and the second reported
  {verified: StreamIdAttributeAnalyzerTests.APlainStreamIdNextToAnOverrideOnOneType_ReportsWhiz006OnThePlainOneNamingTheOverrideAsync, StreamIdAttributeAnalyzerTests.TwoOverridesOnOneType_ReportWhiz006OnTheSecondAsync}.
- **A hide without the option**, including one that hides an inherited override
  {verified: StreamIdAttributeAnalyzerTests.APlainStreamIdHidingAnInheritedOverride_ReportsWhiz006Async, StreamIdAttributeAnalyzerTests.AnExplicitOverrideFalse_IsAPlainStreamIdAndStillReportsWhiz006Async}.
- **A derived record's plain parameter under an inherited override**: the inherited override is used
  {verified: StreamIdAttributeAnalyzerTests.AnOverrideOnAnIntermediateRecord_IsUsedAheadOfALeafParameterAsync}.

An override with no inherited `[StreamId]` to replace is reported by [WHIZ016](whiz016).

### Same-name redeclarations

An override that redeclares the inherited property with the same name is the same stream ID, not a second one, and is
not reported {verified: StreamIdAttributeAnalyzerTests.AnOverrideThatRedeclaresTheInheritedStreamId_IsNotReportedAsync}.

A record parameter written `[property: StreamId]` puts the attribute on the generated property. The parameter and its
property have the same name, so they count once and do not trigger the warning.

The property type does not matter: any type may be a stream ID (`Guid`, `string`, or a strongly typed ID). The
retired [WHIZ005](whiz005) once described a "must be a Guid" rule that never existed.

An event used by a perspective with more than one `[StreamId]` is also an error, [WHIZ031](whiz031), so it fails the
build on top of this warning. An event whose stream ID is an override is not
{verified: StreamIdOverrideGeneratorTests.APerspectiveEventWithAnOverride_IsNotReportedAsMultipleStreamIdsAsync}.

## Diagnostic Message

```text
Type {TypeName} has multiple [StreamId] attributes. Only the first property '{PropertyName}' will be used.
```

## Common Causes

1. **A related ID was marked as well**, for example a customer ID on an order event, because it "is also an ID".
2. **A property was copied** from another message with its attribute.
3. **The stream ID was changed** to another property and the old attribute was left behind.
4. **A base type already declares the stream ID**, and a derived event declares its own as well. When the derived
   one is meant to replace it, mark it `[StreamId(Override = true)]`.

## How to Fix

Keep `[StreamId]` on the one property that identifies the stream, and remove it from the others.

### Before (reports WHIZ006 on the second attribute)

```csharp{title="Two [StreamId] properties" description="The second [StreamId] is ignored, so WHIZ006 is reported on it, naming OrderId as the property used." framework="NET10" category="Diagnostics" difficulty="BEGINNER" tags=["Diagnostics", "WHIZ006", "StreamId", "Events"] tests=["StreamIdAttributeAnalyzerTests.TwoStreamIds_ReportWhiz006OnTheSecondNamingTheOneUsedAsync"]}
using Whizbang.Core;

public record OrderPlaced : IEvent {
  [StreamId] public System.Guid OrderId { get; init; }
  [StreamId] public System.Guid CustomerId { get; init; }   // WHIZ006: ignored
}
```

### After

```csharp{title="One stream ID per message" description="Keep [StreamId] on the property that identifies the stream; related IDs are plain properties. A single [StreamId] of any type is not reported." framework="NET10" category="Diagnostics" difficulty="BEGINNER" tags=["Diagnostics", "WHIZ006", "StreamId", "Events"] tests=["StreamIdAttributeAnalyzerTests.ASingleStreamIdOfAnyType_IsNotReportedAsync"]}
using Whizbang.Core;

public record OrderPlaced : IEvent {
  [StreamId] public System.Guid OrderId { get; init; }      // the stream this event belongs to
  public System.Guid CustomerId { get; init; }              // related ID, not a stream ID
}
```

### Before (a derived record's parameter under an inherited stream ID)

```csharp{title="An inherited [StreamId] and a derived one" description="The base's [StreamId] property is found before the derived record's [StreamId] parameter, so the parameter is ignored and WHIZ006 names OrderId." framework="NET10" category="Diagnostics" difficulty="INTERMEDIATE" tags=["Diagnostics", "WHIZ006", "StreamId", "Inheritance"] tests=["StreamIdAttributeAnalyzerTests.ADerivedParameterStreamIdUnderAnInheritedProperty_ReportsWhiz006NamingTheInheritedOneAsync"]}
using Whizbang.Core;

public abstract record OrderEventBase : IEvent { [StreamId] public System.Guid OrderId { get; init; } }
public record LineAdded([StreamId] System.Guid LineId) : OrderEventBase;   // WHIZ006: OrderId is used
```

Decide which one identifies the stream. If every event in the family streams by order, remove `[StreamId]` from the
derived record. If this event belongs to a different stream, mark the parameter `[StreamId(Override = true)]`: it is
then the stream ID, ahead of the inherited property.

### After (the derived record's parameter overrides the inherited stream ID)

```csharp{title="A derived record parameter that overrides the inherited stream ID" description="With Override = true the derived record's parameter is the stream ID, ahead of the inherited OrderId, and WHIZ006 is not reported." framework="NET10" category="Diagnostics" difficulty="INTERMEDIATE" tags=["Diagnostics", "WHIZ006", "StreamId", "Inheritance", "Override"] tests=["StreamIdAttributeAnalyzerTests.ADerivedOverrideParameterOverAnInheritedProperty_IsNotReportedAsync", "StreamIdOverrideGeneratorTests.AnEventOverrideParameter_IsTheStreamIdAheadOfAnInheritedPropertyAsync"]}
using Whizbang.Core;

public abstract record OrderEventBase : IEvent { [StreamId] public System.Guid OrderId { get; init; } }
public record LineAdded([StreamId(Override = true)] System.Guid LineId) : OrderEventBase;   // LineId is used
```

## Suppressing

Prefer fixing the type: an ignored `[StreamId]` misleads readers and never takes effect. A hide that is intended is
said on the type with `[StreamId(Override = true)]`, not with a suppression, so the warning keeps catching the
mistakes it exists for. If you must, the warning
can be silenced with `#pragma warning disable WHIZ006` around the type or `dotnet_diagnostic.WHIZ006.severity = none`
in `.editorconfig`.

## Related

- [WHIZ016: Stream ID Override Has Nothing to Override](whiz016)
- [WHIZ031: Multiple StreamId Attributes](whiz031)
- [WHIZ005: Stream ID Must Be Guid (retired)](whiz005)
- [WHIZ010: StreamId Discovered](whiz010)
- [StreamId Attribute](../../extending/attributes/streamid)
