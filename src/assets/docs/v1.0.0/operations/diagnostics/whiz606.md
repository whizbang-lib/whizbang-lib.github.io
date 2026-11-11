---
title: 'WHIZ606: Credential-Named Settings Property Is a Plain String'
pageType: troubleshooting
version: 1.0.0
description: >-
  A repository check: a Whizbang settings property whose name says it holds a
  credential is declared as a plain string, so writing the settings out would
  write the credential
category: Diagnostics
severity: Error
tags:
  - diagnostics
  - repository-check
  - configuration
  - security
  - analyzer
codeReferences:
  - tools/Whizbang.RepoAnalyzers/PlainStringCredentialSettingAnalyzer.cs
  - src/Whizbang.Core/Configuration/SensitiveString.cs
testReferences:
  - tests/Whizbang.RepoAnalyzers.Tests/PlainStringCredentialSettingAnalyzerTests.cs
---

# WHIZ606: Credential-Named Settings Property Is a Plain String

**Severity**: Error
**Raised by**: `Whizbang.RepoAnalyzers` (Roslyn analyzer)

This is a check on the Whizbang repository's own code and tests. It runs only in this repository's builds and never ships in a package, so an application that uses Whizbang never sees it. See [Repository Checks and Diagnostic IDs](../../../contributors/repository-checks.md) for the whole block.

## What it means

A settings property holds a credential in a plain `string`. A settings property is a public instance property with a public setter (or `init`) on a type whose name ends in `Options` or `Settings`, the shape configuration binds. Its name says it holds a credential when it ends in `ConnectionString`, `Password`, `Secret`, `Token`, `Key`, `Credential` or `Credentials`, ignoring case:

```csharp{title="The property WHIZ606 reports" description="A connection string held as a plain string is written out whole wherever the options are." category="Diagnostics" difficulty="INTERMEDIATE" tags=["whiz606", "repository-check", "configuration", "security"] tests=["PlainStringCredentialSettingAnalyzerTests.ACredentialNamedStringSetting_ReportsAsync", "PlainStringCredentialSettingAnalyzerTests.EveryCredentialWord_ReportsAsync"]}
public sealed class StoreOptions {
  public string? ConnectionString { get; set; }
}
```

A name that only refers to a credential (`ConnectionStringName`, `KeyId`) does not end in one of those words and is not reported.

## Why it matters

Settings are written out: in log lines, in the [startup settings report](../configuration/startup-settings-report.md), in serialized diagnostics. A credential held in a plain string is written out whole wherever that happens. Held in a [`SensitiveString`](../configuration/sensitive-settings.md), it writes a redaction instead, everywhere, so it cannot leak by being written out. The rule makes the type a requirement rather than a convention to remember.

## How to fix it

Declare the property as `SensitiveString?` and bind it with `ConfigurationValueBinder.BindSensitive`, because the configuration binder source generator skips the type:

```csharp{title="Clearing WHIZ606" description="The credential is a SensitiveString, bound explicitly; the code that needs it calls Reveal." category="Diagnostics" difficulty="INTERMEDIATE" tags=["whiz606", "repository-check", "configuration", "security"] tests=["PlainStringCredentialSettingAnalyzerTests.WhatIsNotACredentialSetting_DoesNotReportAsync", "ConfigurationValueBinderTests.BindSensitive_WrapsTheValue_AndSkipsBlankOrMissingAsync"]}
public sealed class StoreOptions {
  public SensitiveString? ConnectionString { get; set; }
}

// Where the section is bound:
ConfigurationValueBinder.BindSensitive(section, "ConnectionString", value => options.ConnectionString = value);

// Where the credential is used:
var client = new BlobServiceClient(options.ConnectionString!.Reveal());
```

A property that names where a credential is found rather than holding it (the name of a `ConnectionStrings` entry, say) suppresses the rule where it is declared, with a comment saying so.

## Related

- [Sensitive settings](../configuration/sensitive-settings.md)
- [Startup settings report](../configuration/startup-settings-report.md)
- [Repository Checks and Diagnostic IDs](../../../contributors/repository-checks.md)
