---
title: 'WHIZ122: Pinned-Type Ledger Could Not Be Parsed'
pageType: troubleshooting
verifiedAgainstCommit: 9a416b5b
verifiedDate: 2026-10-17
description: >-
  Warning diagnostic when the committed pinned-type ledger file exists but is not valid JSON, which silently turns
  off rename checking (WHIZ120 and WHIZ121) for the project.
version: 1.0.0
category: Diagnostics
severity: Warning
tags:
  - diagnostics
  - pinned-id
  - ledger
  - type-rename
  - identity
  - analyzer
codeReferences:
  - src/Whizbang.Generators/DiagnosticDescriptors.cs
  - src/Whizbang.Generators/Analyzers/PinnedTypeRenameAnalyzer.cs
  - src/Whizbang.Generators/Ledger/PinnedTypeLedger.cs
  - src/Whizbang.Generators/PinnedTypeLedgerGenerator.cs
  - src/Whizbang.Generators/build/SoftwareExtravaganza.Whizbang.Generators.props
  - src/Whizbang.Generators/build/SoftwareExtravaganza.Whizbang.Generators.targets
testReferences:
  - tests/Whizbang.Generators.Tests/Analyzers/PinnedTypeRenameAnalyzerTests.cs
  - tests/Whizbang.Generators.Tests/UnreadableLedgerTests.cs
lastMaintainedCommit: '9a416b5b'
---

# WHIZ122: Pinned-Type Ledger Could Not Be Parsed

**Severity**: Warning
**Category**: Identity / Type Rename

## Description

The project's [pinned-type ledger](../../fundamentals/identity/pinned-type-ledger)
(`.whizbang/pinned-type-ledger.json`) is present, but its contents are not valid JSON.

The ledger is the baseline the rename checks compare against. When it cannot be parsed, the analyzer treats the
project as having no ledger at all, so [WHIZ120](whiz120) (unacknowledged rename) and [WHIZ121](whiz121) (entry with no
living type) stop running. A rename could then slip through without its former name being recorded, and events stored
under the old name would no longer resolve to the type. WHIZ122 exists so that this does not happen silently.

It is a warning, not an error, because a broken ledger should not block compilation. It is reported once per
compilation, at compilation end, with no source location; the message names the ledger file.

WHIZ122 is reported only when the file has text that fails to parse. It is not reported when:

- the project has no ledger file (the rename checks are opt-in, and simply stay off), or
- the build cannot read the file at all; that is treated the same as no ledger.

## Diagnostic Message

```
The pinned-type ledger '{LedgerPath}' exists but is not valid JSON, so rename governance (WHIZ120/WHIZ121) is silently disabled for this project. Fix or restore the ledger.
```

## Common Causes

1. **A merge conflict** left conflict markers in `pinned-type-ledger.json`.
2. **A hand edit** introduced a syntax error, such as a missing quote, bracket or comma. Comments and trailing commas
   are accepted; other syntax errors are not.
3. **The file was truncated or overwritten** by a tool or a partial write.

## How to Fix

Restore the ledger from version control, or repair the JSON by hand, keeping every entry's `formerNames`. The former
names are rename history that cannot be regenerated from source.

Act on the warning promptly. When the project has at least one `[PinnedId]` type and the default ledger output is on,
the post-build step that writes the ledger regenerates it from the current `[PinnedId]` types, because an unparseable
ledger contributes no existing entries. The rewritten file is valid
JSON, so the warning goes away on the next build, but the previous `formerNames` are no longer in it. Compare the file
with the last committed version before committing it.

### Before (causes WHIZ122)

The ledger file contains text that is not JSON:

```json{title="Malformed pinned-type ledger" description="A ledger file whose text does not parse as JSON reports WHIZ122 and turns off WHIZ120/WHIZ121." category="Diagnostics" difficulty="BEGINNER" tags=["ledger", "pinned-id", "WHIZ122"] testFile="PinnedTypeRenameAnalyzerTests.cs" testMethod="MalformedLedger_ReportsWhiz122AndDisablesGovernanceAsync" githubUrl="https://github.com/whizbang-lib/whizbang/blob/develop/tests/Whizbang.Generators.Tests/Analyzers/PinnedTypeRenameAnalyzerTests.cs" tests=["PinnedTypeRenameAnalyzerTests.MalformedLedger_ReportsWhiz122AndDisablesGovernanceAsync"]}
{ this is not valid json
```

### After (no diagnostic)

A well-formed ledger, in the shape the tests use:

```json{title="Well-formed pinned-type ledger" description="A parseable ledger with one entry matching the compiled type; the rename checks run against it and report nothing." category="Diagnostics" difficulty="BEGINNER" tags=["ledger", "pinned-id", "WHIZ122"] testFile="PinnedTypeRenameAnalyzerTests.cs" testMethod="Name_UnchangedFromLedger_NoDiagnosticAsync" githubUrl="https://github.com/whizbang-lib/whizbang/blob/develop/tests/Whizbang.Generators.Tests/Analyzers/PinnedTypeRenameAnalyzerTests.cs" tests=["PinnedTypeRenameAnalyzerTests.Name_UnchangedFromLedger_NoDiagnosticAsync"]}
{ "version": 1, "types": [
  { "pinnedId": "11111111-2222-3333-4444-555555555555", "clrTypeName": "TestApp.OrderPlacedEvent", "kind": "event", "formerNames": [] }
] }
```

## Suppressing

Because WHIZ122 has no source location, `#pragma warning disable` cannot reach it. Use a global analyzer config file:

```ini{title="Disable WHIZ122 in .globalconfig" description="Location-less diagnostics are configured project-wide through a global analyzer config." category="Diagnostics" difficulty="BEGINNER" tags=["suppression", "globalconfig", "WHIZ122"] unverified="suppression/config, not exercised by a test"}
# .globalconfig
is_global = true
dotnet_diagnostic.WHIZ122.severity = none
```

Suppressing is rarely appropriate: the warning is the only signal that rename checking is off. If the project does not
want rename checking, opt out of the ledger instead by setting the MSBuild property
`WhizbangIncludePinnedTypeLedger` to `false`; the ledger is then not passed to the analyzer at all.

## Related

- [WHIZ120: Pinned Type Renamed Without Ledger Acknowledgment](whiz120)
- [WHIZ121: Pinned-Type Ledger Entry Has No Living Type](whiz121)
- [Pinned-Type Ledger](../../fundamentals/identity/pinned-type-ledger)
- [Pinned Identity](../../fundamentals/identity/pinned-identity)
