# Documentation Standards & Anti-Patterns

## C# Coding Standards for Examples

### EditorConfig Compliance

**CRITICAL**: All code examples MUST follow [`CODE_SAMPLES.editorconfig`](../CODE_SAMPLES.editorconfig).

**Key Conventions**:
- **Brace Style**: K&R/Egyptian (opening brace on same line, not Allman style)
- **var Usage**: Always use `var` for local variables
- **Naming**:
  - PascalCase: Types, methods, properties, public fields
  - camelCase: Parameters, local variables
  - `_camelCase`: Private fields (underscore prefix)
  - `IPascalCase`: Interfaces (I prefix)
  - `MethodAsync`: Async methods (Async suffix)
  - `ALL_CAPS`: Constants (with underscores)
- **Namespaces**: File-scoped (not block-scoped)
- **Using Directives**: Outside namespace, System directives first
- **Modern C#**: Pattern matching, null coalescing, index/range operators, file-scoped namespaces

### Enhanced Code Block Metadata

The site supports rich metadata for examples. Use this format for complete, standalone examples:

````markdown
```csharp{
title: "Order Processing Service"
description: "Demonstrates order validation with error handling"
framework: "NET8"
category: "Domain Logic"
difficulty: "INTERMEDIATE"
tags: ["Orders", "Validation", "Error Handling"]
nugetPackages: ["Whizbang.Core", "Whizbang.Orders"]
filename: "OrderProcessor.cs"
showLineNumbers: true
highlightLines: [12, 15]
usingStatements: ["Whizbang", "System", "System.Threading.Tasks"]
}
// Code here
```
````

See [DOCUMENTATION-STANDARDS.md](../DOCUMENTATION-STANDARDS.md) for complete metadata field documentation.

**Important**: Enhanced code block metadata is automatically used for SEO structured data generation. Code examples with rich metadata will appear in search engine rich results.

### Test-Driven Examples

**CRITICAL**: All complete code examples MUST have corresponding tests that verify they work.

Add test references to metadata:

```csharp{
title: "Order Processing Example"
testFile: "OrderProcessorTests.cs"
testMethod: "ProcessOrderAsync_ValidOrder_SavesSuccessfully"
githubUrl: "https://github.com/whizbang/library/blob/main/tests/Documentation/OrderProcessorTests.cs"
}
```

**Requirements**:
- Examples extracted from or validated by tests in `tests/Documentation/`
- Tests must pass in CI/CD
- Roadmap features have skeleton tests with `[Fact(Skip = "Roadmap feature")]`
- Breaking changes update tests immediately

### Complete Examples

- Include ALL `using` statements required
- Show full class/method context, not just fragments
- Provide complete, copy-paste-able code
- Use file-scoped namespaces
- Follow K&R/Egyptian brace style
- Reference corresponding test in metadata

### Error Handling

- Show error handling for important scenarios
- Document exceptions that can be thrown
- Don't swallow exceptions in examples
- Use meaningful error messages

## Documentation Standards

### Required Elements

Every documentation page must have:

- **Title**: Clear, descriptive H1 heading
- **Frontmatter**: Complete metadata (title, category, order)
- **Concept Explanation**: What it is and why it matters
- **Code Examples**: Complete, runnable C# code
- **Best Practices**: Recommended patterns
- **Error Scenarios**: Common pitfalls and how to avoid them

### Frontmatter Requirements

```yaml
---
title: Getting Started          # Required - display title
slug: getting-started           # Optional - URL slug (auto-generated from filename if omitted)
category: Introduction          # Required - navigation category
order: 1                        # Required - sort order within category
tags: beginner, tutorial        # Optional - for search/filtering
description: Brief description   # Optional - defaults to generic description if omitted
---
```

**Note**: The `slug` field is optional and will be auto-generated from the filename if omitted. The documentation generation script (`src/scripts/gen-docs-list.mjs`) recursively discovers all markdown files in `src/assets/docs/` including subdirectories, so files can be organized into folders (e.g., `Projections/`, `Commands/`, `Tutorials/`) for better structure.

### SEO and Structured Data

**Automatic Generation**: Every documentation page automatically generates comprehensive structured data (JSON-LD schema.org markup) for enhanced SEO and search engine rich results. The system generates:

- **WebSite schema**: Site-level metadata with search actions
- **Organization schema**: Publisher information with branding
- **Article schemas**: Content-aware types (TechArticle/HowTo/APIReference) based on content analysis
- **BreadcrumbList schema**: Navigation hierarchy from breadcrumb service
- **SoftwareSourceCode schemas**: Automatically extracted from enhanced code blocks

**Content-Aware Schema Selection**:
- **HowTo**: For tutorials, getting started guides, and step-by-step content
- **APIReference**: For pages with "api" or "reference" in title/category/tags
- **TechArticle**: Default for general technical documentation

**Optimization Tips**:
- Use descriptive `title` and `description` in frontmatter for better search results
- Add relevant `tags` for keyword optimization
- Use enhanced code block metadata for rich code example results
- Ensure breadcrumb navigation is logical for site hierarchy

## Anti-Patterns to Avoid

### ❌ Incomplete Code Examples

Don't show code fragments without context:

```csharp
// ❌ BAD - Missing context
aggregate.Apply(event);  // What type is aggregate? Where is Apply defined?
```

Show complete, compilable examples:

```csharp
// ✅ GOOD - Complete context with K&R/Egyptian braces
using Whizbang;

namespace MyApp.Domain;

public class OrderAggregate : Aggregate {
    public void PlaceOrder(Order order) {
        var @event = new OrderPlacedEvent(order.Id, order.CustomerId);
        Apply(@event);
    }
}
```

### ❌ Pseudo-Code or Simplified Examples

Don't use pseudo-code that won't compile. Use real, working code.

### ❌ Outdated Examples

- Don't let examples use deprecated APIs
- Update examples when library APIs change
- Version-check examples regularly
- Remove examples for removed features

### ❌ Missing Error Handling

Don't ignore error scenarios in examples. Show realistic error handling.

### ❌ Concepts Without Examples

Every concept MUST have at least one code example. Explanations alone are insufficient.

### ❌ Examples Without Explanation

Every code example MUST have accompanying explanation. Code dumps without context are confusing.

### ❌ Copy-Paste Without Understanding

Don't include boilerplate code you don't understand. Every line should serve a purpose.

## Validation Requirements

Before merging documentation:

### Code Quality Checks

- [ ] All examples include necessary `using` statements
- [ ] Examples follow C# naming conventions
- [ ] Examples follow `CODE_SAMPLES.editorconfig` (K&R/Egyptian braces)
- [ ] Examples use current library APIs (not deprecated)
- [ ] Error handling is appropriate for the scenario
- [ ] Comments explain key concepts, not syntax

### Test Verification

- [ ] Complete examples have corresponding tests
- [ ] `testFile` and `testMethod` metadata present
- [ ] Tests pass in CI/CD
- [ ] Example code matches test's Arrange/Act sections
- [ ] Tests located in `tests/Documentation/` directory
- [ ] Roadmap features have skeleton tests with `[Fact(Skip = "...")]`

### Completeness Checks

- [ ] Public APIs are documented
- [ ] Concepts have explanations
- [ ] Examples are provided
- [ ] Best practices are covered
- [ ] Common errors are addressed

### Consistency Checks

- [ ] Terminology is consistent across docs
- [ ] Naming patterns match library conventions
- [ ] Code style is uniform (K&R/Egyptian braces)
- [ ] Frontmatter is complete and correct

## Regression Prevention

### Change Impact Analysis

When changing library APIs, immediately check documentation impact:

1. **Identify Affected Documentation**
   - Search docs for type names, method names, namespaces
   - Check tutorials that demonstrate the changed feature
   - Review getting started guides
   - Examine advanced topics using the API

2. **Update All Affected Examples**
   - Fix code examples to use new API
   - Update method signatures
   - Change parameter names/types
   - Add/remove using statements as needed

3. **Update Explanations**
   - Revise concept descriptions if behavior changed
   - Update best practices if patterns changed
   - Modify warnings if pitfalls changed
   - Refresh screenshots or diagrams

4. **Add Migration Guidance**
   - Document what changed and why
   - Show before/after examples
   - Explain how to upgrade existing code
   - Provide timeline for deprecated features

### Breaking Changes

Handle breaking changes with care:

1. **Clear Announcement**
   - Mark breaking changes prominently
   - Explain what broke and why
   - Provide justification for the change

2. **Migration Guide**
   - Step-by-step upgrade instructions
   - Before/after code examples
   - Common migration scenarios
   - Troubleshooting tips

3. **Timeline**
   - When change was introduced
   - Deprecation period (if applicable)
   - When old API will be removed
   - Support timeline

### Continuous Monitoring

Prevent regressions through ongoing vigilance:

- Review documentation changes with code changes
- Verify examples match new API
- Check for broken cross-references
- Validate frontmatter is complete
- Monitor issues/questions about documentation
- Track confusion patterns
- Address frequently misunderstood examples
- Update docs based on real user problems