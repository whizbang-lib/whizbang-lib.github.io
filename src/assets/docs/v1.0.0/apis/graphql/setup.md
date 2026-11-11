---
title: GraphQL Setup
pageType: guide
verifiedAgainstCommit: 1b31f58d
verifiedDate: 2026-07-16
version: 1.0.0
category: GraphQL
order: 2
description: >-
  Installation and configuration guide for Whizbang's HotChocolate GraphQL
  integration. Covers package installation, minimal setup, scope middleware
  configuration, and advanced GraphQL options.
tags: 'graphql, setup, installation, configuration, hotchocolate, asp-net'
codeReferences:
  - src/Whizbang.Transports.HotChocolate/Extensions/HotChocolateWhizbangExtensions.cs
  - src/Whizbang.Transports.HotChocolate/Configuration/WhizbangGraphQLOptions.cs
  - src/Whizbang.Transports.HotChocolate/Middleware/ScopeMiddlewareExtensions.cs
  - src/Whizbang.Transports.HotChocolate/Middleware/WhizbangScopeMiddleware.cs
  - src/Whizbang.Transports.HotChocolate/Extensions/HotChocolateWhizbangIdExtensions.cs
  - src/Whizbang.Transports.HotChocolate/Types/WhizbangIdType.cs
  - src/Whizbang.Transports.HotChocolate/Types/WhizbangIdTypeDiscoveryHandler.cs
testReferences:
  - tests/Whizbang.Transports.HotChocolate.Tests/Unit/ServiceRegistrationTests.cs
  - tests/Whizbang.Transports.HotChocolate.Tests/Unit/WhizbangGraphQLOptionsTests.cs
  - tests/Whizbang.Transports.HotChocolate.Component.Tests/Unit/ScopeMiddlewareExtensionsTests.cs
  - tests/Whizbang.Transports.HotChocolate.Tests/Unit/WhizbangScopeMiddlewareTests.cs
  - tests/Whizbang.Transports.HotChocolate.Ids.Tests/Unit/WhizbangIdGraphQLTests.cs
  - tests/Whizbang.Transports.HotChocolate.Ids.Tests/Unit/WhizbangIdTypeTests.cs
  - tests/Whizbang.Transports.HotChocolate.Ids.Tests/Unit/WhizbangIdSchemaRegistrationTests.cs
  - tests/Whizbang.Transports.HotChocolate.Ids.Tests/Unit/WhizbangIdSchemaTimingTests.cs
  - tests/Whizbang.Transports.HotChocolate.Ids.Tests/Unit/WhizbangIdFilteringTests.cs
lastMaintainedCommit: '01f07906'
---

# GraphQL Setup

This guide covers installation and configuration of Whizbang's HotChocolate GraphQL integration.

## Installation

```bash{title="Installation" description="Installation" category="API" difficulty="BEGINNER" tags=["Apis", "Graphql", "Installation"]}
dotnet add package SoftwareExtravaganza.Whizbang.Transports.HotChocolate
dotnet add package HotChocolate.AspNetCore
```

The integration needs only HotChocolate's execution engine. To serve GraphQL over HTTP (`AddGraphQLServer`,
`MapGraphQL`), the application references `HotChocolate.AspNetCore` itself. The Whizbang package doesn't bring it,
because that package also includes the Nitro IDE, which is under the ChilliCream License rather than an open-source
one.

## Basic Configuration

### Minimal Setup

```csharp{title="Minimal Setup" description="Minimal Setup" category="API" difficulty="BEGINNER" tags=["Apis", "Graphql", "Minimal", "Setup"] unverified="HotChocolate schema/DI wiring — Whizbang registration verified by ServiceRegistrationTests"}
// Program.cs
var builder = WebApplication.CreateBuilder(args);

builder.Services
    .AddGraphQLServer()
    .AddWhizbangLenses()
    .AddQueryType<Query>();

var app = builder.Build();
app.MapGraphQL();
app.Run();
```

### With Scope Middleware

For multi-tenancy and security filtering:

```csharp{title="With Scope Middleware" description="For multi-tenancy and security filtering:" category="API" difficulty="INTERMEDIATE" tags=["Apis", "Graphql", "Scope", "Middleware"] tests=["ScopeMiddlewareExtensionsTests.AddWhizbangScope_ShouldRegisterIScopeContextAccessorAsync", "ScopeMiddlewareExtensionsTests.UseWhizbangScope_ShouldReturnApplicationBuilderForChainingAsync"]}
var builder = WebApplication.CreateBuilder(args);

// Add services
builder.Services.AddWhizbangScope();
builder.Services
    .AddGraphQLServer()
    .AddWhizbangLenses()
    .AddQueryType<Query>();

var app = builder.Build();

// Middleware order matters
app.UseAuthentication();
app.UseWhizbangScope();  // After auth, before GraphQL
app.MapGraphQL();

app.Run();
```

## Configuration Options

### WhizbangGraphQLOptions

Configure default behavior for all lenses:

```csharp{title="WhizbangGraphQLOptions" description="Configure default behavior for all lenses:" category="API" difficulty="BEGINNER" tags=["Apis", "Graphql", "WhizbangGraphQLOptions"] tests=["ServiceRegistrationTests.AddWhizbangLenses_WithOptions_ShouldApplyConfigurationAsync", "WhizbangGraphQLOptionsTests.DefaultScope_ShouldAcceptComposedFlagsAsync", "WhizbangGraphQLOptionsTests.MaxPageSize_ShouldBeSettableAsync"]}
builder.Services
    .AddGraphQLServer()
    .AddWhizbangLenses(options => {
        options.DefaultScope = GraphQLLensScopes.Data | GraphQLLensScopes.SystemFields;
        options.DefaultPageSize = 25;
        options.MaxPageSize = 200;
    });
```

| Option | Default | Description |
|--------|---------|-------------|
| `DefaultScope` | `GraphQLLensScopes.DataOnly` | Fields exposed when a lens does not set an explicit scope |
| `DefaultPageSize` | `10` | Default page size for paging |
| `MaxPageSize` | `100` | Maximum allowed page size |
| `IncludeMetadataInFilters` | `true` | Include metadata fields in filter/sort types (when scope includes `Metadata`) |
| `IncludeScopeInFilters` | `true` | Include scope fields in filter/sort types (when scope includes `Scope`) |

### WhizbangScopeOptions

Configure scope extraction from HTTP context:

```csharp{title="WhizbangScopeOptions" description="Configure scope extraction from HTTP context:" category="API" difficulty="INTERMEDIATE" tags=["Apis", "Graphql", "WhizbangScopeOptions"] tests=["ScopeMiddlewareExtensionsTests.AddWhizbangScope_WithConfigure_ShouldRegisterOptionsAsync", "ScopeMiddlewareExtensionsTests.AddWhizbangScope_WithConfigure_ShouldRegisterIScopeContextAccessorAsync"]}
builder.Services.AddWhizbangScope(options => {
    // Claim types
    options.TenantIdClaimType = "tenant_id";
    options.UserIdClaimType = ClaimTypes.NameIdentifier;
    options.OrganizationIdClaimType = "org_id";
    options.CustomerIdClaimType = "customer_id";

    // Custom extensions
    options.ExtensionClaimMappings["region"] = "Region";
});
```

| Option | Default | Description |
|--------|---------|-------------|
| `TenantIdClaimTypes` | `["tenant_id"]` | JWT claim types for tenant ID, tried in order |
| `TenantIdHeaderName`, `UserIdHeaderName`, `OrganizationIdHeaderName`, `CustomerIdHeaderName` | `null` (no header read) | Opt-in request header used when the token lacks the claim. Safe only behind a trusted gateway that sets it; see [Trusted gateway headers](scoping#trusted-gateway-headers) |
| `UserIdClaimTypes` | Azure AD `objectidentifier`, `objectid`, `oid`, `sub`, `ClaimTypes.NameIdentifier` | JWT claim types for user ID, tried in order |
| `RolesClaimType` | `ClaimTypes.Role` | JWT claim for roles |
| `GroupsClaimTypes` | `["groups"]` | JWT claim types for group memberships |
| `PermissionsClaimTypes` | `["permissions"]` | JWT claim types for permissions |
| `CorrelationIdHeaderName` | `"X-Correlation-ID"` | Header whose Guid value is adopted as the inbound correlation ID |
| `ExtensionClaimMappings`, `ExtensionHeaderMappings` | empty | Claim type (or opted-in header) to scope extension key; extensions travel with the scope on every message the request dispatches |
| `PropagatedClaimTypes` | empty | Claim types whose values cross a hop on the messages the request dispatches; never list a token or personal data. See [Hop Scope](../../fundamentals/security/message-security#hop-scope-claims) |

Each `*ClaimType` (singular) property still exists as a backwards-compatible shim: getting it reads the first entry of the corresponding `*ClaimTypes` list, and setting it replaces the list with a single value. Multi-valued claims (permissions, groups) honor a `ClaimAggregation` strategy (`PermissionsAggregation`/`GroupsAggregation`, default `FirstMatch`).

## Query Type Setup

Define your query type with lens resolvers:

```csharp{title="Query Type Setup" description="Define your query type with lens resolvers:" category="API" difficulty="INTERMEDIATE" tags=["Apis", "Graphql", "Query", "Type"]}
public class Query {
    [UsePaging(DefaultPageSize = 10, MaxPageSize = 100, IncludeTotalCount = true)]
    [UseProjection]
    [UseFiltering]
    [UseSorting]
    public IQueryable<PerspectiveRow<OrderReadModel>> GetOrders(
        [Service] IOrderLens lens) {
        return lens.Query;
    }

    [UsePaging]
    [UseFiltering]
    [UseSorting]
    public IQueryable<PerspectiveRow<ProductReadModel>> GetProducts(
        [Service] IProductLens lens) {
        return lens.Query;
    }
}
```

:::updated
`ILensQuery<TModel>.Query` is the legacy accessor and is marked `[Obsolete]` at this commit in favor of the fluent scope API (`lens.DefaultScope.Query` or `lens.Scope(QueryScope.X).Query`). It still works — the generated lens resolvers currently use `lens.Query` directly — but expect an obsolete-usage warning in hand-written resolvers.
:::

## Service Registration

Register your lens implementations:

```csharp{title="Service Registration" description="Register your lens implementations:" category="API" difficulty="BEGINNER" tags=["Apis", "Graphql", "Service", "Registration"] unverified="HotChocolate schema/DI wiring — Whizbang registration verified by ServiceRegistrationTests"}
// If using EF Core
builder.Services.AddScoped<IOrderLens, EFCoreOrderLens>();
builder.Services.AddScoped<IProductLens, EFCoreProductLens>();

// Register the generated lens query fields (extension on the GraphQL builder,
// generated by the source generator - call after AddWhizbangLenses())
builder.Services
    .AddGraphQLServer()
    .AddWhizbangLenses()
    .AddWhizbangLensQueries();
```

## Strong IDs {#strong-ids}

A resolver can take a [`[WhizbangId]`](../../fundamentals/identity/whizbang-ids) type as an argument or an input
field, and return one. `AddWhizbangLenses()` turns this on; an executor without lenses calls `AddWhizbangIds()`:

```csharp{title="Strong IDs" description="Strong ids as GraphQL arguments, input fields and results" category="API" difficulty="INTERMEDIATE" tags=["Apis", "Graphql", "WhizbangId", "Scalars"] tests=["WhizbangIdGraphQLTests.Schema_ShowsEachIdAsANamedUuidScalarAsync", "WhizbangIdGraphQLTests.Argument_WithAUuidV7_ReachesTheResolverAsTheIdAsync", "WhizbangIdGraphQLTests.InputField_WithAUuidV7_ReachesTheResolverAsTheIdAsync", "WhizbangIdGraphQLTests.Result_OfAnIdType_IsWrittenAsAUuidStringAsync"]}
[WhizbangId]
public readonly partial struct OrderId;

public class Query {
  public string GetOrder(OrderId id) => id.Value.ToString();
  public OrderId EchoOrder(OrderId id) => id;
}

builder.Services
    .AddGraphQLServer()
    .AddWhizbangLenses()    // adds the id scalars; .AddWhizbangIds() does the same without lenses
    .AddQueryType<Query>();
```

Each id type becomes its own scalar, named after the type and written as a UUID string:

```graphql{title="Strong ID in the schema" description="The scalar a schema gets for OrderId"}
type Query {
  order(id: OrderId!): String!
  echoOrder(id: OrderId!): OrderId!
}

"A OrderId, written as a UUID string."
scalar OrderId @specifiedBy(url: "https://www.rfc-editor.org/rfc/rfc9562")
```

Input goes through the id's own `From(Guid)`, so a literal, a variable and an input field are all checked the same
way. A value that is not a UUID, or a Guid the id refuses (not UUIDv7, or `Guid.Empty`), fails as a GraphQL error
with the code `WHIZBANG_INVALID_ID` and the reason, and the resolver does not run:

```json{title="Invalid strong ID" description="The response to order(id: ...) with a UUIDv4" category="API" difficulty="INTERMEDIATE" tags=["Apis", "Graphql", "WhizbangId", "Errors"] tests=["WhizbangIdGraphQLTests.Argument_WithANonV7Guid_IsAGraphQLErrorAsync", "WhizbangIdGraphQLTests.InputField_WithANonV7Guid_IsAGraphQLErrorAsync", "WhizbangIdGraphQLTests.Argument_ThatIsNotAUuid_IsAGraphQLErrorAsync"]}
{
  "errors": [
    {
      "message": "The value is not a valid OrderId: OrderId requires UUIDv7 but received version 4",
      "locations": [{ "line": 1, "column": 9 }],
      "path": ["id"],
      "extensions": {
        "code": "WHIZBANG_INVALID_ID",
        "fieldCoordinate": "Query.order(id:)",
        "fieldType": "OrderId",
        "responseName": "order"
      }
    }
  ],
  "data": null
}
```

An id declared with `[WhizbangId(AcceptAnyVersion = true)]` takes any non-empty Guid here too, because the scalar
applies the id's own rule {verified: WhizbangIdGraphQLTests.AnyVersionId_WithANonV7Guid_ReachesTheResolverAsync, WhizbangIdGraphQLTests.AnyVersionId_WithTheEmptyGuid_IsAGraphQLErrorAsync}.

Notes:

- **On by default.** `AddWhizbangLenses()` adds the id scalars {verified: WhizbangIdSchemaRegistrationTests.AddWhizbangLenses_AddsTheIdScalarsAsync}.
  `AddWhizbangIds()` adds them to an executor without lenses. Calling either more than once, or both, adds each
  scalar once {verified: WhizbangIdSchemaRegistrationTests.AddWhizbangIds_WithAddWhizbangLensesAndTwice_AddsEachScalarOnceAsync}.
- **Only the ids the schema uses.** A scalar is added when a field, argument or input field refers to the id. The
  framework's own ids (`StreamId`, `EventId`, `MessageId`, `CorrelationId`) appear only in a schema that uses them,
  and an id of your own with one of those names gets its own scalar {verified: WhizbangIdSchemaRegistrationTests.ConsumerIdsNamedLikeFrameworkIds_GetTheConsumersScalarsAndNoFrameworkScalarAsync}.
- **No warm-up needed.** Each id's conversion comes from the registration its assembly's generated code makes,
  without reflection. The schema runs that registration itself when it first refers to the id, so nothing in the
  id's assembly has to run before the schema is built {verified: WhizbangIdSchemaTimingTests.Id_FromAnAssemblyNothingHasUsed_GetsItsScalarWhenTheSchemaIsBuiltAsync}.
- **Why a named scalar, not `UUID`.** HotChocolate reports a failed type conversion as a generic "unable to convert"
  or "Unexpected Execution Error", without the reason. A scalar can reject the value during input coercion and say
  why. The schema also shows which id each argument takes. On the wire it is the same UUID string, so a client maps
  these scalars the way it maps `UUID`.
- **Scalar names are the type's short name.** A schema that uses two id types with the same name in different
  namespaces (one of yours and one of the framework's, say) fails to build with HotChocolate's duplicate-type error.

### Upgrading {#strong-ids-upgrade}

Before this release a strong id in a schema was an object type, and an input type with a `value` field. It is now
the id's scalar, which changes the schema clients see:

| Before | After |
|--------|-------|
| `type OrderId { value: UUID! }` and `input OrderIdInput { value: UUID! }` | `scalar OrderId` |
| `order { orderId { value } }` | `order { orderId }` |
| `order(id: { value: "..." })` | `order(id: "...")` |
| `input OrderIdFilterInput { value: UuidOperationFilterInput }` | `input OrderIdOperationFilterInput { eq neq in nin }` |
| `where: { id: { value: { eq: "..." } } }` | `where: { id: { eq: "..." } }` |

A filter on a strong-id field compares the id itself, with the id's scalar as the operand, so a filter value is
checked like an argument {verified: WhizbangIdFilteringTests.Eq_KeepsTheRowWithThatIdAsync, WhizbangIdFilteringTests.Eq_WithAGuidTheIdRefuses_IsTheIdsErrorAsync}.
See [Strong ID operators](filtering.md#strong-ids). Sorting does not change: a sort orders by the id itself {verified: WhizbangIdFilteringTests.Row_WithAnId_SortsByTheIdAsync}.

Update client queries and filters, and regenerate generated client types against the new schema.

## What Gets Registered

`AddWhizbangLenses()` registers:

- `WhizbangFilterConvention` - Custom filtering for `PerspectiveRow<T>`
- `WhizbangSortConvention` - Custom sorting for nested data
- Default projection convention
- `WhizbangGraphQLOptions` singleton

`AddWhizbangScope()` registers:

- `IScopeContextAccessor` - AsyncLocal-based scope access
- `WhizbangScopeOptions` singleton (if configured)

`AddWhizbangLenses()` and `AddWhizbangIds()` also add:

- One scalar per `[WhizbangId]` type the schema uses (see [Strong IDs](#strong-ids))

## Next Steps

- [Lens Integration](lens-integration.md) - Configure `[GraphQLLens]` attributes
- [Filtering](filtering.md) - Query filtering examples
- [Scoping](scoping.md) - Multi-tenancy configuration
