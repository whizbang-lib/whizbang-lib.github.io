---
title: 'WHIZ053: Failed to Load Documentation Map'
pageType: troubleshooting
verifiedAgainstCommit: 9a416b5b
verifiedDate: 2026-10-17
description: >-
  Informational diagnostic when the message registry generator finds a documentation checkout but cannot read its
  code-docs-map.json. The build continues and the registry is generated without documentation URLs.
version: 1.0.0
category: Diagnostics
severity: Info
tags:
  - diagnostics
  - message-registry
  - code-docs-map
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

# WHIZ053: Failed to Load Documentation Map

**Severity**: Info
**Category**: Message Registry Tooling

## Description

The `MessageRegistryGenerator` builds a registry of your messages, dispatchers, receptors and perspectives for IDE
tooling. When it can find a checkout of the documentation repository, it enriches each entry with a `docsUrl` read
from that checkout's `src/assets/code-docs-map.json`.

WHIZ053 means the generator found the checkout and the file exists, but reading or parsing it threw an exception. The
generator reports the exception message, skips the documentation enrichment, and **still generates the registry**:
every entry's `docsUrl` is empty. Your application code and its behavior are not affected; only the tooling metadata
is thinner.

It is reported once per build, with no source location.

### When it fires, and when it does not

The generator locates the documentation checkout from build properties only
([Documentation and test maps](../../extending/source-generators/message-registry#documentation-and-test-maps)):

1. The `WhizbangDocsPath` MSBuild property, when it names a directory that exists (it defaults from the
   `WHIZBANG_DOCS_PATH` environment variable).
2. Otherwise a `whizbang-lib.github.io` directory beside the git root above the project.

| Situation | Result |
|-----------|--------|
| No checkout found | No diagnostic, no enrichment |
| Checkout found, `code-docs-map.json` missing | No diagnostic, no enrichment |
| File contains the JSON literal `null` | No diagnostic, no enrichment |
| File cannot be read or is not valid JSON of the expected shape | **WHIZ053**, no enrichment |

The loader reads JSON property names case-insensitively, so the camelCase entries the documentation site writes
(`file`, `symbol`, `docs`) bind as expected and fill each entry's `docsUrl`. WHIZ053 fires only when the file truly
fails to load.

## Diagnostic Message

```text{title="WHIZ053 message format" description="The descriptor's message format, with the placeholder named" category="Diagnostics" difficulty="BEGINNER" tags=["WHIZ053", "Message Registry", "Diagnostics"] unverified="message format read from the descriptor"}
Could not load code-docs-map.json from documentation repository: {ExceptionMessage}. Documentation URLs will not be included in message-registry.json.
```

## Common Causes

1. **A malformed map file**: a partial write, a merge conflict marker, or hand edits left `code-docs-map.json` as
   invalid JSON.
2. **A map of the wrong shape**: the file is valid JSON but not an object of entries, so deserialization throws.
3. **The file cannot be read**: a permissions problem or a file locked while it is being regenerated.
4. **`WhizbangDocsPath` points at the wrong directory**, one that happens to contain an unrelated
   `src/assets/code-docs-map.json`.

## Example

A documentation checkout whose map file is not valid JSON produces WHIZ053, and the registry is still generated:

```json{title="A code-docs-map.json that produces WHIZ053" description="Invalid JSON in the documentation checkout's map file" category="Diagnostics" difficulty="BEGINNER" tags=["WHIZ053", "Message Registry", "code-docs-map"] testFile="MessageRegistryGeneratorCoverageTests.cs" testMethod="MessageRegistryGenerator_MalformedMapFiles_ReportsInfoDiagnosticsAndStillGeneratesAsync" githubUrl="https://github.com/whizbang-lib/whizbang/blob/develop/tests/Whizbang.Generators.Component.Tests/MessageRegistryGeneratorCoverageTests.cs" tests=["MessageRegistryGeneratorCoverageTests.MessageRegistryGenerator_MalformedMapFiles_ReportsInfoDiagnosticsAndStillGeneratesAsync"]}
{ this is not valid json !!!
```

## How to Fix

- **Regenerate the map** in the documentation checkout (`node src/scripts/generate-code-docs-map.mjs`), or restore
  the file from version control.
- **Check `WhizbangDocsPath`** if it is set: it should name the documentation checkout's root, the directory that
  contains `src/assets/`.
- **Remove the file or the setting** if you do not need documentation URLs in the registry. With no map file, or no
  checkout found, the generator stays silent.

## Suppressing

WHIZ053 is informational and does not fail the build. Suppressing it is reasonable on machines and build agents where
you do not care about documentation URLs in the tooling registry. Do not suppress it while you are working on the
documentation links themselves, because it is the only signal that the map was rejected.

`#pragma warning` cannot reach WHIZ053: it is reported with no source location. Use a global analyzer config, or
`NoWarn` in the project file.

```ini{title="Suppress WHIZ053 in a global analyzer config" description="Location-less diagnostics need a global config, not a [*.cs] section" category="Diagnostics" difficulty="BEGINNER" tags=["WHIZ053", "Suppression", "GlobalConfig"] unverified="suppression/config; not exercised by a test"}
# .globalconfig
is_global = true
dotnet_diagnostic.WHIZ053.severity = none
```

```xml{title="Suppress WHIZ053 with NoWarn" description="Project-file suppression" category="Diagnostics" difficulty="BEGINNER" tags=["WHIZ053", "Suppression", "NoWarn"] unverified="suppression/config; not exercised by a test"}
<PropertyGroup>
  <NoWarn>$(NoWarn);WHIZ053</NoWarn>
</PropertyGroup>
```

A `dotnet_diagnostic.WHIZ053.severity = none` line under a `[*.cs]` section of `.editorconfig` applies to source
files, so it does not reach a diagnostic that has no source file.

## Related

- [WHIZ054: Failed to Load Tests Map](whiz054)
- [Message Registry](../../extending/source-generators/message-registry)
- [Documentation and test maps](../../extending/source-generators/message-registry#documentation-and-test-maps)
