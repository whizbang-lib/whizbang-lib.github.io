# MatchStrictness: Fuzzy Type Matching Control

MatchStrictness is a flag enum that controls how type names are compared during fuzzy matching. It enables flexible type matching by allowing you to ignore case, version, assembly, or namespace components.

## Overview

**MatchStrictness** provides:
- ✅ Flag-based control over type matching behavior
- ✅ Combinable flags for precise matching rules
- ✅ Composite presets for common scenarios
- ✅ Works with both formatted and raw type strings
- ✅ Used by message association queries and type matching APIs

## Quick Start

### Basic Fuzzy Matching

```csharp
using Whizbang.Core;

var fullType = "ECommerce.Contracts.Events.ProductCreatedEvent, ECommerce.Contracts, Version=1.0.0";
var simpleType = "ProductCreatedEvent";

// Exact match (default)
bool exactMatch = TypeMatcher.Matches(fullType, simpleType, MatchStrictness.Exact);
// Result: false (types don't match exactly)

// Simple name match (ignore namespace, assembly, version)
bool simpleMatch = TypeMatcher.Matches(fullType, simpleType, MatchStrictness.SimpleName);
// Result: true (both have "ProductCreatedEvent")

// Case-insensitive match
bool caseMatch = TypeMatcher.Matches(
    "ProductCreatedEvent",
    "productcreatedevent",
    MatchStrictness.CaseInsensitive
);
// Result: true (case ignored)
```

### Combining Multiple Flags

```csharp
// Ignore both case AND version
var strictness = MatchStrictness.IgnoreCase | MatchStrictness.IgnoreVersion;

bool match = TypeMatcher.Matches(
    "MyApp.Events.OrderCreated, MyApp, Version=1.0.0",
    "myapp.events.ordercreated, myapp, version=2.0.0",
    strictness
);
// Result: true (version and case ignored)

// Ignore namespace and case
var flexibleMatch = MatchStrictness.IgnoreNamespace | MatchStrictness.IgnoreCase;

bool matches = TypeMatcher.Matches(
    "ECommerce.Events.ProductCreated",
    "productcreated",
    flexibleMatch
);
// Result: true (namespace and case ignored)
```

## Individual Flags

### Flag Definitions

Each flag controls a specific transformation applied to type strings before comparison:

| Flag | Value | Description |
|------|-------|-------------|
| `None` | 0 | Exact match (no transformations) |
| `IgnoreCase` | 1 | Case-insensitive comparison |
| `IgnoreVersion` | 2 | Strip version, culture, and public key token |
| `IgnoreAssembly` | 4 | Remove assembly name |
| `IgnoreNamespace` | 8 | Extract simple type name only |

**Transformation Order** (applied sequentially):
1. **IgnoreVersion** → Strip version/culture/token
2. **IgnoreAssembly** → Remove assembly name
3. **IgnoreNamespace** → Extract simple type name
4. **IgnoreCase** → Case-insensitive comparison

### IgnoreCase

**When**: Case-insensitive type name matching

```csharp
var type1 = "ECommerce.Contracts.Events.ProductCreatedEvent";
var type2 = "ecommerce.contracts.events.productcreatedevent";

bool match = TypeMatcher.Matches(type1, type2, MatchStrictness.IgnoreCase);
// Result: true

// Combine with other flags
var strictness = MatchStrictness.IgnoreCase | MatchStrictness.IgnoreNamespace;
bool simpleMatch = TypeMatcher.Matches(
    "MyApp.Events.OrderCreated",
    "ordercreated",
    strictness
);
// Result: true
```

### IgnoreVersion

**When**: Matching types across different assembly versions

```csharp
var v1 = "MyApp.Events.OrderCreated, MyApp, Version=1.0.0, Culture=neutral";
var v2 = "MyApp.Events.OrderCreated, MyApp, Version=2.0.0, Culture=neutral";

bool match = TypeMatcher.Matches(v1, v2, MatchStrictness.IgnoreVersion);
// Result: true (version, culture stripped before comparison)

// Original types remain unchanged
// After IgnoreVersion transformation:
// v1 → "MyApp.Events.OrderCreated, MyApp"
// v2 → "MyApp.Events.OrderCreated, MyApp"
```

### IgnoreAssembly

**When**: Matching types by namespace.TypeName only

```csharp
var type1 = "ECommerce.Events.ProductCreated, ECommerce.Contracts";
var type2 = "ECommerce.Events.ProductCreated, ECommerce.Core";

bool match = TypeMatcher.Matches(type1, type2, MatchStrictness.IgnoreAssembly);
// Result: true (assembly name removed before comparison)

// After IgnoreAssembly transformation:
// type1 → "ECommerce.Events.ProductCreated"
// type2 → "ECommerce.Events.ProductCreated"
```

### IgnoreNamespace

**When**: Matching types by simple name only

```csharp
var type1 = "ECommerce.Contracts.Events.ProductCreatedEvent";
var type2 = "MyApp.Domain.Events.ProductCreatedEvent";
var type3 = "ProductCreatedEvent";

bool match1 = TypeMatcher.Matches(type1, type2, MatchStrictness.IgnoreNamespace);
// Result: true

bool match2 = TypeMatcher.Matches(type1, type3, MatchStrictness.IgnoreNamespace);
// Result: true

// After IgnoreNamespace transformation:
// type1 → "ProductCreatedEvent"
// type2 → "ProductCreatedEvent"
// type3 → "ProductCreatedEvent"
```

## Composite Presets

### Pre-Defined Combinations

| Preset | Flags | Use Case |
|--------|-------|----------|
| `Exact` | `None` | Exact string match (default) |
| `CaseInsensitive` | `IgnoreCase` | Case-insensitive match |
| `WithoutVersionInfo` | `IgnoreVersion` | Match across versions |
| `WithoutAssembly` | `IgnoreAssembly \| IgnoreVersion` | Match namespace.Type |
| `SimpleName` | `IgnoreNamespace \| IgnoreAssembly \| IgnoreVersion` | Match simple type name |
| `SimpleNameCaseInsensitive` | `SimpleName \| IgnoreCase` | Match simple name, any case |

### Preset Examples

```csharp
// Exact preset (default)
bool exact = TypeMatcher.Matches(
    "MyApp.OrderCreated",
    "myapp.ordercreated",
    MatchStrictness.Exact
);
// Result: false (case matters)

// CaseInsensitive preset
bool caseInsensitive = TypeMatcher.Matches(
    "MyApp.OrderCreated",
    "myapp.ordercreated",
    MatchStrictness.CaseInsensitive
);
// Result: true

// WithoutVersionInfo preset
bool withoutVersion = TypeMatcher.Matches(
    "MyApp.Order, MyApp, Version=1.0.0",
    "MyApp.Order, MyApp, Version=2.0.0",
    MatchStrictness.WithoutVersionInfo
);
// Result: true

// SimpleName preset
bool simpleName = TypeMatcher.Matches(
    "ECommerce.Contracts.Events.ProductCreatedEvent, ECommerce.Contracts",
    "ProductCreatedEvent",
    MatchStrictness.SimpleName
);
// Result: true

// SimpleNameCaseInsensitive preset
bool simpleNameCI = TypeMatcher.Matches(
    "MyApp.Events.OrderCreated",
    "ordercreated",
    MatchStrictness.SimpleNameCaseInsensitive
);
// Result: true
```

## Flag Combination Semantics

### Additive Behavior

Flags are combined using bitwise OR, and each flag adds a transformation:

```csharp
// Single flag
var ignoreCase = MatchStrictness.IgnoreCase;

// Two flags
var ignoreVer sionAndCase = MatchStrictness.IgnoreVersion | MatchStrictness.IgnoreCase;

// Three flags
var flexible = MatchStrictness.IgnoreVersion | MatchStrictness.IgnoreAssembly | MatchStrictness.IgnoreCase;

// Equivalent to SimpleName + IgnoreCase
var veryFlexible = MatchStrictness.SimpleName | MatchStrictness.IgnoreCase;
// Same as: SimpleNameCaseInsensitive
```

### Order of Operations

Transformations are applied in a specific order before comparison:

```csharp
// Example input
var type = "MyApp.Events.OrderCreated, MyApp, Version=1.0.0";

// Step 1: IgnoreVersion (if flag set)
// → "MyApp.Events.OrderCreated, MyApp"

// Step 2: IgnoreAssembly (if flag set)
// → "MyApp.Events.OrderCreated"

// Step 3: IgnoreNamespace (if flag set)
// → "OrderCreated"

// Step 4: IgnoreCase (if flag set)
// → Compare using StringComparison.OrdinalIgnoreCase
```

## Common Scenarios

### Scenario 1: Cross-Version Type Matching

**When**: Matching events from different assembly versions

```csharp
public bool IsProductEvent(string eventTypeName) {
    var productEventTypes = new[] {
        "ECommerce.Contracts.Events.ProductCreatedEvent, ECommerce.Contracts, Version=1.0.0",
        "ECommerce.Contracts.Events.ProductUpdatedEvent, ECommerce.Contracts, Version=1.0.0",
        "ECommerce.Contracts.Events.ProductDeletedEvent, ECommerce.Contracts, Version=1.0.0"
    };

    // Match without version - works across all versions
    return productEventTypes.Any(knownType =>
        TypeMatcher.Matches(
            eventTypeName,
            knownType,
            MatchStrictness.IgnoreVersion
        )
    );
}
```

### Scenario 2: User Input Matching

**When**: Matching user-provided type names (case-insensitive)

```csharp
public IEnumerable<string> FindPerspectives(string eventName) {
    // User types "ordercreated" - find "OrderCreated", "orderCreated", etc.
    return PerspectiveRegistrationExtensions.GetPerspectivesForEvent(
        eventName,
        serviceName,
        MatchStrictness.SimpleNameCaseInsensitive
    );
}
```

### Scenario 3: Plugin System Type Discovery

**When**: Discovering types from external assemblies

```csharp
public IEnumerable<Type> FindEventHandlers(string eventTypeName) {
    var allTypes = AppDomain.CurrentDomain.GetAssemblies()
        .SelectMany(a => a.GetTypes());

    // Match by simple name, ignore assembly and namespace
    return allTypes.Where(t => {
        var typeName = TypeFormatter.FormatType(t, TypeQualification.Simple);
        return TypeMatcher.Matches(
            typeName,
            eventTypeName,
            MatchStrictness.SimpleName
        );
    });
}
```

### Scenario 4: Configuration-Based Routing

**When**: Routing messages based on configuration

```csharp
public class MessageRouteConfig {
    public string EventPattern { get; set; } = null!;
    public MatchStrictness Strictness { get; set; }
    public string HandlerName { get; set; } = null!;
}

public string? FindHandler(string eventType, List<MessageRouteConfig> routes) {
    foreach (var route in routes) {
        if (TypeMatcher.Matches(eventType, route.EventPattern, route.Strictness)) {
            return route.HandlerName;
        }
    }
    return null;
}

// Configuration:
// - EventPattern: "ProductCreatedEvent"
//   Strictness: SimpleName
//   HandlerName: "ProductHandler"
//
// Matches:
// - "ECommerce.Events.ProductCreatedEvent"
// - "MyApp.Domain.ProductCreatedEvent"
// - "ProductCreatedEvent"
```

## Flag Enum Mechanics

### Checking Flags

```csharp
var strictness = MatchStrictness.IgnoreCase | MatchStrictness.IgnoreVersion;

// Check if a flag is set
bool hasIgnoreCase = strictness.HasFlag(MatchStrictness.IgnoreCase);
// Result: true

bool hasIgnoreNamespace = strictness.HasFlag(MatchStrictness.IgnoreNamespace);
// Result: false

// Bitwise check (equivalent)
bool hasIgnoreCaseAlt = (strictness & MatchStrictness.IgnoreCase) == MatchStrictness.IgnoreCase;
// Result: true
```

### Adding and Removing Flags

```csharp
var strictness = MatchStrictness.IgnoreVersion;

// Add a flag
strictness |= MatchStrictness.IgnoreCase;
// Now: IgnoreVersion | IgnoreCase

// Remove a flag
strictness &= ~MatchStrictness.IgnoreVersion;
// Now: IgnoreCase

// Toggle a flag
strictness ^= MatchStrictness.IgnoreAssembly;
// Adds IgnoreAssembly if not present, removes if present
```

### Building Strictness Dynamically

```csharp
public MatchStrictness BuildStrictness(
    bool ignoreCase,
    bool ignoreVersion,
    bool ignoreAssembly) {

    var result = MatchStrictness.None;

    if (ignoreCase) {
        result |= MatchStrictness.IgnoreCase;
    }

    if (ignoreVersion) {
        result |= MatchStrictness.IgnoreVersion;
    }

    if (ignoreAssembly) {
        result |= MatchStrictness.IgnoreAssembly;
    }

    return result;
}

// Usage
var strictness = BuildStrictness(
    ignoreCase: true,
    ignoreVersion: true,
    ignoreAssembly: false
);
// Result: IgnoreCase | IgnoreVersion
```

## Integration with Message Associations

MatchStrictness is extensively used in message association queries:

```csharp
// Find perspectives for event (exact)
var exactPerspectives = PerspectiveRegistrationExtensions.GetPerspectivesForEvent(
    "ECommerce.Contracts.Events.ProductCreatedEvent",
    serviceName,
    MatchStrictness.Exact
);

// Find perspectives for event (simple name)
var simplePerspectives = PerspectiveRegistrationExtensions.GetPerspectivesForEvent(
    "ProductCreatedEvent",
    serviceName,
    MatchStrictness.SimpleName
);

// Find perspectives for event (case-insensitive simple name)
var flexiblePerspectives = PerspectiveRegistrationExtensions.GetPerspectivesForEvent(
    "productcreatedevent",
    serviceName,
    MatchStrictness.SimpleNameCaseInsensitive
);

// Find events for perspective (ignore assembly)
var events = PerspectiveRegistrationExtensions.GetEventsForPerspective(
    "InventoryPerspective",
    serviceName,
    MatchStrictness.WithoutAssembly
);
```

## API Reference

### Enum Definition

**Namespace**: `Whizbang.Core`

```csharp
[Flags]
public enum MatchStrictness {
  None = 0,              // Exact match (default)

  // Individual flags (can be combined)
  IgnoreCase = 1 << 0,           // 1 - Case-insensitive comparison
  IgnoreVersion = 1 << 1,        // 2 - Ignore Version, Culture, PublicKeyToken
  IgnoreAssembly = 1 << 2,       // 4 - Ignore assembly name
  IgnoreNamespace = 1 << 3,      // 8 - Ignore namespace, keep type name only

  // Composite presets (for convenience)
  Exact = None,
  CaseInsensitive = IgnoreCase,
  WithoutVersionInfo = IgnoreVersion,
  WithoutAssembly = IgnoreAssembly | IgnoreVersion,  // Match namespace.Type
  SimpleName = IgnoreNamespace | IgnoreAssembly | IgnoreVersion,  // Just type name
  SimpleNameCaseInsensitive = SimpleName | IgnoreCase
}
```

### Usage with TypeMatcher

```csharp
// Match two type strings with strictness
bool match = TypeMatcher.Matches(
    string typeString1,
    string typeString2,
    MatchStrictness strictness
);

// Examples
bool exact = TypeMatcher.Matches("MyType", "MyType", MatchStrictness.Exact);
bool caseInsensitive = TypeMatcher.Matches("MyType", "mytype", MatchStrictness.CaseInsensitive);
bool simple = TypeMatcher.Matches("MyApp.MyType", "MyType", MatchStrictness.SimpleName);
```

## Best Practices

1. **Use presets for common cases** - `SimpleName`, `CaseInsensitive`, etc. are clearer than flag combinations
2. **Prefer SimpleNameCaseInsensitive for user input** - Most forgiving for user-provided type names
3. **Use IgnoreVersion for production code** - Avoids brittleness from version changes
4. **Combine flags for precise control** - Use bitwise OR for exact matching needs
5. **Document strictness choices** - Explain why a particular strictness level was chosen
6. **Test edge cases** - Ensure matching behavior works with nested types, generics, etc.
7. **Consider security implications** - Overly permissive matching may allow unintended type substitutions

## Common Pitfalls

### ❌ Confusing Exact with None

```csharp
// ❌ WRONG: Assuming None means no matching
bool match = TypeMatcher.Matches(type1, type2, MatchStrictness.None);
// Actually: Exact match (None = 0 = Exact)

// ✅ CORRECT: Use Exact for clarity
bool match = TypeMatcher.Matches(type1, type2, MatchStrictness.Exact);
```

### ❌ Over-Permissive Matching

```csharp
// ❌ WRONG: Too permissive for security-sensitive code
var strictness = MatchStrictness.SimpleNameCaseInsensitive;
if (TypeMatcher.Matches(userProvidedType, "AdminCommand", strictness)) {
    ExecuteAdminCommand(); // Dangerous - could match many types!
}

// ✅ CORRECT: Use stricter matching for security
var strictness = MatchStrictness.FullyQualified;
if (TypeMatcher.Matches(userProvidedType, expectedType, strictness)) {
    ExecuteAdminCommand();
}
```

### ❌ Forgetting Version Implications

```csharp
// ❌ WRONG: Exact match breaks with version changes
bool match = TypeMatcher.Matches(
    "MyType, MyAssembly, Version=1.0.0",
    "MyType, MyAssembly, Version=2.0.0",
    MatchStrictness.Exact
);
// Result: false (breaks when version changes)

// ✅ CORRECT: Ignore version for robustness
bool match = TypeMatcher.Matches(
    "MyType, MyAssembly, Version=1.0.0",
    "MyType, MyAssembly, Version=2.0.0",
    MatchStrictness.IgnoreVersion
);
// Result: true
```

## See Also

- [TypeQualification](/v1.0.0/core-concepts/type-qualification) - Formatting types for matching
- [TypeFormatter](/v1.0.0/core-concepts/type-formatting) - Formatting Type objects to strings
- [TypeMatcher](/v1.0.0/core-concepts/type-matching) - Type matching with MatchStrictness
- [Perspectives](/v1.0.0/core-concepts/perspectives) - Message associations using fuzzy matching
