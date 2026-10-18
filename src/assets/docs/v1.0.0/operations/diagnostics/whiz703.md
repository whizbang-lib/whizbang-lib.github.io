---
title: 'WHIZ703: No DbContext Found'
pageType: troubleshooting
verifiedAgainstCommit: 9a416b5b
verifiedDate: 2026-10-17
description: >-
  Info diagnostic when the EF Core service registration generator finds no DbContext marked [WhizbangDbContext], so it
  generates no DbContext partial class. Expected in library projects.
version: 1.0.0
category: Diagnostics
severity: Info
tags:
  - diagnostics
  - ef-core
  - dbcontext
  - opt-in
  - source-generator
codeReferences:
  - src/Whizbang.Data.EFCore.Postgres.Generators/EFCoreServiceRegistrationGenerator.cs
testReferences: []
lastMaintainedCommit: '9a416b5b'
---

# WHIZ703: No DbContext Found

**Severity**: Info
**Category**: EF Core / DbContext Discovery

## Description

The EF Core service registration generator only works on DbContext classes you opt in explicitly. A class is
discovered when it derives from `DbContext` **and** carries `[WhizbangDbContext]`. When the compilation contains no
such class, the generator reports WHIZ703 and skips the DbContext partial class (the `DbSet` properties and the
`OnModelCreating` hook that configures Whizbang's tables).

In a library project that holds messages, perspectives or models but no DbContext, this is expected and needs no
action. In the project that owns your DbContext, it means the DbContext was not picked up.

It is reported once per compilation, with no source location.

## Diagnostic Message

```
Could not find any DbContext classes with [WhizbangDbContext] attribute. Partial class generation requires explicit opt-in.
```

## Common Causes

1. **A library project** that references the EF Core Postgres package but defines no DbContext. Nothing is wrong.
2. **The DbContext has no `[WhizbangDbContext]`.** A plain `DbContext` subclass is not discovered.
3. **The attribute is a different type with the same name.** Discovery matches
   `Whizbang.Data.EFCore.Custom.WhizbangDbContextAttribute` exactly.

## How to Fix

In the project that owns the DbContext, add `[WhizbangDbContext]`.

### Before (causes WHIZ703)

```csharp{
title: "A DbContext without the opt-in attribute"
description: "The generator does not discover a DbContext that lacks [WhizbangDbContext]; with no other opted-in context, WHIZ703 is reported."
framework: "NET10"
category: "Diagnostics"
difficulty: "BEGINNER"
tags: ["whiz703", "ef-core", "dbcontext", "counter-example"]
unverified: "no test asserts WHIZ703; counter-example"
}
public class TestDbContext : DbContext {
  public TestDbContext(DbContextOptions<TestDbContext> options) : base(options) { }
}
```

### After (no WHIZ703)

```csharp{
title: "A DbContext opted in with [WhizbangDbContext]"
description: "The attribute, from Whizbang.Data.EFCore.Custom, opts the DbContext in to partial class generation."
framework: "NET10"
category: "Diagnostics"
difficulty: "BEGINNER"
tags: ["whiz703", "ef-core", "dbcontext", "opt-in"]
unverified: "no test asserts WHIZ703; the DbContext shape matches the generator tests"
}
using Microsoft.EntityFrameworkCore;
using Whizbang.Data.EFCore.Custom;

[WhizbangDbContext]
public class TestDbContext : DbContext {
  public TestDbContext(DbContextOptions<TestDbContext> options) : base(options) { }
}
```

## Suppressing

Suppress it in library projects where no DbContext is expected; it hides the notice and changes nothing about what is
generated. Do not suppress it in the project that owns your DbContext, where it is the only build-time sign that the
DbContext was not discovered. The diagnostic has no source location, so `#pragma warning disable WHIZ703` has no
effect; set the severity in a global analyzer config file:

```ini{
title: "Silence WHIZ703 in a global analyzer config"
description: "Sets the WHIZ703 severity to none for the whole project."
category: "Diagnostics"
difficulty: "BEGINNER"
tags: ["whiz703", "suppression", "globalconfig"]
unverified: "suppression/config, not exercised by a test"
}
# .globalconfig
is_global = true
dotnet_diagnostic.WHIZ703.severity = none
```

## Related

- [WHIZ701: EF Core perspective discovery](whiz701)
- [WHIZ702: EF Core migration files discovery](whiz702)
- [EF Core Integration](../../data/efcore-integration)
- [Project Structure](../../getting-started/project-structure)
