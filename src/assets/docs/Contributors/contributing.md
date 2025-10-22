---
title: Contributing to Whizbang
category: Contributors
order: 1
tags: contributing, development, open-source
---

# Contributing to Whizbang

Thank you for your interest in contributing to Whizbang! This guide will help you get started.

## Code of Conduct

We are committed to providing a welcoming and inclusive environment. Please read and follow our [Code of Conduct](./code-of-conduct.md).

## Ways to Contribute

### 🐛 Report Bugs

Found a bug? [Open an issue](https://github.com/whizbang-lib/whizbang/issues/new?template=bug_report.md) with:

- Clear description of the problem
- Steps to reproduce
- Expected vs actual behavior
- Whizbang version and .NET version
- Relevant code samples

### 💡 Suggest Features

Have an idea? [Start a discussion](https://github.com/whizbang-lib/whizbang/discussions/new?category=ideas) to:

- Describe the use case
- Explain why existing features don't solve it
- Propose an API design
- Discuss tradeoffs and alternatives

### 📝 Improve Documentation

Documentation improvements are always welcome:

- Fix typos or unclear explanations
- Add missing examples
- Improve code samples
- Translate to other languages

Documentation lives in this repository at `src/assets/docs/`.

### 🔨 Submit Code

Ready to code? Great! Please:

1. **Discuss first** - For non-trivial changes, open an issue or discussion first
2. **Follow conventions** - See [Coding Standards](./coding-standards.md)
3. **Write tests** - All new features need tests
4. **Update docs** - Documentation is part of the PR, not an afterthought
5. **Keep it focused** - One feature/fix per PR

## Development Setup

### Prerequisites

- **.NET 8.0 SDK** or later
- **Docker** (for running test databases)
- **Git**
- **Your favorite IDE** (Visual Studio, Rider, VS Code)

### Clone the Repository

```bash{
title: "Clone Repository"
description: "Clone the Whizbang repository locally"
category: "Contributors"
difficulty: "BEGINNER"
tags: ["Git", "Setup"]
}
git clone https://github.com/whizbang-lib/whizbang.git
cd whizbang
```

### Build the Solution

```bash{
title: "Build Solution"
description: "Build the entire Whizbang solution"
category: "Contributors"
difficulty: "BEGINNER"
tags: ["Build", "Setup"]
}
dotnet build
```

### Run Tests

```bash{
title: "Run Tests"
description: "Run unit and integration tests with optional coverage"
category: "Contributors"
difficulty: "BEGINNER"
tags: ["Testing", "Coverage"]
}
# Run all tests
dotnet test

# Run with coverage
dotnet test /p:CollectCoverage=true
```

### Start Local Infrastructure

For integration tests, you'll need Postgres and Kafka:

```bash{
title: "Start Infrastructure"
description: "Start Postgres and Kafka for integration tests"
category: "Contributors"
difficulty: "BEGINNER"
tags: ["Docker", "Infrastructure", "Testing"]
}
docker-compose up -d
```

This starts:
- Postgres on `localhost:5432`
- Kafka on `localhost:9092`
- Zookeeper on `localhost:2181`

## Project Structure

```
whizbang/
├── src/
│   ├── Whizbang.Core/              # Core mediator and messaging
│   ├── Whizbang.EventSourcing/     # Event store and aggregates
│   ├── Whizbang.Projections/       # Projection engine
│   ├── Whizbang.Messaging/         # Distributed messaging
│   ├── Whizbang.Postgres/          # Postgres driver
│   ├── Whizbang.Kafka/             # Kafka driver
│   ├── Whizbang.OpenTelemetry/     # Observability
│   └── Whizbang.Analyzers/         # Roslyn analyzers
├── tests/
│   ├── Whizbang.Core.Tests/
│   ├── Whizbang.EventSourcing.Tests/
│   ├── Integration.Tests/          # Multi-package integration tests
│   └── Documentation/              # Tests for documentation examples
├── samples/
│   ├── SimpleMediator/             # Basic mediator sample
│   ├── EventSourcedMonolith/       # Event sourcing sample
│   └── Microservices/              # Distributed messaging sample
└── docs/
    └── (Documentation website - separate repo)
```

## Branching Strategy

- `main` - Stable, released code
- `develop` - Active development
- `feature/xyz` - New features (branch from `develop`)
- `fix/xyz` - Bug fixes (branch from `develop` or `main` for hotfixes)

## Pull Request Process

### 1. Create a Branch

```bash{
title: "Create Feature Branch"
description: "Create a new feature branch from develop"
category: "Contributors"
difficulty: "BEGINNER"
tags: ["Git", "Branching"]
}
git checkout develop
git pull origin develop
git checkout -b feature/my-awesome-feature
```

### 2. Make Changes

- Write code following [Coding Standards](./coding-standards.md)
- Add tests for new functionality
- Update documentation
- Ensure all tests pass

### 3. Commit Changes

We use [Conventional Commits](https://www.conventionalcommits.org/):

```bash{
title: "Conventional Commits"
description: "Examples of conventional commit messages"
category: "Contributors"
difficulty: "BEGINNER"
tags: ["Git", "Commits", "Conventional Commits"]
}
git commit -m "feat: add support for SQL Server driver"
git commit -m "fix: correct optimistic concurrency check"
git commit -m "docs: add examples for projections"
```

Commit types:
- `feat:` - New feature
- `fix:` - Bug fix
- `docs:` - Documentation changes
- `test:` - Adding or updating tests
- `refactor:` - Code refactoring
- `perf:` - Performance improvements
- `chore:` - Build/tooling changes

### 4. Push and Create PR

```bash{
title: "Push Feature Branch"
description: "Push feature branch to origin for PR creation"
category: "Contributors"
difficulty: "BEGINNER"
tags: ["Git", "Push"]
}
git push origin feature/my-awesome-feature
```

Then open a PR on GitHub targeting `develop` branch.

### 5. PR Review

Maintainers will review your PR. Please:

- Respond to feedback promptly
- Make requested changes
- Keep the PR focused (split large PRs if needed)
- Be patient - we review PRs as quickly as we can

### 6. Merge

Once approved, a maintainer will merge your PR. Congrats! 🎉

## Testing Guidelines

### Unit Tests

- Test individual classes in isolation
- Use mocks for dependencies
- Fast execution (<100ms per test)
- Located in `*.Tests` projects

Example:

```csharp{
title: "Unit Test Example"
description: "Example unit test for domain logic"
framework: "NET8"
category: "Contributors"
difficulty: "INTERMEDIATE"
tags: ["Testing", "Unit Tests", "xUnit"]
nugetPackages: ["xunit", "FluentAssertions"]
usingStatements: ["Xunit", "FluentAssertions"]
showLineNumbers: false
}
public class OrderTests {
    [Fact]
    public void PlaceOrder_WithValidItems_EmitsOrderPlacedEvent() {
        // Arrange
        var order = new Order(customerId, items);

        // Act
        var events = order.GetUncommittedEvents();

        // Assert
        var placed = events.Should().ContainSingle().Which.Should().BeOfType<OrderPlaced>();
        placed.CustomerId.Should().Be(customerId);
    }
}
```

### Integration Tests

- Test multiple components together
- Use real databases (Docker containers)
- Slower execution (can be seconds)
- Located in `Integration.Tests` project

Example:

```csharp{
title: "Integration Test Example"
description: "Example integration test for event store"
framework: "NET8"
category: "Contributors"
difficulty: "INTERMEDIATE"
tags: ["Testing", "Integration Tests", "Event Store"]
nugetPackages: ["xunit", "FluentAssertions"]
usingStatements: ["System.Threading.Tasks", "Xunit", "FluentAssertions"]
showLineNumbers: false
}
public class EventStoreIntegrationTests : IClassFixture<PostgresFixture> {
    [Fact]
    public async Task AppendAndLoad_RoundTrip_PreservesEvents() {
        // Arrange
        var store = new PostgresEventStore(connectionString);
        var events = new[] { new OrderPlaced(...), new OrderShipped(...) };

        // Act
        await store.AppendAsync("Order-123", events);
        var loaded = await store.LoadStreamAsync("Order-123");

        // Assert
        loaded.Should().BeEquivalentTo(events);
    }
}
```

### Documentation Tests

**CRITICAL**: All complete code examples in documentation MUST have corresponding tests.

Located in `tests/Documentation/`, these tests:
- Extract code from documentation
- Verify examples compile
- Validate examples actually work
- Prevent documentation from becoming stale

See [Test-Driven Examples](./test-driven-examples.md) for details.

## Documentation Standards

### All Code Examples Must:

1. **Include complete `using` statements**
2. **Follow [CODE_SAMPLES.editorconfig](../CODE_SAMPLES.editorconfig)** (K&R/Egyptian braces)
3. **Use C# naming conventions** (PascalCase, camelCase, etc.)
4. **Be compilable** - No pseudo-code or placeholders
5. **Include metadata** for enhanced code blocks

### Example Format

````markdown
```csharp{
title: "Order Command Handler"
description: "Processes order placement commands"
framework: "NET8"
category: "Domain Logic"
difficulty: "INTERMEDIATE"
tags: ["Commands", "Handlers", "Orders"]
nugetPackages: ["Whizbang.Core"]
testFile: "OrderHandlerTests.cs"
testMethod: "HandlePlaceOrder_ValidOrder_ReturnsSuccess"
usingStatements: ["System", "System.Threading.Tasks", "Whizbang"]
showLineNumbers: true
}
using System;
using System.Threading.Tasks;
using Whizbang;

public class PlaceOrderHandler {
    public async Task<OrderPlacedResult> Handle(PlaceOrder command) {
        // Implementation
    }
}
```
````

See [DOCUMENTATION-STANDARDS.md](../DOCUMENTATION-STANDARDS.md) for complete guidelines.

## Coding Standards

See [Coding Standards](./coding-standards.md) for detailed C# conventions.

**Key Points**:

- **Brace Style**: K&R/Egyptian (opening brace on same line)
- **var**: Always use `var` for local variables
- **Naming**: PascalCase for public, camelCase for private, `_camelCase` for fields
- **Async**: Suffix async methods with `Async`
- **Nullability**: Enable nullable reference types
- **AOT-Safe**: No reflection tricks that break native AOT

## Design Philosophy

When contributing, keep these principles in mind:

1. **Events are the source of truth** - Always
2. **Simple things should be simple** - Don't overcomplicate the basic mediator scenario
3. **Complex things should be possible** - But with clear opt-in
4. **AOT-first** - All features must work with native AOT
5. **Driver-based** - Never lock users into a specific technology
6. **Observable by default** - Telemetry is built-in, not bolted-on
7. **Idempotent** - Message handlers should be safe to retry

## Getting Help

- **Questions?** Ask in [GitHub Discussions](https://github.com/whizbang-lib/whizbang/discussions)
- **Stuck?** Ping us on [Discord](https://discord.gg/whizbang) (coming soon)
- **Found a bug?** [Open an issue](https://github.com/whizbang-lib/whizbang/issues)

## Recognition

Contributors are recognized in:

- Release notes for the version their PR shipped in
- [CONTRIBUTORS.md](./CONTRIBUTORS.md) file
- Our gratitude and appreciation! 🙏

Thank you for making Whizbang better!
