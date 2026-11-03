---
title: 'WHIZ604: JsonDocument Created and Dropped Without Being Disposed'
pageType: troubleshooting
version: 1.0.0
description: >-
  A repository check: code in the Whizbang repository creates a JsonDocument
  in one expression and drops it, so its pooled buffers are never returned
category: Diagnostics
severity: Error
tags:
  - diagnostics
  - repository-check
  - json
  - analyzer
codeReferences:
  - tools/Whizbang.RepoAnalyzers/UndisposedJsonDocumentAnalyzer.cs
testReferences:
  - tests/Whizbang.RepoAnalyzers.Tests/UndisposedJsonDocumentAnalyzerTests.cs
---

# WHIZ604: JsonDocument Created and Dropped Without Being Disposed

**Severity**: Error
**Raised by**: `Whizbang.RepoAnalyzers` (Roslyn analyzer)

This is a check on the Whizbang repository's own code and tests. It runs only in this repository's builds and never ships in a package, so an application that uses Whizbang never sees it. See [Repository Checks and Diagnostic IDs](../../../contributors/repository-checks.md) for the whole block.

## What it means

A `JsonDocument` is created and dropped in one expression, as in `JsonDocument.Parse(json).RootElement`. A document counts as created when it comes from a `JsonDocument` factory (`Parse`, `ParseAsync`, `ParseValue`) or a `JsonSerializer` method, awaited or not:

```csharp{title="The expression WHIZ604 reports" description="Nothing holds the parsed document, so nothing can dispose it." category="Diagnostics" difficulty="INTERMEDIATE" tags=["whiz604", "repository-check", "json", "analyzer"] tests=["UndisposedJsonDocumentAnalyzerTests.Parse_RootElement_ReportsAsync", "UndisposedJsonDocumentAnalyzerTests.Parse_RootElement_Clone_ReportsBecauseTheDocumentIsStillDroppedAsync"]}
static JsonElement M() => JsonDocument.Parse("1").RootElement;
```

## Why it matters

A `JsonDocument` rents its buffers from a shared pool and returns them when it is disposed. Nothing holds a document dropped in the middle of an expression, so nothing can dispose it, and its buffers are never returned. Calling `Clone()` on the element does not help: the document is still dropped.

The SDK's own rule for this, CA2026, ships only with the SDK 11 analyzers, and this repository builds with SDK 10. This rule enforces the same thing on every SDK and can be retired once the analysis level moves to an SDK that ships CA2026.

## How to fix it

Parse straight to an element, or dispose the document and clone the element that must outlive it:

```csharp{title="Clearing WHIZ604" description="JsonElement.Parse owns no pooled document; a using declaration disposes the document after the element is cloned." category="Diagnostics" difficulty="INTERMEDIATE" tags=["whiz604", "repository-check", "json", "analyzer"] tests=["UndisposedJsonDocumentAnalyzerTests.JsonElementParse_DoesNotReportAsync", "UndisposedJsonDocumentAnalyzerTests.DisposedDocument_RootElement_DoesNotReportAsync"]}
static JsonElement Parsed() => JsonElement.Parse("1");

static JsonElement Kept() {
  using var document = JsonDocument.Parse("1");
  return document.RootElement.Clone();
}
```

`JsonSerializer.SerializeToElement` replaces `JsonSerializer.SerializeToDocument(...).RootElement` the same way.

## Related

- [Repository Checks and Diagnostic IDs](../../../contributors/repository-checks.md)
