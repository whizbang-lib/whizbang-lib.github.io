# Architectural Decision Records (ADRs)

This folder contains architectural decision records documenting key design choices made during Whizbang's development.

## Purpose

ADRs capture:
- **Context**: Why the decision was needed
- **Options Considered**: Alternative approaches evaluated
- **Decision**: What was chosen and why
- **Consequences**: Trade-offs and implications

## Documents

### Core Architecture Decisions
- [**stream-id-vs-where-clause.md**](stream-id-vs-where-clause.md) - Why Whizbang chose where-clause explosion over traditional stream IDs
- [**sequence-leasing-strategy.md**](sequence-leasing-strategy.md) - Decision to implement sequence leasing for ordering guarantees
- [**projection-result-framework.md**](projection-result-framework.md) - Why ProjectionResult provides declarative operations

### Technology Choices
- [**storage-engine-selection.md**](storage-engine-selection.md) - Database and storage technology decisions
- [**source-generation-approach.md**](source-generation-approach.md) - Why source generation over reflection
- [**async-patterns.md**](async-patterns.md) - Async/await patterns and performance considerations

### Comparison with Other Frameworks
- [**marten-comparison.md**](marten-comparison.md) - Detailed comparison with MartenDB approach
- [**event-store-comparison.md**](event-store-comparison.md) - How Whizbang differs from EventStore
- [**mediatr-comparison.md**](mediatr-comparison.md) - Command/query handling differences

## Decision Status

Each ADR has a status:
- **Proposed**: Under consideration
- **Accepted**: Implemented
- **Deprecated**: No longer recommended
- **Superseded**: Replaced by newer decision

## Writing ADRs

When documenting new decisions:

1. **Use the template**: Follow the established ADR format
2. **Provide context**: Explain the problem being solved
3. **Show alternatives**: Document what else was considered
4. **Explain trade-offs**: Be honest about downsides
5. **Include examples**: Show concrete code implications
6. **Update when changed**: Mark as deprecated/superseded when no longer valid

## Template

```markdown
# ADR-XXX: [Decision Title]

## Status
[Proposed | Accepted | Deprecated | Superseded by ADR-XXX]

## Context
[What problem are we solving? What constraints exist?]

## Options Considered

### Option 1: [Name]
[Description, pros, cons]

### Option 2: [Name]  
[Description, pros, cons]

## Decision
[What we chose and why]

## Consequences
[Positive and negative impacts of this decision]

## Implementation Notes
[Concrete details about how this decision affects code]
```