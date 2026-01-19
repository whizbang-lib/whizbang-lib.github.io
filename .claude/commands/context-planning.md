Load planning system context for complex features.

Read this file to understand the planning system:
- ai-docs/planning-system.md - Development planning system and requirements

Planning system overview:
- Use `plans/` folder for complex feature development
- Create dedicated plan document for multi-step features
- Track progress, decisions, and test counts

Plan document structure:
```markdown
# Feature Name

## Overview
Brief description of feature

## Current Status
- Phase: Design / Implementation / Testing / Complete
- Progress: X%
- Blockers: None / List blockers

## Design
High-level design approach

## Implementation Checklist
- [ ] Task 1
- [ ] Task 2

## Testing
- Unit tests: X written, Y passing
- Integration tests: X written, Y passing

## Changelog
- 2025-01-05: Completed phase 1
```

When to create a plan:
- Feature requires 5+ steps
- Cross-cutting changes
- Architecture changes
- Significant refactoring

Use this command when:
- Planning complex features
- Need structured approach
- Tracking multi-phase work
- Documenting design decisions
