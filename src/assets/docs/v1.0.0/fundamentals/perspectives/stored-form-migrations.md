---
title: Stored-Form Migrations
pageType: concept
version: 1.0.0
category: Perspectives
order: 11
description: >-
  Declare how existing perspective documents change when a model changes shape:
  a property's type, name, removal or default. The generator turns each
  declaration into an idempotent in-place rewrite that runs at startup in the
  stored-format rewrite phase, journaled, blocking only on values it cannot
  convert.
tags: >-
  perspectives, stored-forms, migrations, jsonb, schema-evolution, rewrite,
  physical-fields, journal, startup
codeReferences:
  - src/Whizbang.Core/Perspectives/StoredFormAttribute.cs
  - src/Whizbang.Core/Perspectives/StoredFormRemovedAttribute.cs
  - src/Whizbang.Core/Perspectives/IStoredFormMigration.cs
  - src/Whizbang.Data.Postgres/StoredFormMigrationSql.cs
  - src/Whizbang.Data.Postgres/StoredFormStep.cs
  - src/Whizbang.Data.Postgres/StoredFormMigrationJournal.cs
  - src/Whizbang.Data.Postgres/Migrations/176_StoredFormMigrations.sql
  - src/Whizbang.Data.Postgres/CanonicalTemporalRewritePhase.cs
  - src/Whizbang.Generators.Shared/Models/StoredFormDiscovery.cs
  - src/Whizbang.Data.EFCore.Postgres.Generators/EFCoreServiceRegistrationGenerator.cs
  - src/Whizbang.Data.EFCore.Postgres.Generators/Templates/DbContextSchemaExtensionTemplate.cs
  - tools/Whizbang.CLI/Program.cs
testReferences:
  - tests/Whizbang.Core.Tests/Perspectives/StoredFormAttributeTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/Migrations/StoredFormMigrationTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/Migrations/StoredFormMigrationSqlTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/StoredFormMigrationWorkerTests.cs
  - tests/Whizbang.Generators.Tests/StoredFormMigrationGenerationTests.cs
---

# Stored-Form Migrations

A perspective stores its model as a JSON document. When the model changes shape, the documents
already stored keep the old shape. Most changes are harmless: a new optional property reads as its
default, and a removed one is ignored. Some are not. A property changed from `int` to `string` finds
a JSON number where the reader now expects a string, the reader refuses it, and the stream
[parks](../../operations/infrastructure/migrations.md#when-a-row-cannot-be-read) until someone
fixes the data.

A **stored-form migration** says how the stored documents change. You declare it next to the model,
and the framework converts the rows in place at startup. It runs in the same
[stored-format rewrite phase](../../operations/infrastructure/migrations.md#the-stored-form-rewrite)
that converts temporal keys and [enum columns](physical-fields.md#enum-text-columns), with the same
guarantees.

| Your model changed | Declare | What happens to stored rows |
|---|---|---|
| A property's type | `[StoredForm(Previously = typeof(int))]` | Values still in the old form are converted |
| A property's name | `[StoredForm(PreviousName = "OldName")]` | The value moves to the new key |
| A property was removed | `[StoredFormRemoved("OldName")]` on the model | The key is dropped |
| A new property needs a value | `[StoredForm(DefaultWhenMissing = 0)]` | Rows without the key get the default |
| Anything else | A class implementing `IStoredFormMigration<TModel>` | Your SQL runs once |

Other ways to fix stored data, and when to use them instead:

- **An [event upcaster](../events/event-upcasting.md)** fixes the shape of *events* as they are read. It
  does nothing for documents already stored.
- **A [rebuild](rebuild.md)** replays events into fresh rows. It is always correct, but it costs a
  full replay, and the events have to be right.
- **A stored-form migration** changes the stored documents in place, once. It is the cheapest fix
  when the documents only need converting.

## Declaring a migration on the model {#declaring}

Put `[StoredForm]` on the property as it is **now**, and say what it **was**:

```csharp{title="A property whose type changed" description="Status used to be an int. Rows written before the change hold a JSON number; the migration converts them to strings and leaves rows that already hold a string alone." framework="NET10" category="Perspectives" difficulty="INTERMEDIATE" tags=["perspectives", "stored-forms", "migrations"]}
public record OrderModel {
  [StreamId]
  public Guid OrderId { get; init; }

  // Was: public int Status { get; init; }
  [StoredForm(Previously = typeof(int))]
  public string Status { get; init; } = string.Empty;
}
```

`[StoredForm]` has three settings, and you can combine them on one property:

| Setting | Meaning |
|---|---|
| `Previously` | The property's former type. Stored values still in that type's form are converted to the current type's form. |
| `PreviousName` | The property's former name. A stored value under the old key moves to the new key. |
| `DefaultWhenMissing` | A value for rows that have no key for this property at all. |

A property removed from the model has nothing to carry an attribute, so its removal is declared on
the model. Use one `[StoredFormRemoved]` per removed property:

```csharp{title="Renames, removals and defaults together" description="The generator emits one journaled migration per declaration. Renames run first, then type conversions, then defaults, then removals." framework="NET10" category="Perspectives" difficulty="INTERMEDIATE" tags=["perspectives", "stored-forms", "migrations"]}
[StoredFormRemoved("LegacyCode")]
[StoredFormRemoved("Shipping.Instructions")]
public record CustomerModel {
  [StreamId]
  public Guid CustomerId { get; init; }

  // Was: public string Name { get; init; }
  [StoredForm(PreviousName = "Name")]
  public string DisplayName { get; init; } = string.Empty;

  // New in this release. Rows written earlier get 1.
  [StoredForm(DefaultWhenMissing = 1)]
  public int Tier { get; init; } = 1;

  public Address Shipping { get; init; } = new();
}

public record Address {
  // Nested properties are declared the same way; the path is Shipping.Line1.
  [StoredForm(PreviousName = "Street")]
  public string Line1 { get; init; } = string.Empty;
}
```

Declarations work on the model's own properties, on inherited ones, and on properties of nested
objects the model reaches through a property (`Shipping.Line1`). A declaration inside an element of a
collection is not generated. Such a declaration is reported as **WHIZ832**, and a custom migration
covers it.

A `[StoredFormRemoved]` path is relative to the type that carries the attribute, with nested keys
separated by dots.

### Leave declarations in place {#leave-declarations}

A declaration costs nothing once it has **settled**, because a settled migration is skipped with one
lookup and no scan (see [The journal](#journal)). Leave it in place until every environment has
started on the release that introduced it, then remove it. Removing it earlier means a database
that has not run it yet is never converted.

## What the generator converts {#generated-cases}

Each declaration becomes one SQL statement. Every statement is idempotent: it converts only values
that are **still in the old form** and leaves every other value alone. So a second run changes
nothing, and a row a newer instance already wrote in the new form is not touched.

### Type changes {#type-changes}

{verified: StoredFormMigrationTests.NumberToString_ConvertsNumbersAndBooleans_LeavesStringsNullsAndMissingAsync, StoredFormMigrationTests.EnumNumberToName_UsesTheMemberName_OrTheNumbersTextAsync, StoredFormMigrationTests.StringToInteger_ConvertsNumericStrings_AndWholeNumbersWrittenWithAFractionAsync, StoredFormMigrationTests.StringToDecimal_ConvertsNumericStrings_LeavesNumbersAsync, StoredFormMigrationTests.NarrowingNumbers_BlockOutOfRange_AndWideningNeedsNoChangeAsync, StoredFormMigrationTests.EveryNumberKind_BlocksAValueOutsideItsRangeAsync, StoredFormMigrationTests.StringToEnum_NamesAndNumericStringsBecomeNumbers_UnknownNamesBlockAsync, StoredFormMigrationTests.StringToFlagsEnum_CombinedNamesBecomeTheirBitwiseOr_AnUnknownComponentBlocksAsync, StoredFormMigrationGenerationTests.EachTypeChange_BecomesAStepFromTheFormerTypeToTheCurrentAsync, StoredFormMigrationGenerationTests.ADeclarationItCannotGenerate_IsWHIZ830_AndEmitsNothingAsync}

| From (`Previously`) | To (the property now) | Converted | Left alone | Blocks startup |
|---|---|---|---|---|
| any number, `bool` | `string` | a number or boolean becomes its text (`123` → `"123"`) | strings, nulls | never |
| an enum | `string` | a number becomes the member's name, or the number's text when no single member has it | strings, nulls | never |
| `string` | an integer type | a numeric string becomes a number (`"42"` → `42`) | numbers, nulls | a non-numeric string, a fraction, or a value outside the type's range |
| `string` | `decimal`, `double`, `float` | a numeric string becomes a number | numbers, nulls | a non-numeric string |
| a number | an integer type (narrowing or widening) | a whole number written with a fraction (`5.0` → `5`) | whole numbers in range, nulls | a fraction, or a value outside the type's range |
| `string` | an enum | a member name becomes its number, and a numeric string its number. For `[Flags]` enums, combined names (`"Read, Write"`) become the bitwise OR | numbers, nulls | a name that is not a member (names match exactly, so different casing blocks too) |

Widening `int` to `long` (or to `decimal` or `double`) needs no change inside the document, because
a JSON number is already readable as the wider type. The generator still emits the migration: it
checks that no stored value is out of range, and it retypes a [physical column](#physical-columns).

Any other pair (`Guid` to `int`, `bool` to `int`, a class to a string, and so on) is not generated.
The build reports **WHIZ830**. Write a [custom migration](#custom) for it.

### Renames, removals and defaults {#paths}

{verified: StoredFormMigrationTests.Rename_MovesTheValue_NestedToo_AndTheNewKeyWinsWhenBothExistAsync, StoredFormMigrationTests.Remove_DropsTheKeyWhereverItIs_AndNeverBlocksAsync, StoredFormMigrationTests.DefaultWhenMissing_FillsOnlyAMissingKey_UnderAnExistingParentAsync, StoredFormMigrationGenerationTests.RenamesDefaultsAndRemovals_AreGenerated_NestedPathsTooAsync}

- **Rename** (`PreviousName`): a row that holds the old key gets its value moved to the new key, and
  the old key is removed. If a row somehow holds both keys, the new key's value wins and the old key
  is dropped. A `null` moves as `null`.
- **Removal** (`[StoredFormRemoved]`): the key is dropped from every row that has it. Nothing
  blocks.
- **Default** (`DefaultWhenMissing`): a row whose parent object exists but has no key for the
  property gets the default. A key that holds `null` is left as it is, because `null` may be a real
  value. The default is written in the document's form: a string as a JSON string, a number as a
  number, an enum as its number, a `bool` as `true` or `false`.

### Order within a table {#order}

The migrations for one table run in this order: renames, type conversions, defaults, removals, then
custom migrations in the order of their class's full name. So a property that is renamed and
retyped in the same release gets both, rename first. The tables run in name order.

{verified: StoredFormMigrationGenerationTests.Migrations_RunRenamesThenConversionsThenDefaultsThenRemovals_ThenCustomByNameAsync, StoredFormMigrationGenerationTests.TheMigrations_RunInTheRewritePhaseBeforeTheTemporalRewrite_AndStatusIsExposedAsync}

Stored-form migrations run **before** the canonical temporal rewrite. So a temporal value moved by a
rename is converted to the canonical form in the same pass.

## Custom migrations (the escape hatch) {#custom}

For anything the generator does not handle, implement `IStoredFormMigration<TModel>`. The generator
finds the class at build time, the same way it finds perspectives. It needs a public or internal
parameterless constructor, and `TModel` has to be the model of a perspective. A migration that could
never run (its model is no perspective's, or the generated code cannot create it) is reported as
**WHIZ831**. An abstract class is a base for migrations, not one, and is passed over.

```csharp{title="A custom stored-form migration" description="Raw SQL for a change the generator does not cover: splitting one key into two. It runs once, journaled by its name, under the same lock and fence as the generated migrations." framework="NET10" category="Perspectives" difficulty="ADVANCED" tags=["perspectives", "stored-forms", "migrations", "sql"]}
public sealed class SplitFullName : IStoredFormMigration<CustomerModel> {
  // Stable forever: the journal records the migration under this name.
  public string Name => "2026-10-customer-split-full-name";

  public string BuildSql(StoredFormMigrationTarget target) => $"""
    UPDATE {target.QualifiedTable}
    SET data = (data - 'FullName')
      || jsonb_build_object(
           'FirstName', split_part(data ->> 'FullName', ' ', 1),
           'LastName',  substr(data ->> 'FullName', strpos(data ->> 'FullName', ' ') + 1))
    WHERE data ? 'FullName';
    """;
}
```

{verified: StoredFormMigrationTests.ACustomMigration_RunsOnce_EvenThoughItsSqlIsNotIdempotentAsync, StoredFormMigrationTests.ACustomMigration_CanBlockStartup_WithTheStoredFormStateAsync, StoredFormMigrationTests.ACustomMigrationWhoseSqlHoldsTheDelimiter_StillRunsAsync, StoredFormMigrationSqlTests.ForPhase_ADuplicateName_IsRefusedNamingItAsync, StoredFormMigrationTests.AMissingTable_Waits_AndIsNotJournaledAsApplied_ThenRunsOnceItExistsAsync}

- **It runs once.** Once it succeeds it is journaled as settled and never runs again. Your SQL does
  not have to be idempotent, but idempotent SQL is still the safer habit.
- **The name is the identity.** Never rename a migration that has shipped. A new name is a new
  migration and runs again. Names must be unique within a `DbContext`, and startup fails on a
  duplicate.
- **It runs only once the table exists.** On a database where the table has not been created yet,
  the migration waits and runs on a later start.
- **To block startup**, raise the stored-form SQLSTATE with a message that names what is wrong:
  `RAISE EXCEPTION USING ERRCODE = 'WH980', MESSAGE = '...'`. The constant is
  `StoredFormMigrationTarget.BLOCKED_SQL_STATE`. Any other error is reported as a warning, and the
  migration stays pending for the next start.

`target.Schema` and `target.Table` are the unquoted names. `target.QualifiedTable` is the quoted
`"schema"."table"`.

## The journal {#journal}

Every migration, generated or custom, has a row in `wh_stored_form_migrations`, keyed by its name.
The journal is written in the same transaction and savepoint as the conversion, so it cannot say
"applied" about a table that was not converted.

| Column | Meaning |
|---|---|
| `name` | The migration's name. A generated name describes the declaration, for example `wh_per_order.Status:Int32->String` or `wh_per_customer.DisplayName:renamed-from:Name`. |
| `table_name` | The perspective table. |
| `kind` | `generated` or `custom`. |
| `declared_at` | When a release first declared it. |
| `first_applied_at`, `last_applied_at` | The first and the latest pass that ran it. |
| `rows_converted` | The total number of row updates across its passes. |
| `settled_at` | When it stopped needing to run. |

A migration moves through three states:

| State | Journal says | At startup |
|---|---|---|
| **Pending** | declared, never applied | runs |
| **Applied** | applied, not settled | runs again |
| **Settled** | `settled_at` set | skipped, with no scan |

{verified: StoredFormMigrationTests.ASecondRun_ChangesNothing_AndSettles_AndAThirdSkipsWithoutAScanAsync, StoredFormMigrationTests.ACustomMigration_RunsOnce_EvenThoughItsSqlIsNotIdempotentAsync}

A **custom** migration settles on its first successful run. A **generated** migration settles on the
first pass that finds **nothing left to convert**. A pass that converts rows leaves it Applied, so the
next start makes one more pass. That pass catches any row an instance of the previous release wrote in
the old form during a rolling deploy, then settles. So the table is scanned at most twice, and a
database created by this release settles on its first pass.

## Blocking startup {#blocking}

A migration blocks startup only when a stored value cannot be converted: a string that is not a
number where a number is expected, a name that is not a member of the enum, a number outside the
new type's range. Before it changes anything, the migration samples up to ten such values. It then
stops with an error that names the migration, the table, the path in the document (or the column),
and the values:

```text
The stored-format rewrite could not convert every stored value, so startup is stopped. Stored-form
migration wh_per_order.Quantity:String->Int32 cannot convert public.wh_per_order at $.Quantity:
"n/a", "twelve". Those values cannot be read as Int32. Correct or clear them, or declare a custom
migration that does, then restart.
```

{verified: StoredFormMigrationTests.StringToInteger_AValueItCannotConvert_BlocksNamingTheTablePathAndValue_ChangingNothingAsync, StoredFormMigrationTests.RetypeColumn_AValueThatIsNotANumber_BlocksNamingTheColumnAsync, StoredFormMigrationTests.ACustomMigration_CanBlockStartup_WithTheStoredFormStateAsync}

The blocked migration changes nothing, because it is rolled back to its savepoint. Every other
migration and rewrite in the pass still runs and commits first, and only then does startup stop.
This is the same rule [enum columns](physical-fields.md#enum-text-columns) follow: the framework does
not start on data it cannot read.

To unblock, correct the values yourself, or add a [custom migration](#custom) that does (it runs in
the same pass, after the generated ones), and restart.

Any other failure (a lock timeout, or a trigger you own that rejects the update) is not a block. It
is logged as a warning naming the migration, the migration stays Pending or Applied, and the next
start tries again.

## Recovery of parked streams {#recovery}

A stream whose stored document could not be read is parked, not lost. The failure is recorded
against its work rows, and the retry is scheduled with backoff
([When a row cannot be read](../../operations/infrastructure/migrations.md#when-a-row-cannot-be-read)).
Once a migration has converted the document, the stream recovers on its **next scheduled retry**,
with no operator step. The retry reads the converted document, applies the waiting events and
completes the rows. The stream then drops out of the `perspective-stored-forms` health component.

{verified: StoredFormScalarMismatchWorkerTests.NumberForAStringProperty_RecoversOnItsNextRetry_AfterTheStoredFormMigrationConvertsItAsync}

Two limits:

- A row that reached the dead-letter threshold before the migration ran is in the dead-letter
  queue. [Replay it](../../operations/dead-letter-queue/perspective-events.md) once the migration has run.
- Retries keep their scheduled backoff. The migration does not bring them forward, so a stream that
  was parked long enough to back off to minutes recovers within those minutes.

## Status {#status}

**At startup**, each migration reports what it did through the rewrite phase's log, at Information:

```text
Stored-format rewrite: wh_per_order: stored-form migration wh_per_order.Status:Int32->String: converted, 3 row update(s)
Stored-format rewrite: wh_per_order: stored-form migration wh_per_order.Status:Int32->String: nothing left to convert, settled
Stored-format rewrite: wh_per_order: stored-form migration wh_per_order.Status:Int32->String: settled, skipped
Stored-format rewrite: wh_per_new: stored-form migration wh_per_new.Code:default: table absent, waits for the table
```

**From the application**, the generated schema extension lists every migration this build declares,
merged with the journal:

```csharp{title="Listing stored-form migrations from the application" description="Pending, Applied or Settled for every migration the build declares, with the journal's counts and times." framework="NET10" category="Perspectives" difficulty="INTERMEDIATE" tags=["perspectives", "stored-forms", "migrations", "status"]}
var migrations = await dbContext.GetStoredFormMigrationStatusAsync(ct);
foreach (var m in migrations) {
  Console.WriteLine($"{m.State,-8} {m.Name} ({m.Table}) {m.RowsConverted} row(s)");
}
```

**From the command line**, for any environment, the Whizbang CLI reads the journal:

```bash{title="Stored-form migration status for an environment" description="Lists every stored-form migration recorded in a schema's journal, with its state, row count and times." category="Operations" difficulty="BEGINNER" tags=["cli", "stored-forms", "migrations", "status"]}
whizbang stored-forms status --connection "Host=...;Database=...;Username=..." --schema public
```

```text
State     Migration                                   Table          Rows  Applied              Settled
Settled   wh_per_order.Status:Int32->String           wh_per_order      3  2026-10-02 14:11:07  2026-10-02 15:40:12
Pending   2026-10-customer-split-full-name            wh_per_customer   0
```

{verified: StoredFormMigrationTests.Status_MergesTheDeclaredMigrationsWithTheJournal_AndFormatsAReportAsync, StoredFormMigrationTests.Status_WithoutAJournalTable_ReportsEveryDeclaredMigrationAsPendingAsync, StoredFormMigrationGenerationTests.TheMigrations_RunInTheRewritePhaseBeforeTheTemporalRewrite_AndStatusIsExposedAsync}

The CLI sees every migration some instance of the application has declared: the migrating instance
records each declaration as Pending before it runs the migrations, in a statement of its own outside
the phase's transaction, so declaring converts nothing and never makes the phase wait. A migration declared only in a
build that has not started yet is not in the journal, so the CLI cannot list it. The in-application
call can.

## Safety {#safety}

Stored-form migrations run inside the stored-format rewrite phase, so they share its guarantees
([The stored-form rewrite](../../operations/infrastructure/migrations.md#it-runs-once-after-the-election-and-waits-for-the-schema-lock)):

- **Once per schema.** They run on the one instance doing the schema work: the elected migrator, or
  an instance that takes over from one that died.
- **Under the schema lock.** They run under the key the bootstrap and DDL phases take. An instance
  that finds the key held waits for it and never skips.
- **One savepoint per migration.** One migration's failure neither undoes an earlier one nor stops a
  later one.
- **Before the indexes.** The pass commits before the transaction that builds indexes, so an index
  over a converted key is built over converted values.
- **The superseded-row-version fence.** After a pass that converted anything, the phase waits until
  no snapshot older than its commit is left, up to the schema command timeout. So a plain
  `CREATE INDEX` cannot trip over a row version the migration replaced (the #949 fence). A pass that
  wrote nothing does not wait. The fence counts any write, and a migration writes its journal row on
  the pass that converts and on the pass that settles, so each migration can make the phase wait at
  most twice over its life. A settled migration writes nothing.
- **Mixed fleets.** The migrator warns, as it does for the temporal rewrite, when other releases are
  alive. A generated migration settles only after a clean pass, so rows an older release writes
  during a rolling deploy are converted on the next start.

**Cost.** A document conversion is an `UPDATE` of the rows still in the old form, with row locks on
those rows only. The scan that finds them reads the whole table once per pass until the migration
settles. A column retype (below) rewrites the whole table under an `ACCESS EXCLUSIVE` lock, the same
accepted cost as the [enum column conversion](physical-fields.md#enum-text-columns).

## Physical columns {#physical-columns}

A property promoted with [`[PhysicalField]`](physical-fields.md) also lives in a column, and the
column has a type. A `[StoredForm]` declaration on such a property covers the column too:

| Declaration on a physical field | Column | Document |
|---|---|---|
| `Previously` (a type change) | Retyped in place to the new type (`ALTER COLUMN … TYPE … USING`), when its current type differs. Values that cannot be converted block, as in the document. | Converted as above, unless the model is [Split](physical-fields.md#split-mode), which keeps no copy in the document |
| `PreviousName` | Renamed, when the old column exists and the new one does not. A declared `ColumnName` that did not change leaves the column alone. | Moved as above, unless Split |
| `DefaultWhenMissing` | The schema pass adds the new column and backfills it from the document, which now holds the default | Default written, as above. Not supported on a Split model (WHIZ830): the value lives only in the column, so write a custom migration |
| `[StoredFormRemoved]` | Left in place. The framework never drops a column; drop it yourself when nothing reads it | Key dropped |

{verified: StoredFormMigrationTests.RetypeColumn_ToText_AndToANumber_BlockingWhatCannotConvertAsync, StoredFormMigrationTests.RetypeColumn_ToADecimal_KeepsTheFractionAsync, StoredFormMigrationTests.RenameColumn_RenamesOnlyWhenTheOldExistsAndTheNewDoesNotAsync, StoredFormMigrationTests.ColumnSteps_OnAMissingColumn_AreNoOpsAsync, StoredFormMigrationGenerationTests.APhysicalField_RetypesOrRenamesItsColumnWithItsDocumentAsync, StoredFormMigrationGenerationTests.ADefaultOnASplitPhysicalField_IsWHIZ830Async}

A retype to an **enum** is left to the [enum column conversion](physical-fields.md#enum-text-columns),
which already converts a text column of names to numbers. The stored-form migration converts the
document only.

**Indexes you declared over the old type.** `[Indexed]` on a document key builds an index whose
expression casts the key to its type, for example `((data ->> 'Quantity')::int4)`. The framework
does not drop an index when a declaration changes, so after a type change an index that still casts
to the old type stays in place. Writes of a value that index cannot cast then fail. Drop the old
index in a [custom migration](#custom) of the same release
(`DROP INDEX IF EXISTS "schema"."ix_..."`). The schema pass then builds the index for the new type.

## Diagnostics {#diagnostics}

{verified: StoredFormMigrationGenerationTests.ADeclarationItCannotGenerate_IsWHIZ830_AndEmitsNothingAsync, StoredFormMigrationGenerationTests.ADeclarationInsideACollectionElement_IsWHIZ832_AndAnOrphanMigrationWHIZ831Async, StoredFormMigrationGenerationTests.ADefaultOnASplitPhysicalField_IsWHIZ830Async}

| Id | Severity | Reported when |
|---|---|---|
| WHIZ830 | Error | A declaration the generator cannot turn into SQL: an unsupported type pair, `Previously` equal to the current type, a `[Flags]` enum over `ulong` converted from a string, or a default on a Split physical field. Use a custom migration. |
| WHIZ831 | Warning | An `IStoredFormMigration<TModel>` that would never run: its `TModel` is not the model of any perspective, or the generated code cannot create it (no public or internal parameterless constructor, a generic class, or a class it cannot see). |
| WHIZ832 | Warning | A `[StoredForm]` or `[StoredFormRemoved]` inside an element of a collection, which is not generated. Use a custom migration. |

## See also

- [The stored-form rewrite](../../operations/infrastructure/migrations.md#the-stored-form-rewrite):
  the phase these run in.
- [When a row cannot be read](../../operations/infrastructure/migrations.md#when-a-row-cannot-be-read):
  how a stream parks, and how it shows in health and metrics.
- [Enumeration columns](physical-fields.md#enum-columns).
- [Perspective rebuild](rebuild.md).
