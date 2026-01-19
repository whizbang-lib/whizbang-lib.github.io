# Roadmap Documentation

Document future and unreleased features while preventing user confusion.

## Purpose

Roadmap documentation enables **documentation-driven development** by allowing specifications to be written before implementation, while clearly distinguishing released features from planned ones.

## Directory Structure

```text
src/assets/docs/
├── Roadmap/              # Future/unreleased features ONLY
│   ├── event-sourcing.md
│   └── advanced-querying.md
├── Core concepts/        # Released features only
├── Tutorials/            # Released features only
└── Advanced/             # Released features only
```

**Rule**: If a feature is not yet available in a released version, it MUST be in `Roadmap/`. Once released, move it to the appropriate category.

## Roadmap Frontmatter Requirements

All roadmap documents MUST include these frontmatter fields:

```yaml
---
title: Event Sourcing Support
category: Roadmap
status: planned          # planned | in-development | experimental
target_version: 2.0.0
order: 1
unreleased: true         # CRITICAL - must be true
---
```

**Required Fields**:

- `title`: Feature name
- `category`: Must be "Roadmap"
- `status`: Current development status
- `target_version`: Version where feature will be available
- `unreleased`: Must be `true` (flags as unreleased)

## Status Definitions

### planned

- Specification written
- API designed
- Implementation not started
- Open for feedback and discussion

### in-development

- Implementation actively in progress
- API may still change based on implementation learnings
- Not ready for production use
- May have experimental packages available

### experimental

- Implementation complete but API may change
- Available in preview/beta packages
- Breaking changes possible
- Seeking feedback before stabilization

### released

- Feature is stable and available
- Once marked released, move file out of `Roadmap/`
- Update `unreleased: false`
- Move to appropriate category folder

## Visual Indicators

The Angular site will display roadmap documents with clear warnings:

### Warning Banner

```markdown
⚠️ FUTURE FEATURE - NOT YET RELEASED

This documentation describes a planned feature for v2.0.0.
This API is not available in the current release.

Status: In Development
Target Version: 2.0.0
```

### Chip Styling

- **Planned**: Orange chip with "Planned" label
- **In Development**: Blue chip with "In Development" label
- **Experimental**: Yellow chip with "Experimental" label
- Released features don't appear in Roadmap

### Navigation

- Roadmap appears as separate navigation category
- Clearly labeled "Roadmap (Unreleased Features)"
- Visually distinct from released documentation

## Writing Roadmap Documentation

### API Design

Examples can be aspirational but should reflect intended final API:

```csharp
// This API doesn't exist yet, but shows intended design
using Whizbang.EventSourcing;

namespace MyApp.Domain;

public class OrderAggregate : EventSourcedAggregate {
    public void PlaceOrder(PlaceOrderCommand command) {
        // Intended API design - K&R/Egyptian braces
        var @event = new OrderPlacedEvent(command.OrderId, command.CustomerId);
        ApplyEvent(@event);
    }
}
```

### Clarity

- Be explicit that feature doesn't exist yet
- Explain the motivation for the feature
- Show intended use cases
- Invite feedback on design

### Flexibility

- Acknowledge API may change
- Note alternative designs being considered
- Welcome community input
- Don't over-promise on timelines

## Migration Process

When a roadmap feature is released:

### Steps

1. **Move File**

   ```bash
   # Move from Roadmap to appropriate category
   git mv src/assets/docs/Roadmap/event-sourcing.md \
          src/assets/docs/Core\ concepts/event-sourcing.md
   ```

2. **Update Frontmatter**

   ```yaml
   ---
   title: Event Sourcing Support
   category: Core concepts      # Changed from "Roadmap"
   order: 5                     # Set order within new category
   unreleased: false            # Changed from true
   # Remove status and target_version
   ---
   ```

3. **Update Content**

   - Remove "unreleased" warnings
   - Update examples to match actual released API
   - Add any implementation notes learned during development
   - Verify all examples work with released version

4. **Verify Examples**

   - Test all code examples against released library
   - Ensure examples compile and run
   - Validate best practices are still current

5. **Update Search Indices**
   - Re-run build to regenerate search indices
   - Verify doc appears in normal search (not roadmap)
   - Check MCP server resources updated

## Roadmap Benefits

### Benefits for Users

- Clear distinction between available and planned features
- Visibility into library direction
- Opportunity to provide feedback on designs
- No confusion about what's actually available

### Benefits for Developers

- Design APIs in documentation first
- Get feedback before implementing
- Reference during development
- Living spec that becomes user docs

### Benefits for AI Assistants

- Clear context on what's available vs planned
- Can reference roadmap during library development
- Understand future direction
- Avoid suggesting unreleased features to users

## Good Roadmap Doc Example

Example of a well-structured roadmap document:

```markdown
---
title: Event Sourcing Support
category: Roadmap
status: in-development
target_version: 2.0.0
unreleased: true
---

# Event Sourcing Support

⚠️ This feature is currently in development and not available in released versions.

## Overview

Event sourcing will allow aggregates to be persisted as sequences of events...

## Intended API

```csharp
using Whizbang.EventSourcing;

// Note: This API is planned and may change
public class OrderAggregate : EventSourcedAggregate
{
    // ... implementation
}
```

## Status

- **Current Status**: In Development
- **Target Version**: 2.0.0
- **Expected**: Q2 2025

## Feedback

We welcome feedback on this design! [Open an issue](https://github.com/...) with suggestions.
```