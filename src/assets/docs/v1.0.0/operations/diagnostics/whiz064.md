---
title: 'WHIZ064: Vector Stays a JSON Array in the Stored Event Body'
pageType: troubleshooting
version: 1.0.0
description: >-
  Info diagnostic when an event reaches a vector property that no stored-vector path can name, so the vector is
  stored as JSON numbers rather than packed binary32
category: Diagnostics
severity: Info
tags:
  - diagnostics
  - vector
  - event-store
  - serialization
codeReferences:
  - src/Whizbang.Generators/MessageJsonContextGenerator.StoredVectors.cs
  - src/Whizbang.Generators/DiagnosticDescriptors.cs
testReferences:
  - tests/Whizbang.Generators.Tests/MessageJsonContextStoredVectorTests.cs
---

# WHIZ064: Vector Stays a JSON Array in the Stored Event Body

**Severity**: Info
**Category**: Serialization

## Description

Vector properties of stored events (`float[]` and `IReadOnlyList<float>`) are stored as
[packed binary32](../../data/event-store.md#packed-vectors) by default, by path. This diagnostic reports a vector an
event reaches that has no fixed path, so it is stored as JSON numbers instead:

- it is inside a collection element (a list, array or dictionary of objects that hold vectors);
- it is behind a polymorphic member, whose path depends on the derived type;
- its type refers back to itself, so the path has no fixed depth.

Nothing is lost and every reader still reads it; the vector only takes more space than a packed one.

## Diagnostic Message

```
The vector reached through 'Chunks' on event 'PassageEmbedded' stays a JSON array in the stored body: it is inside a collection element, and collections of objects are not packed
```

## How to Fix

Nothing is required. To have the vector packed, move it to a property the event reaches through plain objects only,
for example one `float[]` per fixed member instead of a list of chunks. To silence the report for a vector you want
stored as numbers anyway, mark it `[StoredAsJsonArray]`.

```csharp{title="A vector inside a collection element" description="Chunks[i].Embedding has no fixed path, so WHIZ064 reports it" category="Troubleshooting" difficulty="INTERMEDIATE" tags=["Operations", "Diagnostics", "Vectors"] unverified="counter-example; detection verified by MessageJsonContextStoredVectorTests.Generator_AVectorInsideACollectionElement_GetsNoPath_AndIsReportedAsync"}
public record Chunk(string Text, float[] Embedding);
public record PassageEmbedded(Guid Id, List<Chunk> Chunks) : IEvent; // WHIZ064 on 'Chunks'
```

## Related

- [Event Store: packed vectors](../../data/event-store.md#packed-vectors)
