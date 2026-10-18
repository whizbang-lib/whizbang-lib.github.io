---
title: 'WHIZ054: Failed to Load Tests Map'
pageType: troubleshooting
verifiedAgainstCommit: 9a416b5b
verifiedDate: 2026-10-17
description: >-
  Informational diagnostic when the message registry generator finds a documentation checkout but cannot read its
  code-tests-map.json. The build continues and the registry is generated without test information.
version: 1.0.0
category: Diagnostics
severity: Info
tags:
  - diagnostics
  - message-registry
  - code-tests-map
  - tooling
  - source-generator
codeReferences:
  - src/Whizbang.Generators/DiagnosticDescriptors.cs
  - src/Whizbang.Generators/MessageRegistryGenerator.cs
  - src/Whizbang.Generators/PathResolver.cs
testReferences:
  - tests/Whizbang.Generators.Component.Tests/MessageRegistryGeneratorCoverageTests.cs
lastMaintainedCommit: '9a416b5b'
---

# WHIZ054: Failed to Load Tests Map

**Severity**: Info
**Category**: Message Registry Tooling

## Description

The `MessageRegistryGenerator` builds a registry of your messages, dispatchers, receptors and perspectives for IDE
tooling. When it can find a checkout of the documentation repository, it enriches each entry with the tests linked to
it, read from that checkout's `src/assets/code-tests-map.json`.

WHIZ054 means the generator found the checkout and the file exists, but reading or parsing it threw an exception. The
generator reports the exception message, skips the test enrichment, and **still generates the registry** with no test
entries. Your application code and its behavior are not affected.

It is reported once per build, with no source location. It is the test-map twin of
[WHIZ053](whiz053), and a single broken checkout can produce both.

### When it fires, and when it does not

The checkout is located the same way as for WHIZ053: the `WhizbangDocsPath` MSBuild property when it names an existing
directory, otherwise a `whizbang-lib.github.io` directory beside the git root above the project.

| Situation | Result |
|-----------|--------|
| No checkout found | No diagnostic, no tests |
| Checkout found, `code-tests-map.json` missing | No diagnostic, no tests |
| File is the JSON literal `null`, or an object without a `CodeToTests` table | No diagnostic, no tests |
| File cannot be read or is not valid JSON of the expected shape | **WHIZ054**, no tests |

The loader binds JSON property names case-sensitively: it reads a top-level `CodeToTests` table whose entries carry
`TestFile`, `TestMethod`, `TestLine` and `TestClass`. A map that spells the table `codeToTests` parses without error,
so it does not raise WHIZ054, but it contributes no tests.

## Diagnostic Message

```text{title="WHIZ054 message format" description="The descriptor's message format, with the placeholder named" category="Diagnostics" difficulty="BEGINNER" tags=["WHIZ054", "Message Registry", "Diagnostics"] unverified="message format read from the descriptor"}
Could not load code-tests-map.json from documentation repository: {ExceptionMessage}. Test counts will not be included in message-registry.json.
```

## Common Causes

1. **A malformed map file**: a partial write, a merge conflict marker, or hand edits left `code-tests-map.json` as
   invalid JSON.
2. **A map of the wrong shape**: valid JSON whose values do not match the expected types, so deserialization throws.
3. **The file cannot be read**: a permissions problem or a file locked while it is being regenerated.
4. **`WhizbangDocsPath` points at the wrong directory**.

## Example

A documentation checkout whose tests map is not valid JSON produces WHIZ054, and the registry is still generated:

```json{title="A code-tests-map.json that produces WHIZ054" description="Invalid JSON in the documentation checkout's tests map" category="Diagnostics" difficulty="BEGINNER" tags=["WHIZ054", "Message Registry", "code-tests-map"] testFile="MessageRegistryGeneratorCoverageTests.cs" testMethod="MessageRegistryGenerator_MalformedMapFiles_ReportsInfoDiagnosticsAndStillGeneratesAsync" githubUrl="https://github.com/whizbang-lib/whizbang/blob/develop/tests/Whizbang.Generators.Component.Tests/MessageRegistryGeneratorCoverageTests.cs" tests=["MessageRegistryGeneratorCoverageTests.MessageRegistryGenerator_MalformedMapFiles_ReportsInfoDiagnosticsAndStillGeneratesAsync"]}
{ this is not valid json !!!
```

## How to Fix

- **Regenerate the map** in the documentation checkout (`node src/scripts/generate-code-tests-map.mjs`), or restore
  the file from version control.
- **Check `WhizbangDocsPath`** if it is set: it should name the documentation checkout's root, the directory that
  contains `src/assets/`.
- **Remove the file or the setting** if you do not need test information in the registry. With no map file, or no
  checkout found, the generator stays silent.

## Suppressing

WHIZ054 is informational and does not fail the build. Suppressing it is reasonable where you do not need test
information in the tooling registry. Keep it visible while you are working on the test links themselves.

`#pragma warning` cannot reach WHIZ054: it is reported with no source location. Use a global analyzer config, or
`NoWarn` in the project file.

```ini{title="Suppress WHIZ054 in a global analyzer config" description="Location-less diagnostics need a global config, not a [*.cs] section" category="Diagnostics" difficulty="BEGINNER" tags=["WHIZ054", "Suppression", "GlobalConfig"] unverified="suppression/config; not exercised by a test"}
# .globalconfig
is_global = true
dotnet_diagnostic.WHIZ054.severity = none
```

```xml{title="Suppress WHIZ054 with NoWarn" description="Project-file suppression" category="Diagnostics" difficulty="BEGINNER" tags=["WHIZ054", "Suppression", "NoWarn"] unverified="suppression/config; not exercised by a test"}
<PropertyGroup>
  <NoWarn>$(NoWarn);WHIZ054</NoWarn>
</PropertyGroup>
```

A `dotnet_diagnostic.WHIZ054.severity = none` line under a `[*.cs]` section of `.editorconfig` applies to source
files, so it does not reach a diagnostic that has no source file.

## Related

- [WHIZ053: Failed to Load Documentation Map](whiz053)
- [Message Registry](../../extending/source-generators/message-registry)
- [Documentation and test maps](../../extending/source-generators/message-registry#documentation-and-test-maps)
