---
title: Data engines
order: 10
---

# Data engines

Whizbang's data layer is built around two extension axes:

1. **Engine** — the database (Postgres today, SQL Server / MySQL / SQLite future). Each engine ships in `Whizbang.Data.<Engine>` and owns the SQL function definitions + driver-level concerns (connection pooling, type mapping, NOTIFY/LISTEN).
2. **ORM** — the .NET data access layer (EF Core or Dapper). Each ORM-on-engine combination ships in `Whizbang.Data.<ORM>.<Engine>` and is the binding layer between Whizbang interfaces and the SQL.

This section is the contributor reference for adding a new engine, a new ORM integration, or both. Everything you need to land a conformant implementation lives here.

## Pages

- [Overview](overview.md)
- [Implementing IWorkCoordinator](implementing-iworkcoordinator.md)
- [Implementing IWorkCoordinatorCapabilities](implementing-icapabilities.md)
- [Implementing notifications](implementing-notifications.md)
- [SQL function contracts](sql-function-contracts.md)
- [Testing a new engine](testing-a-new-engine.md)
- [Worked example: SQL Server](worked-example-sqlserver.md)
- [Worked example: SQLite (polling-only)](worked-example-sqlite.md)
