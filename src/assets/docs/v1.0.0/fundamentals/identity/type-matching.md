---
title: "TypeMatcher: Type Name Matching Utilities"
pageType: concept
verifiedAgainstCommit: 1b31f58d
verifiedDate: 2026-07-16
version: 1.0.0
category: "Core Concepts"
order: 28
description: >-
  TypeMatcher provides flexible type name matching with fuzzy matching via MatchStrictness flags
  and regex pattern matching. Implements a sequential transformation pipeline for type string
  comparisons with null-safe handling.
tags: 'type-matcher, type-matching, fuzzy-matching, regex, identity, type-comparison'
codeReferences:
  - src/Whizbang.Core/TypeMatcher.cs
  - src/Whizbang.Core/MatchStrictness.cs
testReferences:
  - tests/Whizbang.Core.Tests/TypeMatcherTests.cs
  - tests/Whizbang.Core.Tests/MatchStrictnessTests.cs
lastMaintainedCommit: '01f07906'
---

# TypeMatcher: Type Name Matching Utilities

TypeMatcher is a static utility class that provides flexible type name matching with support for fuzzy matching via MatchStrictness flags and regex pattern matching. It handles the transformation pipeline for type string comparisons.

## Overview

**TypeMatcher** provides:
- ✅ Fuzzy type name matching with MatchStrictness control
- ✅ Regex pattern matching for advanced scenarios
- ✅ Sequential transformation pipeline (Version → Assembly → Namespace → Case)
- ✅ Null-safe string comparisons
- ✅ Used by message association queries and type discovery

## Quick Start

### Basic Matching

```csharp{title="Basic Matching" description="Basic Matching" category="Implementation" difficulty="BEGINNER" tags=["Fundamentals", "Identity", "Basic", "Matching"] tests=["TypeMatcherTests.Matches_ExactMode_ReturnsFalseForDifferentStringsAsync", "TypeMatcherTests.Matches_SimpleName_MatchesJustTypeNameAsync", "TypeMatcherTests.Matches_IgnoreCase_CaseInsensitiveAsync"]}
using Whizbang.Core;

var type1 = "ECommerce.Contracts.Events.ProductCreatedEvent, ECommerce.Contracts";
var type2 = "ProductCreatedEvent";

// Exact match
bool exact = TypeMatcher.Matches(type1, type2, MatchStrictness.Exact);
// Result: false

// Simple name match
bool simple = TypeMatcher.Matches(type1, type2, MatchStrictness.SimpleName);
// Result: true

// Case-insensitive match
bool caseInsensitive = TypeMatcher.Matches(
    "ProductCreatedEvent",
    "productcreatedevent",
    MatchStrictness.CaseInsensitive
);
// Result: true
```

### Pattern Matching

```csharp{title="Pattern Matching" description="Pattern Matching" category="Implementation" difficulty="INTERMEDIATE" tags=["Fundamentals", "Identity", "Pattern", "Matching"] tests=["TypeMatcherTests.Matches_RegexPattern_MatchesWildcardsAsync"]}
using System.Text.RegularExpressions;

var typeString = "ECommerce.Contracts.Events.ProductCreatedEvent";

// Match any type containing "Product"
var pattern = new Regex(".*Product.*");
bool matches = TypeMatcher.Matches(typeString, pattern);
// Result: true

// Match event types ending with "Event"
var eventPattern = new Regex(".*Event$");
bool isEvent = TypeMatcher.Matches(typeString, eventPattern);
// Result: true

// Match types in ECommerce namespace
var namespacePattern = new Regex("^ECommerce\\.");
bool inNamespace = TypeMatcher.Matches(typeString, namespacePattern);
// Result: true
```

## Matching with Strictness

### Transformation Pipeline

TypeMatcher applies transformations sequentially based on MatchStrictness flags:

```csharp{title="Transformation Pipeline" description="TypeMatcher applies transformations sequentially based on MatchStrictness flags:" category="Implementation" difficulty="INTERMEDIATE" tags=["Fundamentals", "Identity", "Transformation", "Pipeline"] tests=["TypeMatcherTests.Matches_IgnoreVersion_StripsVersionInfoAsync", "TypeMatcherTests.Matches_IgnoreAssemblyMode_MatchesWithoutAssemblyAsync", "TypeMatcherTests.Matches_IgnoreNamespaceMode_MatchesSimpleNamesAsync", "TypeMatcherTests.Matches_IgnoreCase_CaseInsensitiveAsync"]}
// Example input
var type = "MyApp.Events.OrderCreated, MyApp, Version=1.0.0";

// Step 1: IgnoreVersion (if flag set)
// Strips: ", Version=1.0.0", ", Culture=...", ", PublicKeyToken=..."
// Result: "MyApp.Events.OrderCreated, MyApp"

// Step 2: IgnoreAssembly (if flag set)
// Strips: ", MyApp"
// Result: "MyApp.Events.OrderCreated"

// Step 3: IgnoreNamespace (if flag set)
// Extracts simple name after last dot
// Result: "OrderCreated"

// Step 4: IgnoreCase (if flag set)
// Uses StringComparison.OrdinalIgnoreCase for comparison
```

### Strictness Examples

```csharp{title="Strictness Examples" description="Strictness Examples" category="Implementation" difficulty="ADVANCED" tags=["Fundamentals", "Identity", "Strictness", "Examples"] tests=["TypeMatcherTests.Matches_ExactMode_ReturnsTrueForIdenticalStringsAsync", "TypeMatcherTests.Matches_IgnoreVersion_StripsVersionInfoAsync", "TypeMatcherTests.Matches_WithoutAssembly_MatchesNamespaceAndTypeAsync", "TypeMatcherTests.Matches_SimpleName_MatchesJustTypeNameAsync", "TypeMatcherTests.Matches_CombinedFlags_SimpleNameCaseInsensitiveAsync"]}
var fullType = "ECommerce.Contracts.Events.ProductCreatedEvent, ECommerce.Contracts, Version=1.0.0";

// Exact (no transformations)
bool exact = TypeMatcher.Matches(
    fullType,
    "ECommerce.Contracts.Events.ProductCreatedEvent, ECommerce.Contracts, Version=1.0.0",
    MatchStrictness.Exact
);
// Result: true

// IgnoreVersion
bool ignoreVer = TypeMatcher.Matches(
    fullType,
    "ECommerce.Contracts.Events.ProductCreatedEvent, ECommerce.Contracts",
    MatchStrictness.IgnoreVersion
);
// Result: true

// IgnoreAssembly
bool ignoreAsm = TypeMatcher.Matches(
    fullType,
    "ECommerce.Contracts.Events.ProductCreatedEvent",
    MatchStrictness.WithoutAssembly
);
// Result: true (WithoutAssembly = IgnoreAssembly | IgnoreVersion)

// SimpleName
bool simpleName = TypeMatcher.Matches(
    fullType,
    "ProductCreatedEvent",
    MatchStrictness.SimpleName
);
// Result: true

// SimpleNameCaseInsensitive
bool simpleCI = TypeMatcher.Matches(
    fullType,
    "productcreatedevent",
    MatchStrictness.SimpleNameCaseInsensitive
);
// Result: true
```

## Common Scenarios

### Scenario 1: Message Association Lookup

**When**: Finding perspectives that handle specific events

```csharp{title="Scenario 1: Message Association Lookup" description="When: Finding perspectives that handle specific events" category="Implementation" difficulty="INTERMEDIATE" tags=["Fundamentals", "Identity", "Scenario", "Message"] unverified="illustrative helper over PerspectiveRegistrationExtensions.GetMessageAssociations; the SimpleName match it relies on is verified on the Basic and Strictness examples"}
public IEnumerable<string> FindPerspectivesForEvent(string eventName) {
    var associations = PerspectiveRegistrationExtensions
        .GetMessageAssociations(serviceName);

    // Find all perspectives handling this event (simple name)
    return associations
        .Where(a => {
            return a.AssociationType == "perspective" &&
                   TypeMatcher.Matches(a.MessageType, eventName, MatchStrictness.SimpleName);
        })
        .Select(a => a.TargetName);
}

// Usage
var perspectives = FindPerspectivesForEvent("ProductCreatedEvent");
// Matches:
// - "ECommerce.Contracts.Events.ProductCreatedEvent, ECommerce.Contracts"
// - "MyApp.Domain.Events.ProductCreatedEvent, MyApp.Domain"
```

### Scenario 2: Plugin Discovery

**When**: Discovering handlers from external assemblies

```csharp{title="Scenario 2: Plugin Discovery" description="When: Discovering handlers from external assemblies" category="Implementation" difficulty="INTERMEDIATE" tags=["Fundamentals", "Identity", "Scenario", "Plugin"] unverified="illustrative plugin-discovery example over AppDomain/TypeFormatter reflection — not a TypeMatcher unit behavior"}
public IEnumerable<Type> FindHandlers(string eventPattern) {
    var pattern = new Regex(eventPattern);
    var allTypes = AppDomain.CurrentDomain.GetAssemblies()
        .SelectMany(a => a.GetTypes());

    return allTypes.Where(t => {
        var typeName = TypeFormatter.FormatType(t, TypeQualifications.FullyQualified);
        return TypeMatcher.Matches(typeName, pattern);
    });
}

// Usage: Find all types in "ECommerce.Events" namespace
var handlers = FindHandlers("ECommerce\\.Events\\..*");
```

### Scenario 3: Cross-Version Type Resolution

**When**: Resolving types across different assembly versions

```csharp{title="Scenario 3: Cross-Version Type Resolution" description="When: Resolving types across different assembly versions" category="Implementation" difficulty="INTERMEDIATE" tags=["Fundamentals", "Identity", "Scenario", "Cross-Version"] unverified="illustrative type-resolution example over TypeFormatter/reflection; the IgnoreVersion match itself is verified on the Strictness examples"}
public Type? ResolveType(string typeString, IEnumerable<Assembly> assemblies) {
    foreach (var assembly in assemblies) {
        foreach (var type in assembly.GetTypes()) {
            var candidateType = TypeFormatter.FormatType(
                type,
                TypeQualifications.FullyQualified
            );

            // Match without version - works across all versions
            if (TypeMatcher.Matches(candidateType, typeString, MatchStrictness.IgnoreVersion)) {
                return type;
            }
        }
    }
    return null;
}
```

### Scenario 4: Configuration-Based Filtering

**When**: Filtering messages based on configuration

```csharp{title="Scenario 4: Configuration-Based Filtering" description="When: Filtering messages based on configuration" category="Implementation" difficulty="INTERMEDIATE" tags=["Fundamentals", "Identity", "Scenario", "Configuration-Based"] unverified="illustrative configuration-filtering example (MessageFilter/ShouldProcess application code)"}
public class MessageFilter {
    public string Pattern { get; set; } = null!;
    public MatchStrictness Strictness { get; set; }
}

public bool ShouldProcess(string messageType, List<MessageFilter> filters) {
    return filters.Any(filter => {
        if (filter.Strictness == MatchStrictness.Exact) {
            // Use exact string matching
            return TypeMatcher.Matches(messageType, filter.Pattern, MatchStrictness.Exact);
        } else {
            // Use fuzzy matching
            return TypeMatcher.Matches(messageType, filter.Pattern, filter.Strictness);
        }
    });
}

// Configuration:
// - Pattern: "ProductCreatedEvent"
//   Strictness: SimpleName
// - Pattern: ".*Order.*"
//   Strictness: Exact (treated as regex)
```

## Pattern Matching

### Regex Overload

TypeMatcher provides a regex overload for advanced pattern matching:

```csharp{title="Regex Overload" description="TypeMatcher provides a regex overload for advanced pattern matching:" category="Implementation" difficulty="BEGINNER" tags=["Fundamentals", "Identity", "Regex", "Overload"] unverified="regex-overload signature and null/empty handling — no dedicated test covers Matches(null/empty, pattern) or the null-pattern ArgumentNullException"}
// Method signature
public static bool Matches(string typeString, Regex pattern);

// Null handling
TypeMatcher.Matches(null, pattern);        // Returns: false
TypeMatcher.Matches("", pattern);          // Returns: false
TypeMatcher.Matches(typeString, null);     // Throws: ArgumentNullException
```

### Common Patterns

```csharp{title="Common Patterns" description="Common Patterns" category="Implementation" difficulty="INTERMEDIATE" tags=["Fundamentals", "Identity", "Common", "Patterns"] tests=["TypeMatcherTests.Matches_RegexPattern_MatchesWildcardsAsync"]}
// Match any event type
var eventPattern = new Regex(".*Event$");
bool isEvent = TypeMatcher.Matches("ProductCreatedEvent", eventPattern);
// Result: true

// Match types in specific namespace
var namespacePattern = new Regex("^ECommerce\\.Contracts\\.");
bool inNamespace = TypeMatcher.Matches(
    "ECommerce.Contracts.Events.ProductCreatedEvent",
    namespacePattern
);
// Result: true

// Match command types
var commandPattern = new Regex(".*Command$");
bool isCommand = TypeMatcher.Matches("CreateOrderCommand", commandPattern);
// Result: true

// Match domain events (case-insensitive)
var domainPattern = new Regex(".*DomainEvent$", RegexOptions.IgnoreCase);
bool isDomainEvent = TypeMatcher.Matches("productcreateddomainevent", domainPattern);
// Result: true

// Match types containing "Product"
var productPattern = new Regex(".*Product.*");
bool hasProduct = TypeMatcher.Matches("CreateProductCommand", productPattern);
// Result: true

// Match fully qualified names in specific assembly
var assemblyPattern = new Regex(".*, MyAssembly$");
bool inAssembly = TypeMatcher.Matches(
    "MyApp.Events.OrderCreated, MyAssembly",
    assemblyPattern
);
// Result: true
```

### Combining Pattern and Fuzzy Matching

```csharp{title="Combining Pattern and Fuzzy Matching" description="Combining Pattern and Fuzzy Matching" category="Implementation" difficulty="INTERMEDIATE" tags=["Fundamentals", "Identity", "Combining", "Pattern"] tests=["TypeMatcherTests.Matches_RegexPattern_MatchesWildcardsAsync", "TypeMatcherTests.Matches_RegexPattern_DoesNotMatchWhenNoMatchAsync", "TypeMatcherTests.Matches_SimpleName_MatchesJustTypeNameAsync"]}
public IEnumerable<string> FindMatchingTypes(
    IEnumerable<string> types,
    string pattern,
    bool useRegex,
    MatchStrictness strictness) {

    if (useRegex) {
        var regex = new Regex(pattern);
        return types.Where(t => TypeMatcher.Matches(t, regex));
    } else {
        return types.Where(t => TypeMatcher.Matches(t, pattern, strictness));
    }
}

// Usage
var types = new[] {
    "ECommerce.Events.ProductCreatedEvent",
    "ECommerce.Events.OrderCreatedEvent",
    "MyApp.Commands.CreateProductCommand"
};

// Regex: All events
var events = FindMatchingTypes(types, ".*Event$", useRegex: true, MatchStrictness.Exact);
// Result: ["ECommerce.Events.ProductCreatedEvent", "ECommerce.Events.OrderCreatedEvent"]

// Fuzzy: match by simple name (equality after transformation, NOT "contains")
var products = FindMatchingTypes(types, "ProductCreatedEvent", useRegex: false, MatchStrictness.SimpleName);
// Result: ["ECommerce.Events.ProductCreatedEvent"]
// For "contains"-style matching, use the regex overload instead (e.g. ".*Product.*").
```

## Null and Empty String Handling

TypeMatcher handles edge cases gracefully:

```csharp{title="Null and Empty String Handling" description="TypeMatcher handles edge cases gracefully:" category="Implementation" difficulty="INTERMEDIATE" tags=["Fundamentals", "Identity", "Null", "Empty"] tests=["TypeMatcherTests.Matches_EmptyStrings_ReturnsTrueAsync", "TypeMatcherTests.Matches_OneEmptyString_ReturnsFalseAsync"]}
// Both null or empty: true
bool match1 = TypeMatcher.Matches(null, null, MatchStrictness.Exact);
// Result: true

bool match2 = TypeMatcher.Matches("", "", MatchStrictness.Exact);
// Result: true

// One null or empty: false
bool match3 = TypeMatcher.Matches("MyType", null, MatchStrictness.Exact);
// Result: false

bool match4 = TypeMatcher.Matches(null, "MyType", MatchStrictness.Exact);
// Result: false

bool match5 = TypeMatcher.Matches("MyType", "", MatchStrictness.Exact);
// Result: false

// Regex with null or empty string
var pattern = new Regex(".*");
bool match6 = TypeMatcher.Matches(null, pattern);
// Result: false

bool match7 = TypeMatcher.Matches("", pattern);
// Result: false

// Null pattern throws
bool match8 = TypeMatcher.Matches("MyType", (Regex)null!);
// Throws: ArgumentNullException
```

## String Comparison Details

### Case Sensitivity

```csharp{title="Case Sensitivity" description="Case Sensitivity" category="Implementation" difficulty="INTERMEDIATE" tags=["Fundamentals", "Identity", "Case", "Sensitivity"] tests=["TypeMatcherTests.Matches_ExactMode_CaseSensitiveAsync", "TypeMatcherTests.Matches_IgnoreCase_CaseInsensitiveAsync"]}
// Case-sensitive (default)
bool caseSensitive = TypeMatcher.Matches(
    "ProductCreatedEvent",
    "productcreatedevent",
    MatchStrictness.Exact
);
// Result: false (uses StringComparison.Ordinal)

// Case-insensitive
bool caseInsensitive = TypeMatcher.Matches(
    "ProductCreatedEvent",
    "productcreatedevent",
    MatchStrictness.CaseInsensitive
);
// Result: true (uses StringComparison.OrdinalIgnoreCase)
```

### Ordinal Comparison

TypeMatcher uses ordinal (binary) comparison for performance and consistency:

```csharp{title="Ordinal Comparison" description="TypeMatcher uses ordinal (binary) comparison for performance and consistency:" category="Implementation" difficulty="BEGINNER" tags=["Fundamentals", "Identity", "Ordinal", "Comparison"] unverified="documents ordinal (not culture-sensitive) comparison; the case-sensitive vs case-insensitive behavior is verified on the Case Sensitivity example above, but the culture-insensitivity claim has no dedicated test"}
// Uses StringComparison.Ordinal (case-sensitive)
TypeMatcher.Matches(type1, type2, MatchStrictness.Exact);

// Uses StringComparison.OrdinalIgnoreCase (case-insensitive)
TypeMatcher.Matches(type1, type2, MatchStrictness.CaseInsensitive);

// NOT culture-sensitive (e.g., Turkish I/i)
// This is intentional for type matching consistency
```

## Integration with Message Associations

TypeMatcher powers the fuzzy matching in message association queries:

```csharp{title="Integration with Message Associations" description="TypeMatcher powers the fuzzy matching in message association queries:" category="Implementation" difficulty="INTERMEDIATE" tags=["Fundamentals", "Identity", "Integration", "Message"] unverified="illustrative PerspectiveRegistrationExtensions integration — verified in the Perspectives docs, not by TypeMatcher tests"}
// GetPerspectivesForEvent with MatchStrictness
var perspectives = PerspectiveRegistrationExtensions.GetPerspectivesForEvent(
    eventType,
    serviceName,
    MatchStrictness.SimpleName
);
// Internally uses: TypeMatcher.Matches(a.MessageType, eventType, MatchStrictness.SimpleName)

// GetPerspectivesForEvent with Regex
var eventPattern = new Regex(".*Product.*");
var productPerspectives = PerspectiveRegistrationExtensions.GetPerspectivesForEvent(
    eventPattern,
    serviceName
);
// Internally uses: TypeMatcher.Matches(a.MessageType, eventPattern)

// GetEventsForPerspective with MatchStrictness
var events = PerspectiveRegistrationExtensions.GetEventsForPerspective(
    perspectiveName,
    serviceName,
    MatchStrictness.SimpleName
);
// Internally uses: TypeMatcher.Matches(a.TargetName, perspectiveName, MatchStrictness.SimpleName)

// GetEventsForPerspective with Regex
var perspectivePattern = new Regex(".*Inventory.*");
var inventoryEvents = PerspectiveRegistrationExtensions.GetEventsForPerspective(
    perspectivePattern,
    serviceName
);
// Internally uses: TypeMatcher.Matches(a.TargetName, perspectivePattern)
```

## API Reference

### Method Signatures

**Namespace**: `Whizbang.Core`

```csharp{title="Method Signatures" description="Namespace: `Whizbang." category="Implementation" difficulty="INTERMEDIATE" tags=["Fundamentals", "Identity", "Method", "Signatures"] tests=["TypeMatcherTests.Matches_ExactMode_ReturnsTrueForIdenticalStringsAsync", "TypeMatcherTests.Matches_RegexPattern_MatchesWildcardsAsync"]}
public static class TypeMatcher {
    /// <summary>
    /// Matches two type strings using the specified MatchStrictness flags.
    /// Applies transformations sequentially: Version → Assembly → Namespace → Case.
    /// </summary>
    /// <param name="typeString1">First type string to compare</param>
    /// <param name="typeString2">Second type string to compare</param>
    /// <param name="strictness">Flags controlling matching behavior</param>
    /// <returns>True if types match according to strictness rules</returns>
    public static bool Matches(
        string typeString1,
        string typeString2,
        MatchStrictness strictness
    );

    /// <summary>
    /// Matches a type string against a regex pattern.
    /// </summary>
    /// <param name="typeString">Type string to match</param>
    /// <param name="pattern">Regex pattern to match against</param>
    /// <returns>True if type string matches the pattern</returns>
    /// <exception cref="ArgumentNullException">Thrown if pattern is null</exception>
    public static bool Matches(string typeString, Regex pattern);
}
```

### Return Values

- Returns `true` if strings match according to rules
- Returns `false` if strings don't match
- Returns `true` if both strings are null or empty
- Returns `false` if one string is null/empty and the other is not
- Returns `false` if type string is null/empty (regex overload)

### Exceptions

- **ArgumentNullException**: Thrown if regex pattern parameter is null

## Best Practices

1. **Use SimpleName for user-facing searches** - Most forgiving for user input
2. **Use IgnoreVersion in production** - Avoids brittleness from version changes
3. **Cache regex patterns** - Create once, reuse for better performance
4. **Combine with TypeFormatter** - Format types consistently before matching
5. **Test null/empty cases** - Ensure edge cases are handled correctly
6. **Document matching rules** - Explain why a particular strictness level was chosen
7. **Use ordinal comparison** - TypeMatcher already does this, don't override
8. **Prefer presets over raw flags** - Clearer intent with `SimpleName` vs `IgnoreNamespace | IgnoreAssembly | IgnoreVersion`

## Common Pitfalls

### ❌ Assuming Culture-Sensitive Matching

```csharp{title="❌ Assuming Culture-Sensitive Matching" description="❌ Assuming Culture-Sensitive Matching" category="Implementation" difficulty="BEGINNER" tags=["Fundamentals", "Identity", "Assuming", "Culture-Sensitive"] unverified="counter-example — documents ordinal (not culture-sensitive) matching; no dedicated Straße/Strasse test"}
// ❌ WRONG: Expecting culture-sensitive comparison
// TypeMatcher always uses Ordinal/OrdinalIgnoreCase
bool match = TypeMatcher.Matches("Straße", "Strasse", MatchStrictness.CaseInsensitive);
// Result: false (ordinal comparison, not culture-sensitive)

// ✅ CORRECT: Use ordinal-aware expectations
// TypeMatcher is designed for type names, not natural language
```

### ❌ Assuming IgnoreVersion Also Strips the Assembly

```csharp{title="❌ Assuming IgnoreVersion Also Strips the Assembly" description="IgnoreVersion only removes version/culture/token; the assembly name remains" category="Implementation" difficulty="BEGINNER" tags=["Fundamentals", "Identity", "IgnoreVersion", "Transformation"] unverified="counter-example — the IgnoreVersion-retains-assembly case has no dedicated test; the WithoutAssembly fix is verified on the Strictness examples"}
// ❌ WRONG: IgnoreVersion only strips ", Version=..., Culture=..., PublicKeyToken=..."
var type = "MyApp.Events.OrderCreated, MyApp, Version=1.0.0";
bool match = TypeMatcher.Matches(type, "MyApp.Events.OrderCreated", MatchStrictness.IgnoreVersion);
// Result: false ("MyApp.Events.OrderCreated, MyApp" still carries the assembly name)

// ✅ CORRECT: Use WithoutAssembly (IgnoreAssembly | IgnoreVersion)
bool match = TypeMatcher.Matches(type, "MyApp.Events.OrderCreated", MatchStrictness.WithoutAssembly);
// Result: true

// Note: IgnoreNamespace strips any assembly suffix before extracting the
// simple name, so it effectively implies IgnoreAssembly on its own.
```

### ❌ Not Checking for Null Pattern

```csharp{title="❌ Not Checking for Null Pattern" description="❌ Not Checking for Null Pattern" category="Implementation" difficulty="BEGINNER" tags=["Fundamentals", "Identity", "Not", "Checking"] unverified="counter-example — null-pattern ArgumentNullException has no dedicated test"}
// ❌ WRONG: Passing null regex
Regex? pattern = null;
bool match = TypeMatcher.Matches("MyType", pattern!);
// Throws: ArgumentNullException

// ✅ CORRECT: Check for null first
if (pattern != null) {
    bool match = TypeMatcher.Matches("MyType", pattern);
}
```

### ❌ Overly Broad Patterns

```csharp{title="❌ Overly Broad Patterns" description="❌ Overly Broad Patterns" category="Implementation" difficulty="INTERMEDIATE" tags=["Fundamentals", "Identity", "Overly", "Broad"] unverified="counter-example — illustrative security pitfall, nothing to assert"}
// ❌ WRONG: Pattern matches too many types
var pattern = new Regex(".*"); // Matches EVERYTHING!
if (TypeMatcher.Matches(userType, pattern)) {
    ExecutePrivilegedAction(); // Dangerous!
}

// ✅ CORRECT: Specific pattern
var pattern = new Regex("^MyApp\\.Admin\\.Commands\\..*Command$");
if (TypeMatcher.Matches(userType, pattern)) {
    ExecutePrivilegedAction();
}
```

## Performance Considerations

### String Allocations

TypeMatcher may allocate new strings during transformations:

```csharp{title="String Allocations" description="TypeMatcher may allocate new strings during transformations:" category="Implementation" difficulty="INTERMEDIATE" tags=["Fundamentals", "Identity", "String", "Allocations"] unverified="illustrative caching/performance example with pseudo-code Transform/GetComparison helpers"}
// Each transformation may allocate a new string
// - StripVersionInfo: 1 allocation
// - StripAssembly: 1 allocation
// - GetSimpleName: 1 allocation

// Consider caching if matching frequently
private readonly ConcurrentDictionary<(string, MatchStrictness), string> _transformCache = new();

public bool CachedMatch(string type1, string type2, MatchStrictness strictness) {
    var transformed1 = _transformCache.GetOrAdd((type1, strictness), _ => Transform(type1, strictness));
    var transformed2 = _transformCache.GetOrAdd((type2, strictness), _ => Transform(type2, strictness));
    return string.Equals(transformed1, transformed2, GetComparison(strictness));
}
```

### Regex Performance

```csharp{title="Regex Performance" description="Regex Performance" category="Implementation" difficulty="INTERMEDIATE" tags=["Fundamentals", "Identity", "Regex", "Performance"] unverified="counter-example — illustrative regex-caching performance guidance, nothing to assert"}
// ❌ WRONG: Create regex in hot path
for (int i = 0; i < 10000; i++) {
    var pattern = new Regex(".*Event$"); // Creates 10,000 regex instances!
    TypeMatcher.Matches(types[i], pattern);
}

// ✅ CORRECT: Cache regex
var pattern = new Regex(".*Event$", RegexOptions.Compiled);
for (int i = 0; i < 10000; i++) {
    TypeMatcher.Matches(types[i], pattern);
}
```

## See Also

- [TypeQualifications](type-qualification.md) - Type name formatting flags
- [TypeFormatter](type-formatting.md) - Format types for matching
- [MatchStrictness](fuzzy-matching.md) - Fuzzy matching control
- [Perspectives](../perspectives/perspectives.md) - Message associations using TypeMatcher
