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
  - src/Whizbang.Data.EFCore.Postgres.Generators/DiagnosticDescriptors.cs
  - src/Whizbang.Core/Perspectives/StoredFormAttribute.cs
  - src/Whizbang.Core/Perspectives/StoredFormRemovedAttribute.cs
  - src/Whizbang.Core/Perspectives/IStoredFormMigration.cs
  - src/Whizbang.Data.Postgres/StoredFormMigrationSql.cs
  - src/Whizbang.Data.Postgres/StoredFormStep.cs
  - src/Whizbang.Data.Postgres/StoredFormMigrationJournal.cs
  - src/Whizbang.Data.Postgres/StoredFormIndexRebuild.cs
  - src/Whizbang.Data.Postgres/Migrations/176_StoredFormMigrations.sql
  - src/Whizbang.Data.Postgres/CanonicalTemporalRewritePhase.cs
  - src/Whizbang.Data.Postgres/Perspectives/DeclaredKeySpellingPass.cs
  - src/Whizbang.Data.Postgres/Perspectives/DeclaredKeySpellingDocument.cs
  - src/Whizbang.Data.Postgres/Perspectives/DeclaredKeySpellingSql.cs
  - src/Whizbang.Data.Postgres/Perspectives/DeclaredKeyShape.cs
  - src/Whizbang.Data.Postgres/Perspectives/DeclaredKeyTable.cs
  - src/Whizbang.Data.EFCore.Postgres/Perspectives/DeclaredKeyShapes.cs
  - src/Whizbang.Core/Perspectives/PerspectiveDocumentModels.cs
  - src/Whizbang.Core/Serialization/JsonContextRegistry.cs
  - src/Whizbang.Generators/MessageJsonContextGenerator.cs
  - src/Whizbang.Generators.Shared/Models/StoredFormDiscovery.cs
  - src/Whizbang.Data.EFCore.Postgres.Generators/EFCoreServiceRegistrationGenerator.cs
  - src/Whizbang.Data.EFCore.Postgres.Generators/Templates/DbContextSchemaExtensionTemplate.cs
  - tools/Whizbang.CLI/Program.cs
testReferences:
  - tests/Whizbang.Generators.Tests/DeclaredJsonConverterIgnoredTests.cs
  - tests/Whizbang.Core.Tests/Perspectives/StoredFormAttributeTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/Migrations/StoredFormMigrationTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/Migrations/StoredFormMigrationSqlTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/StoredFormMigrationWorkerTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/StoredFormScalarMismatchWorkerTests.cs
  - tests/Whizbang.Generators.Tests/StoredFormMigrationGenerationTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/Perspectives/DeclaredNameSpellingIntegrationTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/Perspectives/DeclaredKeySpellingPassTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/Perspectives/DeclaredKeySpellingDocumentTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/Perspectives/DeclaredKeyShapesTests.cs
  - tests/Whizbang.Data.Dapper.Postgres.Tests/Perspectives/DapperDeclaredNameSpellingTests.cs
  - tests/Whizbang.Core.Tests/Serialization/DeclaredNameReadTests.cs
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
[custom migrations](#custom) in the `Order` each states, lowest first, then by class name. So a property that is renamed and
retyped in the same release gets both, rename first. The tables run in name order.

{verified: StoredFormMigrationGenerationTests.Migrations_RunRenamesThenConversionsThenDefaultsThenRemovals_ThenCustomByNameWithoutAnOrderAsync, StoredFormMigrationGenerationTests.CustomMigrations_RunByTheirOrder_ThenByClassNameAsync, StoredFormMigrationGenerationTests.TheMigrations_RunInTheRewritePhaseBeforeTheTemporalRewrite_AndStatusIsExposedAsync}

Stored-form migrations run **before** the canonical temporal rewrite. So a temporal value moved by a
rename is converted to the canonical form in the same pass.

## Keys stored in another case than the declared name {#declared-names}

{verified: DeclaredNameSpellingIntegrationTests.RowsStoredWithCSharpNames_AreRewrittenOnStartup_AndReadBackWithTheirValuesAsync, DeclaredNameSpellingIntegrationTests.AnOpaqueRowStoredWithCSharpNames_IsRewrittenAndReadBackAsync, DapperDeclaredNameSpellingTests.RowsStoredWithCSharpNames_AreRewrittenAtHostStart_AndReadBackAsync, DeclaredKeySpellingDocumentTests.KeysInAnotherCase_MoveToTheDeclaredName_AtEveryDepthAsync}

:::updated
Releases before the message JSON context honored `[JsonPropertyName]` stored a property under its C# name.
Where that differs from the declared name only in case (`"X"` stored for `[JsonPropertyName("x")] X`), Entity
Framework's mapped reader matched the declared name exactly, found no key, and read the member's default with
no error: the row loaded and every such value was zeroed. Those keys are now rewritten at startup, with no
declaration needed.
:::

### What is rewritten {#declared-names-rewrite}

Every perspective table is checked at startup, as the **first step** of the
[stored-format rewrite phase](../../operations/infrastructure/migrations.md#the-stored-form-rewrite) on the EF
Core driver (before your stored-form migrations and the temporal rewrite, which address declared names), and
in the schema pass once the perspective tables exist on the Dapper driver.

- A stored key that matches a declared JSON name **only case-insensitively** is moved to the declared
  spelling. This happens **at any depth**: nested objects, and records inside collections, are reached too.
  Values move exactly as stored.
- The declared names come from what reads each document: Entity Framework's model for a mapped document, the
  serializer's metadata for a document stored as a single serialized value. The Dapper driver learns each
  table's model type from the generated schema, which registers it at load. Nothing is discovered by
  reflection.
- A table is walked in primary-key order in chunks of 1,000 rows. Only the rows that hold such a key are
  returned and updated, and each update is conditioned on the row version it read, so a row written in the
  meantime is never overwritten.
- A row holding **both** spellings with the **same** value keeps the declared one; the two merge.
- Each table rewritten is logged at Warning with the member paths and row counts:

```text
Rewrote stored keys to their declared spelling in public.wh_per_picture: 56 row(s) updated;
data $.Objects[*].Points[*]: X -> x in 56 row(s)
```

{verified: DeclaredNameSpellingIntegrationTests.BothSpellingsWithTheSameValue_MergeAsync, DeclaredNameSpellingIntegrationTests.RowsAlreadyInTheDeclaredSpelling_AreNeverUpdatedAsync, DeclaredKeySpellingDocumentTests.ValuesKeepTheirExactTextAsync, DeclaredKeySpellingPassTests.EveryChunk_IsRewritten_AndNamesThatAreNotIdentifiers_MatchLiterallyAsync, DapperDeclaredNameSpellingTests.TheGeneratedSchema_RegistersTheModelItsTableStoresAsync}

A key that differs from its declared name by **more than case** (a C# name `Points` declared `pts`) is not
moved: that is a rename. Declare it with `[StoredForm(PreviousName = "Points")]` ([renames](#paths)).

### A conflict stops startup {#declared-names-conflicts}

A row is left exactly as it was when a key cannot be moved safely:

- it holds both spellings with **different** values, or
- a stored key matches **two** declared names.

Every other row is still rewritten. Then startup stops with `StoredFormConversionBlockedException`, naming the
table, the column, the row id and the path for up to ten conflicts (and how many more there are):

```text
1 stored key(s) cannot be rewritten to their declared spelling, so those rows were left as they were:
public.wh_per_picture.data row 0199a1c4-...: $.Objects[0].Points[2] holds both "X" and "x" with different
values; the declared spelling is "x". Keep the value under the declared name and remove the other key in
each, then restart.
```

{verified: DeclaredNameSpellingIntegrationTests.ARowHoldingBothSpellings_StopsStartup_NamingItAsync, DapperDeclaredNameSpellingTests.ARowHoldingBothSpellings_StopsStartup_NamingItAsync, DeclaredKeySpellingDocumentTests.BothSpellingsWithDifferentValues_AreAConflict_AndTheDocumentIsLeftAloneAsync, DeclaredKeySpellingDocumentTests.AKeyMatchingTwoDeclaredNames_IsAConflictAsync, DeclaredKeySpellingPassTests.ManyConflicts_AreSampled_AndAnAmbiguousKeyIsNamedAsSuchAsync}

Decide which value is right, keep it under the declared name, remove the other key from that row, and
restart. Any other failure while checking a table (a lock timeout, for example) is logged at Warning, the
other tables still run, and the next start tries that table again.

### The journal entry {#declared-names-journal}

Each table checked is recorded in [`wh_stored_form_migrations`](#journal) under the name
`declared-names:<table>:<hash>`, where the hash covers the table's declared names and required members. It
**settles** on the first pass that changes no row and finds no row missing a required member. A settled table
is skipped with one lookup until its declarations change, which gives it a new name and one new scan.

A pass that **changed rows is not settled**, so the next start scans the table once more. That second pass
catches any row an instance of the previous release wrote in the old spelling while the deployment was rolling,
and then settles. A table this release creates empty settles on its first check (Dapper) or its second start
(EF Core).

{verified: DeclaredNameSpellingIntegrationTests.ASecondStart_ChangesNoRow_AndSettlesTheTableAsync, DapperDeclaredNameSpellingTests.ASecondStart_ChangesNoRowAsync, DeclaredKeyShapesTests.TheJournalName_ChangesWithTheShapeAsync}

### Required members of a read model {#declared-names-required}

{verified: DeclaredNameSpellingIntegrationTests.ARequiredMemberMissingFromAMappedRow_IsReportedAtErrorAsync, DeclaredNameSpellingIntegrationTests.ARequiredMemberMissingFromAnOpaqueRow_FailsTheReadAsync, DapperDeclaredNameSpellingTests.ARequiredMemberMissing_FailsTheRead_AndIsReportedAtStartupAsync, DeclaredKeySpellingPassTests.MissingRequiredMembers_AreReported_WithABoundedSample_AndTheTableStaysOpenAsync}

A perspective model member declared `required` (or `[JsonRequired]`) is enforced on stored read-model rows:

- **Read through the serializer** (every Dapper read, and a document Entity Framework stores as a single
  serialized value), a row missing the member fails its read with a `JsonException` instead of reading the
  member's default.
- **Read by Entity Framework's mapped reader**, a missing key cannot be refused at read time. The startup pass
  reports instead: rows missing a required member are logged at **Error**, naming the table, the member path,
  the row count and a few sample row ids. Startup continues, and the table stays unsettled, so the report
  repeats on every start until the rows are filled.

```text
Stored documents in public.wh_per_picture lack a required member: data $.Title in 12 row(s) (for example
0199a1c4-..., 0199a1c5-..., 0199a1c6-...). A reader that refuses a missing required member fails these rows,
and Entity Framework's mapped reader reads the member's default. Fill them with
[StoredForm(DefaultWhenMissing = ...)] or rebuild the perspective
```

A required member whose type admits null is not enforced, because the framework omits a null when it writes a
document.

**Events are not enforced.** A `required` member of an event type reads as its default when a stored event
lacks it, as before, so old history keeps replaying. A type used both as an event (or inside one) and in a read
model is not enforced either: it is treated as optional on every path.

### Events read either spelling {#declared-names-events}

{verified: DeclaredNameReadTests.AnEventStoredWithCSharpNames_ReadsItsValues_UnderEitherProfileAsync, DeclaredNameReadTests.TheDeclaredSpelling_IsStillWhatIsWrittenAsync, DapperDeclaredNameSpellingTests.AnEventStoredWithCSharpNames_ReplaysWithItsValuesAsync}

Events are history and are never rewritten. Instead, the framework's shared serializer options read property
names **case-insensitively**, so an event stored under its C# name replays with its values. Writing still uses
the declared name.

Because names are matched case-insensitively, a type with two members whose JSON names differ only in case now
fails at first use with System.Text.Json's name-conflict error. Rename one with `[JsonPropertyName]`.

### Upgrading {#declared-names-upgrade}

- **The first start rewrites affected rows.** Deploy without a mixed fleet, or let a second start catch rows an
  older instance wrote meanwhile: a pass that changed rows is not settled, so the next start scans again (see
  [rolling upgrades](../../operations/startup/rolling-upgrades.md#stored-documents-written-mid-deploy)).
- **A row holding both spellings with different values stops startup** until one key is removed from it.
- **A required, non-nullable member missing from a stored read-model document** now fails its read (or, on
  Entity Framework's mapped reader, is reported at Error on every start). Fill old documents with
  `[StoredForm(DefaultWhenMissing = ...)]`, [rebuild](rebuild.md) the perspective, or drop the `required`
  modifier.
- **Two members whose JSON names differ only in case** fail at first use; rename one.
- **A stored key that differs from its declared name by more than case** is not moved; declare it with
  `[StoredForm(PreviousName = ...)]`.

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
- **It runs in the `Order` you state, if you state one.** See [Ordering custom migrations](#custom-order).
- **To block startup**, raise the stored-form SQLSTATE with a message that names what is wrong:
  `RAISE EXCEPTION USING ERRCODE = 'WH980', MESSAGE = '...'`. The constant is
  `StoredFormMigrationTarget.BLOCKED_SQL_STATE`. Any other error is reported as a warning, and the
  migration stays pending for the next start.

`target.Schema` and `target.Table` are the unquoted names. `target.QualifiedTable` is the quoted
`"schema"."table"`.

### Ordering custom migrations {#custom-order}

{verified: StoredFormMigrationGenerationTests.CustomMigrations_RunByTheirOrder_ThenByClassNameAsync, StoredFormMigrationGenerationTests.TwoMigrationsOfOneTableSharingAnOrder_AreWHIZ833_OncePerSharedOrderAsync, StoredFormMigrationGenerationTests.AnOrderThatIsNotAConstant_IsWHIZ831_AndTheMigrationIsNotEmittedAsync}

The custom migrations of one table run after its generated migrations, lowest `Order` first, and
migrations with the same `Order` run in the order of their classes' full names. `Order` is optional:
a migration that does not state one has `Order` 0, so migrations written without it keep running in
class-name order. To place a migration, state it, and leave gaps (10, 20, 30) so a later migration can
go between two earlier ones.

```csharp{title="A custom migration with an explicit order" description="Order places a custom migration among the custom migrations of its table: lower runs first." framework="NET10" category="Perspectives" difficulty="ADVANCED" tags=["perspectives", "stored-forms", "migrations"]}
public sealed class BackfillRegion : IStoredFormMigration<CustomerModel> {
  public string Name => "2026-11-customer-backfill-region";

  // Runs after SplitFullName (no Order, so 0), whatever the class names.
  public int Order => 10;

  public string BuildSql(StoredFormMigrationTarget target) =>
    $"UPDATE {target.QualifiedTable} SET data = data || '{{\"Region\": \"unknown\"}}' WHERE NOT data ? 'Region'";
}
```

- **Two migrations that state the same `Order`** run in the order of their classes' full names. The
  build warns (**WHIZ833**), because that order comes from naming rather than from a decision:
  renaming a class would change it. Two that state none are not reported. Migrations of different
  tables can share an `Order`.
- **The build reads a stated `Order`**, so it must be a compile-time constant: a literal or a `const`,
  returned from an expression body (`=> 10`), from a getter that only returns it, or set by an
  initializer (`{ get; } = 10`). A migration whose `Order` the build cannot read is reported as
  **WHIZ831** and does not run.

An explicit number was chosen over naming the migrations each one depends on. A number is known at
build time, so the build decides the order and checks it. A dependency list names other migrations by
string, so it needs checks for a missing name and for a cycle, and an order between tables means
nothing because tables run in name order anyway.

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
Once a migration has converted the document, the stream recovers **at once**, with no operator step.
A pass that converts anything in a table, and every custom migration of it, brings forward the
retries of the streams parked on an unreadable document in that table: their failed work rows fall
due now instead of at the end of their backoff. The retry reads the converted document, applies the
waiting events and completes the rows. The stream then drops out of the `perspective-stored-forms`
health component.

{verified: StoredFormScalarMismatchWorkerTests.NumberForAStringProperty_RecoversAtOnce_AfterTheStoredFormMigrationConvertsItAsync, StoredFormMigrationTests.AConvertingPass_BringsForwardTheRetriesOfItsParkedStreams_AndNoOtherRowsAsync, StoredFormMigrationTests.ACustomMigration_BringsForwardTheRetriesOfItsParkedStreamsAsync}

The startup log says how many rows it brought forward:

```text
Stored-format rewrite: wh_per_order: stored-form migration wh_per_order.Status:Int32->String: brought forward the retries of 3 parked row(s)
```

Only a parked row is brought forward: one whose failure was an unreadable stored document, for a
perspective that stores into the converted table, with no lease. Its failure count stays, so a stream
the migration did not fix still reaches the dead-letter threshold. A pass that converts nothing brings
nothing forward.

One limit: a row that reached the dead-letter threshold before the migration ran is in the dead-letter
queue. [Replay it](../../operations/dead-letter-queue/perspective-events.md) once the migration has run.

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

## Indexes over the old type {#indexes}

{verified: StoredFormMigrationGenerationTests.ATypeChangeOnAnIndexedKey_ReplacesTheIndexesThatCastIt_BeforeConvertingAsync, StoredFormMigrationTests.AnIndexCastingToTheOldType_IsDroppedBeforeTheConversion_AndRebuiltForTheNewTypeAsync, StoredFormMigrationTests.ReplaceIndex_KeepsAnIndexOverTheNewType_AnIndexUnderAnotherName_AndOneUnderTheNameOverAnotherKeyAsync, StoredFormMigrationTests.Rebuild_ReplacesAnInvalidLeftoverUnderTheName_WithAValidIndexAsync, StoredFormMigrationTests.Rebuild_ThatFails_WarnsAndLeavesNoInvalidIndex_ForTheSchemaPassToBuildAsync}

`[Indexed]` on a document key builds an index whose expression casts the key to its type, for example
`((data ->> 'Quantity')::integer)`, and a [composite index](perspective-indexes.md) over the key does
the same. After a type change, such an index would still cast to the old type: the conversion itself,
and every later write of a value the old type cannot hold, would fail on it. And because the schema
creates an index only when its name is free, the index for the new type would never be built.

So a type change replaces those indexes in the same run:

1. **Before converting**, the migration drops each index over the key that casts it to a type other
   than the new one. A conversion from an enum's number to its name is then not refused by an index
   that casts the key to `integer`.
2. **After the pass commits**, each dropped index is built again for the new type with
   `CREATE INDEX CONCURRENTLY`, so writes to the table go on while it builds:

   ```text
   Stored-format rewrite: wh_per_order: stored-form migration wh_per_order.Quantity:String->Int32: dropped index idx_order_quantity_json, which casts $.Quantity to another type; it is built again for the new type
   Stored-form index rebuild: built idx_order_quantity_json on app.wh_per_order concurrently, for the type its key now holds
   ```

3. **If the concurrent build fails** (a unique index over duplicate values, or an older transaction
   that outlasts the schema command timeout), it is logged as a warning and the invalid index the
   failure leaves is dropped. The schema pass that follows builds the index in its own transaction,
   which blocks writes to the table while it builds.

Only an index the framework built is touched, found the way the schema finds its own: by the name the
schema gave it, **and** by a definition over the key's extraction. An index you created under another
name, an index under that name over anything else, and a constraint's index are never dropped,
whatever they cast to. An index already over the new type is left alone. Replace an index of your own
in a [custom migration](#custom) of the same release.

## A JSON converter is not a migration {#json-converter}

{verified: DeclaredJsonConverterIgnoredTests.ADeclaredConverterIsReportedAsync, DeclaredJsonConverterIgnoredTests.AModelWithNoConverterIsNotReportedAsync, DeclaredJsonConverterIgnoredTests.ItIsAWarningNotAnErrorAsync}

A `[JsonConverter]` on a perspective model property **has no effect on the stored document**. It is
not consulted, it reports nothing, and a value whose stored shape changed stays unreadable.

The reason is the read path. A perspective's document is stored with `ComplexProperty().ToJson()` and
read back by Entity Framework's own JSON materializer, which never consults
`System.Text.Json.Serialization.JsonConverterAttribute`. The serializer that *would* honour the
converter is not in that path at all.

This is worth stating plainly because it has already cost an outage. A consumer whose stored
`Version` had changed from a number to a string declared a converter to keep the pre-upgrade rows
readable, documented the converter as the fix, and shipped it. It had never run. The rows stayed
unreadable, the perspective dead-lettered every event on those streams and dropped into drain mode,
and the failure was invisible because nothing reports a converter that is skipped — the declaration
looks like a fix in the diff and in review.

```csharp{
title: "A declared converter that never runs"
description: "The attribute compiles, reviews well and is silently ignored on the stored-document read path — the shape change stays unconverted."
framework: "NET10"
category: "Perspectives"
difficulty: "INTERMEDIATE"
tags: ["stored-forms", "json-converter", "anti-pattern", "whiz812"]
unverified: "counter-example - this is the shape to avoid, not a working sample"
}
public class JobExportModel {
  // Does nothing. EF's JSON materializer reads this document, and it does not
  // consult JsonConverterAttribute. Rows storing a number stay unreadable.
  [JsonConverter(typeof(NumberOrStringToStringConverter))]
  public string? Version { get; set; }
}
```

Declare the change instead. A changed stored shape is what `[StoredForm]` is for, and it rewrites the
documents in place at startup, journaled — which also repairs the form for anything reading the
column directly, including a mirror or a downstream copy that a converter could never have reached.

```csharp{
title: "The same change, declared"
description: "Rewrites every stored document whose Version is still a number, once, at startup, recorded in the journal."
framework: "NET10"
category: "Perspectives"
difficulty: "INTERMEDIATE"
tags: ["stored-forms", "declaration", "type-change", "startup"]
unverified: "declaration shape - the generated rewrite is covered by the cases above"
}
public class JobExportModel {
  [StoredForm(Previously = typeof(int))]
  public string? Version { get; set; }
}
```

When the ordinary declaration cannot express the conversion — for example when a stored number means
"never set" and the model spells that as `null` rather than as the string `"0"`, so surfacing `"0"`
would invent a value the record never had — use a [custom migration](#custom). It is recorded the
same way.

Declaring a converter on a perspective model is reported at build time as
[WHIZ812](#diagnostics), so this cannot be shipped silently again.

## Diagnostics {#diagnostics}

{verified: StoredFormMigrationGenerationTests.ADeclarationItCannotGenerate_IsWHIZ830_AndEmitsNothingAsync, StoredFormMigrationGenerationTests.ADeclarationInsideACollectionElement_IsWHIZ832_AndAnOrphanMigrationWHIZ831Async, StoredFormMigrationGenerationTests.ADefaultOnASplitPhysicalField_IsWHIZ830Async, StoredFormMigrationGenerationTests.AnOrderThatIsNotAConstant_IsWHIZ831_AndTheMigrationIsNotEmittedAsync, StoredFormMigrationGenerationTests.TwoMigrationsOfOneTableSharingAnOrder_AreWHIZ833_OncePerSharedOrderAsync}

| Id | Severity | Reported when |
|---|---|---|
| WHIZ812 | Warning | A perspective model property declares a `[JsonConverter]`, which the stored-document read path never consults: the document is read by Entity Framework's JSON materializer, not by the serializer. Declare the shape change with `[StoredForm]`, or use a custom migration for a conversion it does not cover. See [A JSON converter is not a migration](#json-converter). |
| WHIZ830 | Error | A declaration the generator cannot turn into SQL: an unsupported type pair, `Previously` equal to the current type, a `[Flags]` enum over `ulong` converted from a string, or a default on a Split physical field. Use a custom migration. |
| WHIZ831 | Warning | An `IStoredFormMigration<TModel>` that would never run: its `TModel` is not the model of any perspective, the generated code cannot create it (no public or internal parameterless constructor, a generic class, or a class it cannot see), or the `Order` it states is not a compile-time constant. |
| WHIZ832 | Warning | A `[StoredForm]` or `[StoredFormRemoved]` inside an element of a collection, which is not generated. Use a custom migration. |
| WHIZ833 | Warning | Two custom migrations of one table explicitly state the same `Order`, so they run in class-name order. Give each its own `Order`. Migrations that state no `Order` are not reported. |

## See also

- [The stored-form rewrite](../../operations/infrastructure/migrations.md#the-stored-form-rewrite):
  the phase these run in.
- [When a row cannot be read](../../operations/infrastructure/migrations.md#when-a-row-cannot-be-read):
  how a stream parks, and how it shows in health and metrics.
- [Enumeration columns](physical-fields.md#enum-columns).
- [Perspective rebuild](rebuild.md).
