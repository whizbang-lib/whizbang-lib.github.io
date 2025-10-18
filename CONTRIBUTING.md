# Contributing to Whizbang

Thank you for your interest in contributing to Whizbang! This guide explains our documentation-first development workflow and how to contribute effectively.

## Documentation-First Workflow

Whizbang follows a **documentation-driven development** approach where documentation is written before or during implementation, not after.

### Why Documentation First?

- **Better API Design**: If you can't explain it clearly, the API probably needs work
- **Catches Issues Early**: Writing examples reveals usability problems before coding
- **Living Specification**: Documentation becomes the spec for implementation
- **Higher Quality**: Forces thinking through edge cases and error scenarios
- **Better Outcomes**: Users get accurate, helpful documentation from day one

### The Process

```
1. Design API
   ↓
2. Write Documentation & Examples
   ↓
3. Implement Feature
   ↓
4. Validate Examples Work
   ↓
5. Review (Code + Docs Together)
```

## Contributing to Documentation

### For Documentation-Only Changes

If you're fixing typos, improving explanations, or adding examples:

1. **Fork the repository**
2. **Create a branch**: `git checkout -b docs/improve-aggregates-guide`
3. **Make your changes** following [DOCUMENTATION-STANDARDS.md](./DOCUMENTATION-STANDARDS.md)
4. **Test locally**:
   ```bash
   npm start  # Starts dev server at http://localhost:4200
   ```
5. **Verify search indices update**:
   ```bash
   npm run search-index
   ```
6. **Submit pull request** with description of changes

### Documentation Review Checklist

Before submitting documentation changes:

- [ ] All code examples are complete (include `using` statements)
- [ ] Examples follow C# naming conventions
- [ ] Examples follow `CODE_SAMPLES.editorconfig` (K&R/Egyptian braces)
- [ ] Frontmatter is complete (title, category, order)
- [ ] Links are valid
- [ ] Examples would compile conceptually
- [ ] No deprecated APIs used
- [ ] Appropriate error handling shown
- [ ] Markdown is properly formatted

**Test Requirements**:
- [ ] Complete examples have corresponding tests in library's `tests/Documentation/`
- [ ] Enhanced metadata includes `testFile` and `testMethod`
- [ ] Tests pass locally and in CI/CD
- [ ] Example code matches test's Arrange/Act sections

See [DOCUMENTATION-STANDARDS.md](./DOCUMENTATION-STANDARDS.md) for complete guidelines.

## Contributing New Features

### For Library Features

When contributing code to the Whizbang library (separate repository):

1. **Discuss First**: Open an issue describing the feature
2. **Write Roadmap Documentation**:
   - Create `src/assets/docs/Roadmap/your-feature.md` in THIS repo
   - Set `unreleased: true` in frontmatter
   - Include complete API design and examples
   - Explain motivation and use cases

3. **Get Feedback**: Community reviews the proposed API
4. **Implement**: Build the feature in library repo
5. **Update Documentation**:
   - Move from `Roadmap/` to appropriate category
   - Set `unreleased: false`
   - Verify examples work with implementation
   - Update any learned implementation details

6. **Submit Pull Requests**:
   - Library code PR (in library repo)
   - Documentation PR (in this repo)
   - Both reference each other

### Feature Documentation Requirements

Every feature MUST include:

- **Concept Explanation**: What it is and why it matters
- **Complete Examples**: Runnable C# code showing usage
- **API Reference**: All public types, methods, properties documented
- **Best Practices**: Recommended patterns
- **Error Scenarios**: Common pitfalls and how to avoid them
- **Working Tests**: All examples validated by tests in `tests/Documentation/`

### Test-Driven Documentation

**CRITICAL**: Examples must be backed by working tests.

**Process**:

1. **Write Test First** (or alongside documentation):
   ```csharp
   // tests/Documentation/OrderProcessorTests.cs
   [Fact]
   public async Task ProcessOrderAsync_ValidOrder_SavesSuccessfully() {
       // Arrange - This becomes your documentation example
       var processor = new OrderProcessor(repository);
       var order = new Order { Id = Guid.NewGuid(), Amount = 100m };

       // Act
       await processor.ProcessOrderAsync(order);

       // Assert
       var saved = await repository.GetByIdAsync(order.Id);
       saved.Should().NotBeNull();
   }
   ```

2. **Extract Example** for documentation from test's Arrange/Act

3. **Add Metadata** referencing the test:
   ````markdown
   ```csharp{
   title: "Processing an Order"
   testFile: "OrderProcessorTests.cs"
   testMethod: "ProcessOrderAsync_ValidOrder_SavesSuccessfully"
   }
   // Example code from test
   ```
   ````

4. **Verify Test Passes** in CI/CD

**For Roadmap Features**:

Create skeleton tests with `[Fact(Skip = "Roadmap feature")]`:

```csharp
[Fact(Skip = "Roadmap feature - Event sourcing not implemented")]
public async Task ApplyEvent_ValidEvent_AddsToEventStream() {
    // Example code that will work when implemented
    var aggregate = new OrderAggregate();
    aggregate.ApplyEvent(new OrderPlacedEvent(...));
    // Assert...
}
```

### Time Allocation

Plan to spend **30-40% of time on documentation** (including tests):

- 3 days implementation → +1-2 days documentation + tests
- 1 week implementation → +2-3 days documentation + tests

Documentation (with tests) is not "extra work" - it's part of the definition of done.

## Making Changes

### For New Features

**1. Create Roadmap Documentation** (Before Coding):

```yaml
---
title: Event Sourcing Support
category: Roadmap
status: planned
target_version: 2.0.0
unreleased: true
---

# Event Sourcing Support

⚠️ This feature is planned and not yet available.

## Overview
Event sourcing will allow aggregates to be persisted as sequences of events...

## Proposed API
```csharp
using Whizbang.EventSourcing;

public class OrderAggregate : EventSourcedAggregate
{
    public void PlaceOrder(PlaceOrderCommand command)
    {
        var @event = new OrderPlacedEvent(command.OrderId);
        ApplyEvent(@event);
    }
}
```
```

**2. Implement the Feature**:

- Follow roadmap documentation as specification
- Adjust API if implementation reveals better design
- Keep documentation in sync with changes

**3. Migrate Documentation**:

```bash
# Move from Roadmap to appropriate category
git mv src/assets/docs/Roadmap/event-sourcing.md \
       src/assets/docs/Core\ concepts/event-sourcing.md
```

Update frontmatter:

```yaml
---
title: Event Sourcing Support
category: Core concepts      # Changed from Roadmap
order: 5
unreleased: false            # Changed from true
# Remove status and target_version
---
```

**4. Validate Examples**:

- Test all code examples against implemented feature
- Ensure examples compile and run
- Verify best practices are still applicable
- Fix any discrepancies between docs and implementation

### For API Changes

**1. Identify Impact**:

```bash
# Search for affected documentation
grep -r "ProcessOrder" src/assets/docs/
```

**2. Update All Affected Docs**:

- Fix code examples to use new API
- Update method signatures
- Change parameter names/types
- Add/remove using statements

**3. Add Migration Guide** (if breaking):

Create `migration-v1-to-v2.md`:

```markdown
# Migrating from v1.x to v2.0

## Breaking Changes

### ProcessOrder is now async

**Old API (v1.x)**:
```csharp
var result = processor.ProcessOrder(order);
```

**New API (v2.0)**:
```csharp
var result = await processor.ProcessOrderAsync(order);
```

**Why**: Enables async I/O for better scalability...
```

**4. Update Changelog**:

```markdown
## [2.0.0] - 2025-01-15

### Breaking Changes
- `ProcessOrder` is now `ProcessOrderAsync` for async support

### Migration
See [Migration Guide](./docs/migration-v1-to-v2.md)
```

### For Bug Fixes

**1. Check Documentation**:

- Is the bug mentioned in docs?
- Does documentation claim different behavior?

**2. Update if Needed**:

- Fix incorrect documentation
- Add example demonstrating fix if helpful
- Update troubleshooting section

**3. Link Documentation in PR**:

```markdown
## Bug Fix: Orders with zero quantity crash processor

Fixes #123

### Changes
- Added validation for zero quantity orders
- Updated error messages

### Documentation Updates
- Added error handling example to orders.md
- Updated troubleshooting section
```

## Pull Request Guidelines

### PR Title Format

- `docs: Improve aggregates documentation`
- `feat: Add event sourcing support`
- `fix: Correct async example in getting started`

### PR Description Should Include

1. **What Changed**: Clear description of changes
2. **Why**: Motivation for the change
3. **Documentation**: Link to affected documentation
4. **Testing**: How you tested the changes
5. **Breaking Changes**: If applicable
6. **Migration**: Steps for users to upgrade

### Example PR Description

```markdown
## Add Projection Support

Implements projection support for creating read models from event streams.

### What Changed
- Added `Projection` base class
- Implemented `ProjectionEngine` for event replay
- Created documentation in Roadmap

### Why
Users need a way to create denormalized read models for queries.

### Documentation
- Created roadmap documentation: `docs/Roadmap/projections.md`
- Includes complete API examples
- Explains projection lifecycle

### Testing
- Unit tests for projection engine
- Integration tests for event replay
- Examples validated against implementation

### Migration
No breaking changes - new feature only.
```

## Review Process

### What Reviewers Check

**Code**:

- Follows C# conventions
- Includes unit tests
- Handles errors appropriately
- Maintains backward compatibility (or documents breaking changes)

**Documentation**:

- Complete and accurate
- Examples are runnable
- Follows documentation standards
- Links to related concepts
- Frontmatter is correct

**Together**:

- Documentation matches implementation
- Examples use the actual API
- No discrepancies between docs and code
- Migration guide exists for breaking changes

### Response Time

- **Documentation PRs**: Usually reviewed within 2-3 days
- **Feature PRs**: May take 1-2 weeks depending on complexity
- **Bug fixes**: Usually reviewed within 1 week

### Addressing Feedback

- Respond to all comments
- Ask questions if unclear
- Make requested changes
- Update documentation if API changes during review

## Roadmap Features

### Creating Roadmap Documentation

For unreleased features:

1. Create in `src/assets/docs/Roadmap/`
2. Use frontmatter:
   ```yaml
   ---
   title: Your Feature
   category: Roadmap
   status: planned
   target_version: 2.0.0
   unreleased: true
   ---
   ```
3. Add warning banner
4. Show intended API (can be aspirational)
5. Invite feedback

### Status Lifecycle

```
planned → in-development → experimental → released
```

- **planned**: Spec exists, not started
- **in-development**: Actively building
- **experimental**: Built but may change
- **released**: Stable and available

When released, move from `Roadmap/` to appropriate category.

## Getting Help

### Questions?

- **Documentation questions**: Open an issue with `[docs]` prefix
- **Feature ideas**: Open an issue describing the proposal
- **Implementation help**: Ask in discussions or open draft PR

### Before Opening an Issue

1. **Search existing issues**: Your question may be answered
2. **Check documentation**: Answer may be in docs already
3. **Be specific**: Provide context, examples, error messages

### Issue Template

```markdown
## Description
Clear description of issue or question

## Context
- Whizbang version: 1.2.0
- .NET version: .NET 8
- Documentation page: link if applicable

## Expected Behavior
What you expected to happen

## Actual Behavior
What actually happened

## Steps to Reproduce
1. Step one
2. Step two
3. Issue occurs

## Code Example
```csharp
// Minimal example demonstrating issue
```
```

## Development Setup

### Documentation Site

```bash
# Clone repository
git clone https://github.com/whizbang/whizbang-lib.github.io.git
cd whizbang-lib.github.io

# Install dependencies
npm install

# Start development server
npm start

# Open http://localhost:4200
```

### Building

```bash
# Production build
npm run build

# Build search indices
npm run search-index
```

### Project Structure

```
src/assets/docs/          # Documentation markdown files
├── Roadmap/              # Unreleased features
├── Core concepts/        # Released features
├── Tutorials/            # Step-by-step guides
└── Advanced/             # Advanced topics

src/app/components/       # Angular components
src/scripts/              # Build scripts
plans/                    # Development plans
```

## Code of Conduct

- **Be respectful**: Treat everyone with respect
- **Be constructive**: Focus on improving the project
- **Be patient**: Reviewers are volunteers
- **Be helpful**: Help others when you can
- **Be professional**: Keep discussions focused and professional

## Recognition

Contributors will be:

- Listed in CONTRIBUTORS.md
- Mentioned in release notes for significant contributions
- Credited in documentation they write or significantly improve

## Questions?

If anything in this guide is unclear:

- Open an issue asking for clarification
- Suggest improvements to this guide
- Ask in discussions

We want contributing to be easy and welcoming. If something is confusing, let us know so we can improve!

---

Thank you for contributing to Whizbang! 🎉
