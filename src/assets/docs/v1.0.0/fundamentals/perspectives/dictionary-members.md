---
title: Dictionary Members
pageType: concept
verifiedAgainstCommit: d5bc1d709
verifiedDate: 2026-11-20
version: 1.0.0
category: Perspectives
order: 12
description: >-
  A Dictionary, IDictionary or IReadOnlyDictionary on a perspective model, at any depth, is stored as an
  array of key/value objects in the dictionary's order. ContainsKey and the indexer are translated to SQL,
  older object-form rows are rewritten once at startup, and WHIZ810 is retired.
tags: >-
  perspectives, dictionary, jsonb, stored-forms, ef-core, query-translation, containment, migrations,
  whiz810
codeReferences:
  - src/Whizbang.Core/Perspectives/DictionaryMemberForm.cs
  - src/Whizbang.Core/Perspectives/DictionaryMemberForms.cs
  - src/Whizbang.Core/Perspectives/KeyValueArrayJsonConverter.cs
  - src/Whizbang.Core/Perspectives/StoredFormFallbacks.cs
  - src/Whizbang.Generators.Shared/Models/DictionaryMemberDiscovery.cs
  - src/Whizbang.Generators/PerspectiveSchemaGenerator.cs
  - src/Whizbang.Data.EFCore.Postgres/Perspectives/DictionaryMemberTypeMapping.cs
  - src/Whizbang.Data.EFCore.Postgres/Perspectives/DictionaryMemberTypeMappingSourcePlugin.cs
  - src/Whizbang.Data.EFCore.Postgres/Perspectives/DictionaryMemberConvention.cs
  - src/Whizbang.Data.EFCore.Postgres/Perspectives/DictionaryPairsRewrite.cs
  - src/Whizbang.Data.EFCore.Postgres/Functions/DictionaryMemberTranslator.cs
  - src/Whizbang.Data.EFCore.Postgres/Functions/WhizbangDbContextOptionsExtensions.cs
  - src/Whizbang.Data.EFCore.Postgres/QueryTranslation/PhysicalJsonbContainmentRewriter.cs
  - src/Whizbang.Data.EFCore.Postgres/BaseUpsertStrategy.cs
  - src/Whizbang.Data.EFCore.Postgres.Generators/Templates/EFCoreConfigurationTemplate.cs
  - src/Whizbang.Data.EFCore.Postgres.Generators/Templates/DbContextSchemaExtensionTemplate.cs
  - src/Whizbang.Data.Postgres/Migrations/544_DictionaryMembersStoredAsPairs.sql
testReferences:
  - tests/Whizbang.Core.Unit.Perspectives.Tests/Perspectives/DictionaryMemberFormTests.cs
  - tests/Whizbang.Generators.Tests/DictionaryMemberDiscoveryTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/Perspectives/DictionaryMemberStorageTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/Perspectives/DictionaryMemberTypeMappingTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/Perspectives/DictionaryMemberConventionTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/Perspectives/DictionaryPairsRewriteTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/Perspectives/DictionaryPairsRewriteIntegrationTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/QueryTranslation/PhysicalJsonbContainmentSqlTests.cs
  - tests/Whizbang.Generators.Tests/DiagnosticDescriptorsTests.cs
lastMaintainedCommit: 'd5bc1d709'
---

# Dictionary Members

A perspective model can hold a plain dictionary. Declare it the way you would anywhere else; there is no
attribute to add, no wrapper type and nothing to configure:

```csharp{title="Dictionaries on a perspective model" description="Scalar and complex values, a dictionary inside a nested object, inside each element of a list, and through the read-only interface. None of them is named in any configuration." framework="NET10" category="Perspectives" difficulty="BEGINNER" tags=["perspectives", "dictionary", "jsonb"] tests=["DictionaryMemberStorageTests.ADictionaryIsStoredAsAnArrayOfKeyValueObjectsAsync", "DictionaryMemberStorageTests.WhatEntityFrameworkWrote_ReadsBackAsync"]}
public class Section {
  public string Title { get; set; } = string.Empty;
  public Dictionary<string, decimal> Totals { get; set; } = [];
}

public class OrderModel {
  [StreamId]
  public Guid Id { get; set; }

  public Dictionary<string, int> Counts { get; set; } = [];
  public Dictionary<Guid, OrderLine>? Lines { get; set; }
  public Section Section { get; set; } = new();
  public List<Section> Sections { get; set; } = [];
  public IReadOnlyDictionary<string, string> Notes { get; set; } = new Dictionary<string, string>();
}
```

Before this, Entity Framework's JSON mapping refused such a model: it takes a dictionary for a
navigation, and the model build fails. [WHIZ810](../../operations/diagnostics/whiz810.md) warned about it and
asked for a list of key/value objects instead. WHIZ810 is now retired.

## The stored form

Every dictionary in a perspective document is stored as an **array of key/value objects, in the
dictionary's order**:

```json{title="How the model above is stored" description="Each dictionary is an array of objects with a Key and a Value, in the order the dictionary enumerates. A complex value is stored as that type's own document." category="Perspectives" difficulty="BEGINNER" tags=["perspectives", "dictionary", "jsonb", "stored-form"] tests=["DictionaryMemberStorageTests.ADictionaryIsStoredAsAnArrayOfKeyValueObjectsAsync"]}
{
  "Counts": [{"Key": "zulu", "Value": 26}, {"Key": "alpha", "Value": 1}, {"Key": "mike", "Value": 13}],
  "Lines": [{"Key": "0190f0a0-0000-7000-8000-000000000001", "Value": {"Name": "widget", "Quantity": 3}}],
  "Section": {"Title": "top", "Totals": [{"Key": "net", "Value": 12.5}, {"Key": "gross", "Value": 15}]},
  "Sections": [{"Title": "first", "Totals": [{"Key": "tax", "Value": 2.25}]}]
}
```

{verified: DictionaryMemberStorageTests.ADictionaryIsStoredAsAnArrayOfKeyValueObjectsAsync, DictionaryMemberStorageTests.WhatEntityFrameworkWrote_ReadsBackAsync, DictionaryMemberFormTests.EveryDeclaredShape_IsWrittenAsAnArrayOfPairsInItsOrderAsync, DictionaryMemberFormTests.WhatIsWritten_ReadsBackInOrderAsync}

An array rather than an object, for two reasons. Entity Framework's JSON mapping has no way to map a
dictionary as an object, and a jsonb object sorts its keys, so a dictionary read back from one would
come back in a different order than it was written. An array keeps the order.

- **One form, both writers.** A document is written by Entity Framework's mapping and by the serializer
  the atomic upsert writes with. Both write exactly the same document, and either reads what the other
  wrote.
- **Keys and values are stored as they are anywhere else in the document.** A `Guid` key is its string, an
  enumeration key is what its type writes, and a date in a value is the
  [canonical number](jsonb-containment.md#dates-times-and-durations).
- **Null and empty stay different.** A null dictionary is absent from the document; an empty one is `[]`.
- **A key stored twice is refused** when the row is read, rather than read as either value.
- **Event payloads are unchanged.** The form applies to perspective documents only. A dictionary in a
  message or an event is still written as a JSON object on the wire.

{verified: DictionaryMemberStorageTests.TheSerializerAndEntityFramework_WriteTheSameDocumentAsync, DictionaryMemberFormTests.AValue_IsWrittenAsTheDocumentWritesItAnywhereElseAsync, DictionaryMemberStorageTests.NullAndEmpty_StayDifferentAsync, DictionaryMemberStorageTests.ADuplicateKey_IsRefusedAsync, DictionaryMemberFormTests.TheDefaultProfile_KeepsADictionaryAnObjectAsync}

## Supported shapes

`Dictionary<TKey, TValue>`, `IDictionary<TKey, TValue>` and `IReadOnlyDictionary<TKey, TValue>` are
stored this way wherever they sit in a perspective model:

| Where | Example |
|---|---|
| A member of the model | `Counts` above |
| A member of a nested object | `Section.Totals` |
| A member of a collection element | `Sections[i].Totals` |
| A dictionary's own value | `Dictionary<string, Dictionary<string, int>>` |
| A promoted jsonb column | `[PhysicalField] Dictionary<string, string[]>`, see [jsonb columns](physical-fields.md#jsonb-columns) |

The perspective schema generator finds every closed dictionary type a model holds, at any depth, and
registers it once when the assembly loads. Nothing is generated per property beyond that registration.

{verified: DictionaryMemberDiscoveryTests.EveryStoredDictionary_AtAnyDepth_IsFoundOnceAsync, DictionaryMemberDiscoveryTests.TheDeclaredShapes_AreTheDictionariesAsync, DictionaryMemberDiscoveryTests.TheSchemaGenerator_RegistersEachFormOnce_AndTheRegistrationCompilesAsync, DictionaryMemberFormTests.EachDeclaredShape_ResolvesToThePairsAsync, DictionaryPairsRewriteIntegrationTests.ADictionaryInsideACollectionAndInsideADictionary_IsRewrittenAsync}

## Querying a dictionary

Two lookups are translated to SQL. Both are answered by the database; neither reads rows back to filter
them:

```csharp{title="Key lookups that run in the database" description="ContainsKey at any fixed path, inside a collection element, and an indexer compared with a value." framework="NET10" category="Perspectives" difficulty="INTERMEDIATE" tags=["perspectives", "dictionary", "query-translation", "jsonb"] tests=["DictionaryMemberStorageTests.AKeyLookup_IsTranslatedToSqlAsync", "DictionaryMemberStorageTests.TheKeyLookupIsInThePlanAsync"]}
var rows = lens.DefaultScope.Query;

await rows.Where(r => r.Data.Counts.ContainsKey("mike")).ToListAsync();
await rows.Where(r => r.Data.Counts["mike"] == 13).ToListAsync();
await rows.Where(r => r.Data.Section.Totals.ContainsKey("net")).ToListAsync();
await rows.Where(r => r.Data.Sections.Any(s => s.Totals.ContainsKey("tax"))).ToListAsync();
await rows.Where(r => r.Data.Notes["a"] == "ay").ToListAsync();
```

| LINQ | Compiles to | Notes |
|---|---|---|
| `d.ContainsKey(k)` at a fixed path | `data @> {"Counts": [{"Key": k}]}` | A containment test on the document column, which its GIN index can answer |
| `d.ContainsKey(k)` inside a collection element | `member @> [{"Key": k}]` | Asked of the element's own member |
| `d[k]`, a scalar value | `jsonb_path_query_first(member, '$[*] ? (@.Key == $k)', ...) ->> 'Value'`, cast to the value's type | A missing key is SQL NULL, so a comparison with it is false and the row is excluded, where `d[k]` in memory would throw |

The key is sent as the JSON the stored form writes for it, so a key of any type compares as it is
stored.

{verified: DictionaryMemberStorageTests.AKeyLookup_IsTranslatedToSqlAsync, DictionaryMemberStorageTests.TheKeyLookupIsInThePlanAsync, DictionaryMemberTypeMappingTests.TheTranslator_LeavesEverythingButAKeyLookupOnADictionaryAsync}

### What is refused

Anything else on a dictionary is **refused by Entity Framework when the query is compiled**, naming the
expression. It is never evaluated on the client, so a query cannot silently read a whole table to filter it:

- an indexer whose value is a date, time or duration, or a structured type (`d[k].Quantity == 1`) or a
  collection (`d[k].Count == 1`);
- a key that is not a constant or a captured variable, such as another column (`d.ContainsKey(r.Data.Label)`);
- every other dictionary member: `TryGetValue`, `Count`, `ContainsValue`, `Keys`, `Values` and so on.

{verified: DictionaryMemberTypeMappingTests.ALookupTheTranslatorCannotAnswer_IsRefused_NeverEvaluatedOnTheClientAsync}

A filter that needs one of these can usually be restated with `ContainsKey` and an indexer over a scalar,
or the value it needs can be promoted to a column of its own with `[PhysicalField]`.

## What each context needs {#setup}

Two pieces carry the mapping, and the context you query through needs them:

- **The type mapping and the translator** ride the Whizbang options extension,
  `npgsqlOptions.UseWhizbangFunctions()`. The generated turnkey registration adds it to every context it
  builds, so a context registered by Whizbang needs nothing. A context you build yourself adds it to its
  Npgsql options:

```csharp{title="A hand-built context that queries dictionaries" description="UseWhizbangFunctions adds the dictionary type mapping and the key-lookup translator to a context Whizbang did not register." framework="NET10" category="Perspectives" difficulty="INTERMEDIATE" tags=["perspectives", "dictionary", "ef-core", "configuration"] tests=["DictionaryMemberStorageTests.AKeyLookup_IsTranslatedToSqlAsync", "DictionaryMemberTypeMappingTests.TheTypeMappingSourcePlugin_AnswersOnlyForARegisteredFormAsync"]}
var options = new DbContextOptionsBuilder<OrderReadContext>()
    .UseNpgsql(connectionString, npgsql => npgsql.UseWhizbangFunctions())
    .Options;
```

- **The member mapping without the extension.** A context built from a plain connection string, as a
  hand-built lens context often is, has no extension, and one dictionary anywhere in an assembly's
  perspectives would then fail every such context's model. The generated `ConfigureWhizbang(modelBuilder)`
  maps each registered dictionary member explicitly with the same mapping, so that context's model builds,
  stores and reads dictionaries the same way. A member already mapped, or one the configuration ignored (a
  promoted jsonb field is), is left as it is. Without `UseWhizbangFunctions()` such a context has no
  translator, so a key lookup in a query is refused as above.

{verified: DictionaryMemberConventionTests.WithoutTheOptionsExtension_EveryDictionaryIsAValueWithItsStoredFormAsync, DictionaryMemberConventionTests.AMemberTheConfigurationIgnored_StaysIgnoredAsync, DictionaryMemberConventionTests.AMemberAlreadyMapped_IsLeftAsItWasAsync, DictionaryMemberConventionTests.TheMemberRegistry_RecordsEachMemberOnceAsync}

A context whose mapping you write entirely by hand, calling neither, still refuses the model in Entity
Framework's own words, naming the member.

## Promoted dictionary columns {#promoted-columns}

A dictionary promoted to its own column with `[PhysicalField]` is a jsonb column holding the same array
of pairs, written in that form by every writer of the column. A filter on it compiles to containment of
one pair, `col @> [{"Key": k, "Value": v}]`, which the column's own GIN index answers. See
[filtering on a jsonb column](physical-fields.md#jsonb-filters).

{verified: DictionaryMemberConventionTests.APromotedDictionaryColumn_IsWrittenInItsMappingsStoredFormAsync, PhysicalJsonbContainmentSqlTests.DictionaryKeyEquals_ScalarValue_CompilesToContainmentOfTheKeyAsync, PhysicalJsonbContainmentSqlTests.DictionaryKeyContains_Param_CompilesToContainmentOfAKeyedArrayAsync}

## Rows written by an earlier release {#stored-form-rewrite}

A row written before this release holds each dictionary as a JSON object, in an opaque document or a
promoted jsonb column. Two things cover it.

**Reads accept the object form.** A row the rewrite has not reached yet still reads, and each such read
is counted on `whizbang.perspective.dictionary_form_fallbacks`, tagged by the dictionary `type`, and
announced once per type at Warning. A query does not accept it, though: a key lookup is a containment
test over the pairs, and it does not match an object. So the object form is rewritten.

{verified: DictionaryMemberStorageTests.AnObjectFormDictionary_StillReadsAsync, DictionaryMemberFormTests.TheObjectFormAnEarlierReleaseWrote_StillReadsAsync, DictionaryMemberFormTests.AnObjectFormReadIsCountedAndAnnouncedAsync}

**The stored-form phase rewrites it once per table.** On startup, in the
[stored-form rewrite](../../operations/infrastructure/migrations.md#the-stored-form-rewrite), after the
application's own [stored-form migrations](stored-form-migrations.md) and before the temporal rewrite (so a
date held in a dictionary's value is at the path the temporal rewrite reads), every perspective table
that stores a dictionary is converted with one statement:

- **The paths come from the readers**, as the temporal rewrite's do: Entity Framework's model for a
  mapped document, the serializer's metadata for an opaque document or a promoted column, and a
  dictionary's own value type below it, through nested objects, collection elements and dictionaries
  inside dictionaries.
- **Each key is rebuilt as its type stores it.** The database cannot know a key's type, so the statement
  says it: a string, a `Guid` or a `char` is the property name as it is; a number is the name read as a
  number; an enumeration is looked up in a map of its names. A name the key's kind cannot read (`"seven"`
  under an `int` key) leaves that whole dictionary as it was, for the reader.
- **It is journaled** in `wh_stored_form_migrations` with kind `dictionary-pairs`, under the name
  `dictionary-pairs:<table>:<hash>`. The hash covers the table's dictionary paths, so a model that gains a
  dictionary is scanned again. It settles on the first pass that converts nothing; a table this release
  has not created yet settles at once, since this release creates it in the new form. See
  [the journal](stored-form-migrations.md#journal).
- **Migration 544** (`544_DictionaryMembersStoredAsPairs.sql`) adds the two functions the statement calls,
  `_wh_dictionary_pairs` and `wh_dictionary_pairs_at`, in the bootstrap region, because the stored-form
  phase runs ahead of the migration pass. Reversing it drops the functions; rows already converted stay
  converted, and every reader reads them.

{verified: DictionaryPairsRewriteIntegrationTests.AnObjectFormDictionary_IsRewrittenToPairs_AndTheTableSettlesAsync, DictionaryPairsRewriteIntegrationTests.EachKeyKind_IsStoredAsItsTypeWritesItAsync, DictionaryPairsRewriteIntegrationTests.ADictionaryInsideACollectionAndInsideADictionary_IsRewrittenAsync, DictionaryPairsRewriteIntegrationTests.ANameANumericKeyCannotRead_LeavesTheDictionaryForTheReaderAsync, DictionaryPairsRewriteIntegrationTests.ATableNotCreatedYet_IsSettledAtOnceAsync, DictionaryPairsRewriteTests.AStoredAsOneValueDocumentAndAPromotedColumn_AreWalkedThroughTheSerializerAsync, DictionaryPairsRewriteTests.TheJournalName_ChangesWithThePathsAsync, DictionaryPairsRewriteTests.EachKeyType_HasTheKindTheDatabaseRebuildsItWithAsync}

The startup log carries one line per table, as the other rewrites do:

```text
Stored-format rewrite: wh_per_order: dictionaries: converted, 1250 row update(s)
Stored-format rewrite: wh_per_order: dictionaries: settled, skipped
```

`whizbang.perspective.dictionary_form_fallbacks` reading zero after the rewrite has run says no object-form
row is left. A count that keeps rising points at a row the rewrite cannot convert (a key it leaves for the
reader, below) or at an instance of an earlier release still writing during a rolling deploy; the next
start's pass catches the latter.

## Not supported {#not-supported}

- **Other dictionary types.** `SortedDictionary`, `ImmutableDictionary`, `ConcurrentDictionary` and custom
  dictionary types are not registered, so Entity Framework still refuses them in a mapped document. Declare
  the member as `Dictionary`, `IDictionary` or `IReadOnlyDictionary`.
- **Date and structured keys are not rewritten.** A dictionary keyed by a date or a structure that an
  earlier release stored as an object is left as an object. It still reads (and counts on the fallback
  metric), but a key lookup does not match it until the row is written again or the perspective is
  [rebuilt](rebuild.md).
- **The lookups listed under [what is refused](#what-is-refused)**: `TryGetValue`, `Count`, `ContainsValue`
  and the others are not translated.
- **The Dapper driver** writes a document with the serializer options the application gives it, and has no
  rewrite of object-form rows.

{verified: DictionaryMemberFormTests.TheRegistryAnswersEachDeclaredShapeOnceAsync, DictionaryMemberFormTests.TheFactory_AnswersNothingForAnUnregisteredTypeAsync, DictionaryPairsRewriteTests.TheStatement_SkipsAKeyTheDatabaseCannotRebuild_AndRecordsItsJournalAsync}

## Upgrading {#upgrading}

This is a breaking change to the stored form. A dictionary stored in an opaque document, or promoted to a
jsonb column with `[PhysicalField]`, changes from a JSON object to an array of pairs on the first start.

- **SQL you own over these documents must read the pairs.** A query, a view, a report or an index that
  reads a dictionary with an object path no longer finds the key. An expression index over an object path
  into a dictionary indexes nothing useful after the rewrite; drop it and filter with containment, which the
  document's or the column's GIN index answers:

```sql{title="Reading a dictionary key in your own SQL" description="An object path into a dictionary finds nothing once the dictionary is stored as pairs; containment over the pairs finds it, and a GIN index on the column answers it." category="Perspectives" difficulty="INTERMEDIATE" tags=["perspectives", "dictionary", "jsonb", "upgrade"] tests=["DictionaryMemberStorageTests.ADictionaryIsStoredAsAnArrayOfKeyValueObjectsAsync"]}
-- Before: the dictionary was an object
SELECT id FROM wh_per_order WHERE data -> 'Tags' ->> 'priority' = 'high';

-- Now: an array of {"Key": .., "Value": ..}
SELECT id FROM wh_per_order WHERE data -> 'Tags' @> '[{"Key": "priority", "Value": "high"}]';

-- The value of one key
SELECT jsonb_path_query_first(data -> 'Tags', '$[*] ? (@.Key == "priority")') ->> 'Value'
  FROM wh_per_order;
```

- **A model rewritten to satisfy WHIZ810 can go back to a plain dictionary.** If you replaced a dictionary
  with a list of key/value objects, or split it out with `[PerspectiveStorage(FieldStorageMode.Split)]` and
  `[PhysicalField]` only to get past the warning, you can declare the dictionary again. That is a model
  change of its own, made like any other: if the member's stored name changes, declare it with
  [`[StoredForm(PreviousName = ...)]`](stored-form-migrations.md#declaring).
- **A suppression of WHIZ810 can be removed.** Delete any `#pragma warning disable WHIZ810`, any
  `dotnet_diagnostic.WHIZ810.severity` entry and WHIZ810 in a `<NoWarn>` list.
- **Watch `whizbang.perspective.dictionary_form_fallbacks`** after the upgrade; it should read zero once the
  rewrite has run. See the [metrics catalog](../../operations/observability/metrics.md#stored-form-fallbacks).

## Related

- [WHIZ810: Perspective Model Contained a Dictionary Property (retired)](../../operations/diagnostics/whiz810.md)
- [Physical Fields: jsonb columns](physical-fields.md#jsonb-columns)
- [JSONB Containment Queries](jsonb-containment.md)
- [Stored-Form Migrations](stored-form-migrations.md)
- [Migrations: the stored-form rewrite](../../operations/infrastructure/migrations.md#the-stored-form-rewrite)
