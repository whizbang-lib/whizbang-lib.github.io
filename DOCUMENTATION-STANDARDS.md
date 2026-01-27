# Documentation Standards

This document defines standards for writing and maintaining documentation for the Whizbang .NET library.

## Purpose

These standards ensure:

- **Consistency**: All documentation follows the same patterns
- **Quality**: Examples are complete, accurate, and helpful
- **Maintainability**: Documentation stays synchronized with code
- **Usability**: Users can quickly find what they need

## Target Audience

Documentation is written for:

- **Primary**: C# developers using .NET 6+ building applications
- **Secondary**: Library maintainers and contributors
- **Tertiary**: AI assistants helping users with the library

## Voice and Tone

### Voice

- **Clear and Concise**: Get to the point quickly
- **Professional but Approachable**: Technical but not academic
- **Practical**: Focus on real-world usage
- **Explanatory**: Explain "why" not just "how"

### Examples

✅ **Good**: "Aggregates encapsulate domain logic and maintain consistency boundaries. Use them to group related entities that change together."

❌ **Bad**: "An aggregate is a pattern in Domain-Driven Design (DDD) that represents a cluster of domain objects..."

✅ **Good**: "Call `ProcessOrderAsync` to validate and process an order. This method throws `InvalidOrderException` if validation fails."

❌ **Bad**: "The ProcessOrderAsync method processes orders."

## Document Structure

Every documentation page should follow this structure:

### 1. Frontmatter (Required)

```yaml
---
title: Getting Started          # Required - display title
slug: getting-started           # Optional - URL slug (defaults to filename)
category: Introduction          # Required - navigation category
order: 1                        # Required - sort order within category
tags: beginner, tutorial        # Optional - comma-separated tags
---
```

### 2. Title (H1) - Matches frontmatter title

```markdown
# Getting Started
```

### 3. Overview/Introduction

Brief explanation of what this document covers and why it matters.

```markdown
This guide walks you through installing Whizbang and creating your first aggregate.
```

### 4. Main Content Sections (H2)

Organized logically, typically following this pattern:

- **Concept Explanation**: What it is and why you'd use it
- **Code Examples**: Complete, runnable C# code
- **API Reference**: Technical details
- **Best Practices**: Recommended patterns
- **Common Pitfalls**: What to avoid

### 5. Related Links

Link to related documentation at the end.

```markdown
## See Also

- [Aggregates](./aggregates.md)
- [Projections](./projections.md)
- [API Reference](./api.md)
```

## C# Code Example Standards

All C# code examples MUST follow these standards.

### Code Style - EditorConfig

**CRITICAL**: All C# code examples must follow the conventions defined in [`CODE_SAMPLES.editorconfig`](./CODE_SAMPLES.editorconfig).

Key conventions:
- **Brace Style**: K&R/Egyptian (opening brace on same line)
- **var Usage**: Always use `var` for local variables
- **Naming**:
  - PascalCase for public members
  - camelCase for parameters/locals
  - `_camelCase` for private fields
  - `IPascalCase` for interfaces
  - `MethodAsync` suffix for async methods
  - `ALL_CAPS` for constants
- **Namespaces**: File-scoped namespaces
- **Using Directives**: Outside namespace, System directives first
- **Modern C#**: Use pattern matching, null coalescing, index/range operators

Example following EditorConfig standards:

```csharp
using System;
using System.Threading.Tasks;
using Whizbang;

namespace MyApp.Orders;

public class OrderProcessor {
    private readonly IOrderRepository _repository;
    private const int MAX_RETRIES = 3;

    public OrderProcessor(IOrderRepository repository) {
        _repository = repository;
    }

    public async Task<Order> GetOrderAsync(Guid orderId) {
        if (orderId == Guid.Empty) {
            throw new ArgumentException("Order ID cannot be empty", nameof(orderId));
        }

        var order = await _repository.GetByIdAsync(orderId);
        return order ?? throw new OrderNotFoundException(orderId);
    }
}
```

### Enhanced Code Block Metadata

The documentation site supports rich metadata for code examples using the enhanced code block syntax:

````markdown
```csharp{
title: "Order Processing Service"
description: "Demonstrates order validation and processing with error handling"
framework: "NET8"
category: "Domain Logic"
difficulty: "INTERMEDIATE"
tags: ["Orders", "Validation", "Error Handling"]
githubUrl: "https://github.com/example/order-service"
docsUrl: "https://docs.whizbang.io/orders"
nugetPackages: ["Whizbang.Core", "Whizbang.Orders"]
filename: "OrderProcessor.cs"
showLineNumbers: true
highlightLines: [12, 15, 28]
usingStatements: ["Whizbang", "Whizbang.Orders", "System", "System.Threading.Tasks"]
}
// Your C# code here
```
````

**Metadata Fields**:

- **title**: Short descriptive title for the example
- **description**: What the example demonstrates
- **framework**: .NET version (e.g., "NET6", "NET8")
- **category**: Type of example (e.g., "API", "Domain Logic", "Data Access")
- **difficulty**: BEGINNER, INTERMEDIATE, or ADVANCED
- **tags**: Array of searchable tags
- **githubUrl**: Link to full source (optional)
- **docsUrl**: Link to relevant documentation (optional)
- **nugetPackages**: Required NuGet packages
- **filename**: Suggested filename for the example
- **showLineNumbers**: true/false
- **highlightLines**: Array of line numbers to highlight
- **showLinesOnly**: Array of specific lines to show (for partial examples)
- **usingStatements**: List of required using statements (even if not shown in code)

**When to Use Enhanced Metadata**:

✅ **Use enhanced metadata for**:
- Complete, standalone examples
- Code that users will likely copy and use
- Examples demonstrating key library features
- Complex scenarios that benefit from additional context

❌ **Don't use enhanced metadata for**:
- Simple inline snippets
- Partial code fragments showing syntax only
- Quick demonstrations of a single concept

### Test-Driven Examples

**CRITICAL**: All complete code examples MUST have corresponding tests that verify they work.

#### Test Requirement

Every code example in documentation should:
1. **Have a working test** in the library's test project
2. **Reference the test** in enhanced metadata
3. **Be extracted from the test** (or test extracted from the example)

This ensures:
- Examples actually compile
- Examples work as documented
- Examples stay up-to-date with library changes
- Breaking changes caught immediately

#### Enhanced Metadata for Tests

Add test references to enhanced code block metadata:

````markdown
```csharp{
title: "Order Processing Service"
description: "Demonstrates order validation with error handling"
framework: "NET8"
category: "Domain Logic"
difficulty: "INTERMEDIATE"
tags: ["Orders", "Validation", "Error Handling"]
testFile: "OrderProcessorTests.cs"
testMethod: "ProcessOrderAsync_ValidOrder_SavesSuccessfully"
githubUrl: "https://github.com/whizbang-lib/whizbang/blob/main/tests/OrderProcessorTests.cs"
nugetPackages: ["Whizbang.Core", "Whizbang.Orders"]
filename: "OrderProcessor.cs"
}
// Code here
```
````

**New Metadata Fields**:
- **testFile**: Name of test file that validates this example
- **testMethod**: Specific test method that uses this code
- **githubUrl**: Link to actual test file in repository

#### Test Structure

Tests should follow this pattern:

```csharp
// tests/Documentation/OrderProcessorTests.cs
using Xunit;
using FluentAssertions;

namespace Whizbang.Tests.Documentation;

public class OrderProcessorTests {
    [Fact]
    public async Task ProcessOrderAsync_ValidOrder_SavesSuccessfully() {
        // Arrange - This is the example code from documentation
        var repository = new InMemoryOrderRepository();
        var processor = new OrderProcessor(repository);
        var order = new Order {
            Id = Guid.NewGuid(),
            CustomerId = "CUST001",
            Amount = 100m
        };

        // Act
        await processor.ProcessOrderAsync(order);

        // Assert
        var saved = await repository.GetByIdAsync(order.Id);
        saved.Should().NotBeNull();
        saved.Amount.Should().Be(100m);
    }
}
```

#### Documentation Example Extraction

The example in documentation should match the test's Arrange/Act sections:

**In Documentation**:
```csharp
var repository = new InMemoryOrderRepository();
var processor = new OrderProcessor(repository);
var order = new Order {
    Id = Guid.NewGuid(),
    CustomerId = "CUST001",
    Amount = 100m
};

await processor.ProcessOrderAsync(order);
```

This code is verified by the test, so we know it works.

#### Test Organization

Organize tests for documentation examples:

```
tests/
├── Whizbang.Tests/
│   ├── Documentation/              # Tests for documentation examples
│   │   ├── OrderProcessorTests.cs
│   │   ├── AggregateTests.cs
│   │   └── ProjectionTests.cs
│   └── Unit/                       # Regular unit tests
│       └── ...
```

Keep documentation example tests separate from unit tests:
- **Purpose**: Validate documentation examples work
- **Style**: Match documentation style (readable, complete)
- **Naming**: Include `_ExampleFrom_` in test names to indicate documentation linkage

#### Validation Process

Before merging documentation:

1. **Locate Test**: Find the test referenced in metadata
2. **Run Test**: Verify test passes
3. **Compare Code**: Ensure example matches test's Arrange/Act
4. **Check Metadata**: Verify testFile and testMethod are correct

#### When Tests Don't Exist Yet

If adding documentation for unreleased features (Roadmap):

1. **Create skeleton tests** marked as `[Fact(Skip = "Roadmap feature")]`
2. **Reference tests in metadata** even though they're skipped
3. **When implementing**: Enable tests and verify examples still match
4. **Before moving from Roadmap**: All tests must pass

Example:

```csharp
[Fact(Skip = "Roadmap feature - Event sourcing not yet implemented")]
public async Task ApplyEvent_ValidEvent_AddsToEventStream() {
    // This example will work when feature is implemented
    var aggregate = new OrderAggregate();
    var @event = new OrderPlacedEvent(Guid.NewGuid(), "CUST001");

    aggregate.ApplyEvent(@event);

    aggregate.UncommittedEvents.Should().Contain(@event);
}
```

### Complete and Runnable

Every example must include ALL necessary context:

✅ **Good - Complete Example**:

```csharp
using System;
using System.Threading.Tasks;
using Whizbang;

namespace MyApp.Orders;

public class OrderProcessor {
    private readonly IOrderRepository _repository;

    public OrderProcessor(IOrderRepository repository) {
        _repository = repository;
    }

    public async Task ProcessOrderAsync(Order order) {
        if (order == null) {
            throw new ArgumentNullException(nameof(order));
        }

        // Validate order
        order.Validate();

        // Save to repository
        await _repository.SaveAsync(order);
    }
}
```

❌ **Bad - Incomplete Fragment**:

```csharp
ProcessOrderAsync(order);  // Where does order come from? What type?
```

### Using Directives

- Always include ALL required `using` statements
- Show which NuGet packages are needed in comments if not obvious

```csharp
using Whizbang;                    // Install: Whizbang.Core
using Whizbang.EventSourcing;      // Install: Whizbang.EventSourcing
using System;
using System.Threading.Tasks;
```

### Naming Conventions

Follow Microsoft C# conventions:

- **PascalCase**: Types, methods, properties, public fields, namespaces
- **camelCase**: Parameters, local variables, private fields
- **Interfaces**: Prefix with `I` (e.g., `IAggregate`, `IRepository`)
- **Async methods**: Suffix with `Async` (e.g., `ProcessOrderAsync`)
- **Private fields**: Prefix with `_` (e.g., `_repository`)

### Error Handling

Show appropriate error handling:

✅ **Good - Proper Error Handling**:

```csharp
public async Task<Order> GetOrderAsync(Guid orderId) {
    if (orderId == Guid.Empty) {
        throw new ArgumentException("Order ID cannot be empty", nameof(orderId));
    }

    try {
        var order = await _repository.GetByIdAsync(orderId);

        if (order == null) {
            throw new OrderNotFoundException(orderId);
        }

        return order;
    } catch (RepositoryException ex) {
        _logger.LogError(ex, "Failed to retrieve order {OrderId}", orderId);
        throw;
    }
}
```

❌ **Bad - Swallowing Exceptions**:

```csharp
try {
    var order = await _repository.GetByIdAsync(orderId);
} catch { }  // Silent failure
```

❌ **Bad - No Error Handling**:

```csharp
var order = await _repository.GetByIdAsync(orderId);
order.Process();  // What if order is null?
```

### Comments

Use comments to explain **why**, not **what**:

✅ **Good**:

```csharp
// Apply event sourcing to maintain full audit trail
ApplyEvent(new OrderPlacedEvent(order.Id, order.CustomerId));
```

❌ **Bad**:

```csharp
// Apply event
ApplyEvent(new OrderPlacedEvent(order.Id, order.CustomerId));
```

Keep comments concise and focused on key concepts:

✅ **Good**:

```csharp
// Aggregates must be loaded in their entirety to maintain consistency
var aggregate = await _repository.LoadAggregateAsync(id);
```

❌ **Bad**:

```csharp
// This method loads the aggregate from the repository by its ID
// and returns it as an Aggregate object. The repository uses the
// ID to find the aggregate in the database and then reconstructs
// it from the stored events...
```

## Markdown Best Practices

### Heading Hierarchy

Use headings properly:

- **H1 (`#`)**: Document title only (matches frontmatter title) - ONE per file
- **H2 (`##`)**: Major sections
- **H3 (`###`)**: Subsections
- **H4 (`####`)**: Details (use sparingly)

Never skip heading levels (don't jump from H2 to H4).

### Code Blocks

Always specify the language:

✅ **Good**:

````markdown
```csharp
public class Order { }
```
````

❌ **Bad**:

````markdown
```
public class Order { }
```
````

### Lists

Use lists for multiple related items:

```markdown
- Item one
- Item two
- Item three
```

Use numbered lists for sequential steps:

```markdown
1. First step
2. Second step
3. Third step
```

### Emphasis

- Use **bold** for emphasis and important terms
- Use *italic* sparingly for subtle emphasis
- Use `code` for inline code, variables, method names, types

### Links

- Use descriptive link text: `[Aggregates documentation](./aggregates.md)`
- Not: `Click [here](./aggregates.md) for aggregates`
- Use relative paths for internal links
- Test links after moving files

## Documentation Review Checklist

Before merging documentation changes, verify:

### Code Quality

- [ ] All examples include necessary `using` statements
- [ ] Examples follow C# naming conventions (PascalCase, camelCase)
- [ ] Examples follow `CODE_SAMPLES.editorconfig` (K&R/Egyptian braces)
- [ ] Examples use current library APIs (not deprecated)
- [ ] Error handling is appropriate for the scenario
- [ ] Comments explain key concepts, not syntax
- [ ] Examples would compile if extracted
- [ ] No pseudo-code or incomplete fragments

### Test Verification

- [ ] Complete examples have corresponding tests
- [ ] `testFile` metadata references actual test file
- [ ] `testMethod` metadata references specific test
- [ ] Test passes in CI/CD
- [ ] Example code matches test's Arrange/Act sections
- [ ] Test is in `tests/Documentation/` directory
- [ ] For roadmap features, skeleton tests exist with `[Fact(Skip = "...")]`

### Completeness

- [ ] Public APIs are documented
- [ ] Concepts have clear explanations
- [ ] Examples are provided for each concept
- [ ] Best practices are covered
- [ ] Common errors/pitfalls are addressed
- [ ] Related documentation is linked

### Accuracy

- [ ] Frontmatter is complete (title, category, order)
- [ ] Examples match current library version
- [ ] No outdated API usage
- [ ] Links are valid (no 404s)
- [ ] Technical details are correct

### Style

- [ ] Terminology is consistent across docs
- [ ] Voice and tone match guidelines
- [ ] Heading hierarchy is correct
- [ ] Code blocks have language specified
- [ ] Markdown is properly formatted

### Roadmap Specific

If documentation is for unreleased features:

- [ ] File is in `src/assets/docs/Roadmap/` directory
- [ ] Frontmatter has `unreleased: true`
- [ ] Frontmatter has `status` (planned/in-development/experimental)
- [ ] Frontmatter has `target_version`
- [ ] Warning banner explains feature is unreleased
- [ ] Examples are clearly marked as intended API

## Example Validation Process

To ensure examples remain accurate:

### Manual Validation

1. **Extract Examples**: Pull all code examples from documentation
2. **Check Compilation**: Verify examples would compile conceptually
3. **Verify APIs**: Ensure examples use current, non-deprecated APIs
4. **Test Patterns**: Confirm examples follow current best practices
5. **Check Links**: Validate cross-references and external links

### When to Validate

- **Before merging**: Every documentation change
- **Weekly**: Recently changed documentation
- **Monthly**: Random sample of examples
- **Per release**: All examples against new library version
- **Per breaking change**: All affected examples

## Common Mistakes to Avoid

### Incomplete Examples

❌ **Don't**:

```csharp
aggregate.Apply(event);
```

✅ **Do**:

```csharp
using Whizbang;

namespace MyApp.Domain;

public class OrderAggregate : Aggregate {
    public void PlaceOrder(Order order) {
        var @event = new OrderPlacedEvent(order.Id, order.CustomerId);
        Apply(@event);
    }
}
```

### Outdated Content

- Regularly review documentation for deprecated APIs
- Update examples when library changes
- Remove examples for removed features
- Test examples against current version

### Missing Context

❌ **Don't**: Show only the "interesting" part
✅ **Do**: Show complete context including setup and teardown

### Over-Simplification

❌ **Don't**: Use pseudo-code or "simplified" examples that won't compile
✅ **Do**: Show real, working code even if it's longer

### Ignoring Errors

❌ **Don't**: Omit error handling to keep examples short
✅ **Do**: Show realistic error handling patterns

## Writing for Different Audiences

### Beginners

- Explain concepts thoroughly
- Provide more context and background
- Show complete, copy-paste-able examples
- Link to foundational concepts
- Avoid jargon without explanation

### Intermediate Users

- Focus on patterns and best practices
- Show real-world scenarios
- Explain trade-offs and alternatives
- Reference advanced topics for deeper learning

### Advanced Users

- Provide technical details and edge cases
- Show performance considerations
- Document internal behavior when relevant
- Explain design decisions

## Documentation Types

### Tutorials

- Step-by-step instructions
- Complete working examples
- Expected outcomes at each step
- Clear prerequisites

### Concept Guides

- Explain what and why
- Use cases and scenarios
- Design rationale
- Related patterns

### API Reference

- Complete method signatures
- All parameters documented
- Return values explained
- Exceptions listed
- Usage examples

### How-To Guides

- Solve specific problems
- Practical, goal-oriented
- Assume baseline knowledge
- Quick and focused

## Maintaining Documentation

### When Code Changes

1. Search docs for affected types/methods
2. Update all examples using changed APIs
3. Revise explanations if behavior changed
4. Add migration guide for breaking changes
5. Verify examples still compile

### When Docs Change

1. Update search indices (automatic during build)
2. Check cross-references remain valid
3. Update related documentation links
4. Verify frontmatter is correct

### Version Management

- Tag documentation with library version
- Maintain compatibility matrix
- Provide links to previous versions
- Mark version-specific content

## Questions?

If you're unsure about:

- **Style**: Follow this guide and look at existing high-quality docs
- **Technical accuracy**: Ask library maintainers
- **Structure**: Use existing documentation as templates
- **Examples**: Prioritize completeness over brevity

When in doubt, err on the side of:

- More complete examples (vs fragments)
- More explanation (vs assuming knowledge)
- More error handling (vs omitting for brevity)
- More links to related concepts (vs isolated documentation)
