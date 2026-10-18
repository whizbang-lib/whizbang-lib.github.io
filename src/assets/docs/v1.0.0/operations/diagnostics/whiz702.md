---
title: 'WHIZ702: EF Core Migration Files Discovery'
pageType: troubleshooting
verifiedAgainstCommit: 9a416b5b
verifiedDate: 2026-10-17
description: >-
  Info diagnostic in which the EF Core service registration generator reports how many embedded SQL migration files
  it found to include in the generated schema setup for your DbContext. It is a build-log notice, not a problem.
version: 1.0.0
category: Diagnostics
severity: Info
tags:
  - diagnostics
  - ef-core
  - migrations
  - schema
  - source-generator
codeReferences:
  - src/Whizbang.Data.EFCore.Postgres.Generators/EFCoreServiceRegistrationGenerator.cs
testReferences: []
lastMaintainedCommit: '9a416b5b'
---

# WHIZ702: EF Core Migration Files Discovery

**Severity**: Info
**Category**: EF Core / Schema Generation

## Description

For each `[WhizbangDbContext]` class, the EF Core service registration generator emits schema extension code that
applies the framework's SQL migrations at startup. Those migrations ship inside the generator assembly as embedded
`.sql` resources. While generating, it reports WHIZ702 with what it found, so the build log shows which migration set
was compiled into your application.

- It is reported once per compilation that has at least one `[WhizbangDbContext]` class, however many there are. With
  no such class, nothing is generated and WHIZ702 is not reported (see [WHIZ703](whiz703)).
- The file count and names come from the generator's own embedded resources, so they depend on the Whizbang package
  version you reference, not on your code.
- The list shows the first five file names in name order and then `... and N more`.
- The diagnostic has no source location.

## Diagnostic Message

```
Found {Count} migration files in {GeneratorAssembly} (prefix: {ResourcePrefix}): {FirstFileNames}
```

`{GeneratorAssembly}` is the generator assembly's name and `{ResourcePrefix}` is the embedded resource prefix the
files are found under.

## What Produces It

A DbContext opted in with `[WhizbangDbContext]`:

```csharp{
title: "A DbContext that opts in to Whizbang generation"
description: "With at least one [WhizbangDbContext], the generator emits schema extensions and reports the embedded migration files it includes."
framework: "NET10"
category: "Diagnostics"
difficulty: "BEGINNER"
tags: ["whiz702", "ef-core", "dbcontext", "migrations"]
unverified: "no test asserts WHIZ702; the DbContext shape matches the generator tests"
}
[WhizbangDbContext]
public class TestDbContext : DbContext {
  public TestDbContext(DbContextOptions<TestDbContext> options) : base(options) { }
}
```

If you are checking which schema version a build carries, compare the count and first names across package
upgrades. No action is needed otherwise.

## Suppressing

Suppressing is always safe: it hides the notice and changes nothing about what is generated. The diagnostic has no
source location, so `#pragma warning disable WHIZ702` has no effect; set the severity in a global analyzer config
file:

```ini{
title: "Silence WHIZ702 in a global analyzer config"
description: "Sets the WHIZ702 severity to none for the whole project."
category: "Diagnostics"
difficulty: "BEGINNER"
tags: ["whiz702", "suppression", "globalconfig"]
unverified: "suppression/config, not exercised by a test"
}
# .globalconfig
is_global = true
dotnet_diagnostic.WHIZ702.severity = none
```

## Related

- [WHIZ701: EF Core perspective discovery](whiz701)
- [WHIZ703: No DbContext found](whiz703)
- [Schema Migration](../../data/schema-migration)
- [Turnkey Initialization](../../data/turnkey-initialization)
