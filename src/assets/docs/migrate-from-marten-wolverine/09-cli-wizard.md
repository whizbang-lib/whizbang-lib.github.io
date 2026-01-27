---
title: CLI Migration Wizard
description: Interactive wizard for migrating from Marten/Wolverine to Whizbang
---

# CLI Migration Wizard

The `whizbang migrate` command provides an interactive wizard for migrating from Marten/Wolverine to Whizbang. It guides you through each decision, tracks progress, and supports reverting changes.

## Quick Start

```bash
# Launch the wizard (auto-detects migration state)
whizbang migrate

# Analyze codebase without making changes
whizbang migrate analyze ./src

# Start interactive migration
whizbang migrate apply ./src --interactive

# Resume from decision file
whizbang migrate apply ./src --decision-file decisions.json
```

## Main Menu

When you run `whizbang migrate`, the wizard shows a context-aware menu based on your migration state.

### Fresh Start (No Migration in Progress)

```
┌─────────────────────────────────────────────────────────────────┐
│  Whizbang Migration Wizard                                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Migrate from Marten/Wolverine to Whizbang                       │
│                                                                  │
│  [1] Analyze codebase             ○ Scan for patterns            │
│  [2] Start new migration          ○ Interactive wizard           │
│  [3] Load existing decisions      ○ From decision file           │
│  [4] Help                         ○ Documentation                │
│                                                                  │
│  Select option [1-4]: _                                         │
└─────────────────────────────────────────────────────────────────┘
```

### Migration in Progress

```
┌─────────────────────────────────────────────────────────────────┐
│  Whizbang Migration Wizard                                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Migration in progress detected!                                 │
│  Project: /src/MyProject                                         │
│  Started: 2026-01-18 14:30                                       │
│  Progress: 23/45 handlers, 0/12 projections                      │
│                                                                  │
│  What would you like to do?                                      │
│                                                                  │
│  [1] Continue migration           ▶ Resume where left            │
│  [2] Review/edit decisions        ○ Change choices               │
│  [3] Revert all changes           ○ Git reset + clean            │
│  [4] Start fresh                  ○ New migration                │
│  [5] View status                  ○ Detailed progress            │
│                                                                  │
│  Select option [1-5]: _                                         │
└─────────────────────────────────────────────────────────────────┘
```

## Interactive Wizard Mode

The interactive wizard walks you through each migration decision with code previews.

### Category Selection

```
┌─────────────────────────────────────────────────────────────────┐
│  Categories to Review                                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  [1] Routing Configuration        ▶ Start                       │
│  [2] Handlers (45 files)          ○ Pending                     │
│  [3] Projections (23 files)       ○ Pending                     │
│  [4] Event Store Operations (67)  ○ Pending                     │
│  [5] ID Generation (34 locations) ○ Pending                     │
│  [6] DI Registration (12)         ○ Pending                     │
│                                                                  │
│  Select category [1-6]: _                                       │
└─────────────────────────────────────────────────────────────────┘
```

### Domain Ownership Configuration

The wizard detects domain patterns in your codebase and asks which domains this service owns:

```
┌─────────────────────────────────────────────────────────────────┐
│  Domain Ownership Configuration                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  We detected these domain patterns in your codebase:            │
│                                                                  │
│  [x] orders (45 types, from namespace) (Recommended - most common)│
│  [ ] inventory (12 types, from namespace)                        │
│  [ ] shipping (8 types, from type names)                         │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Which domains does THIS service own?                           │
│  (Commands to owned domains route to this service)              │
│                                                                  │
│  Enter domain numbers to toggle (e.g., "1,2"), or:              │
│    [A] Accept current selection                                 │
│    [N] None - I'll configure manually                           │
│    [C] Custom - Enter domain names                              │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘

  Selection: _
```

### Inbox Strategy Selection

After domain ownership, configure how commands are routed to this service:

```
┌─────────────────────────────────────────────────────────────────┐
│  Inbox Routing Strategy                                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  How should commands be routed to this service?                 │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  [A] Shared Topic (Recommended)                                 │
│                                                                  │
│      All commands route to "whizbang.inbox" with broker-side    │
│      filtering. Fewer topics, relies on ASB/RabbitMQ filtering. │
│                                                                  │
│      Example: CreateOrder -> "whizbang.inbox" (filter: orders)  │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  [B] Domain Topics                                              │
│                                                                  │
│      Each domain has its own inbox topic.                       │
│      More topics, simpler routing logic.                        │
│                                                                  │
│      Example: CreateOrder -> "orders.inbox"                     │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Select option [A/B]: _                                         │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Decision Points

For each pattern found, you'll see the original code and conversion options:

```
┌─────────────────────────────────────────────────────────────────┐
│  Handler Migration [3/45]                                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  File: OrderHandler.cs:15                                        │
│                                                                  │
│  BEFORE:                                                         │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ public class OrderHandler : IHandle<CreateOrder> {         │ │
│  │   public async Task Handle(CreateOrder cmd, ...) { }       │ │
│  │ }                                                           │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  CONVERSION OPTIONS:                                             │
│                                                                  │
│  [A] Convert to IReceptor<CreateOrder> (Recommended)            │
│      ┌──────────────────────────────────────────────────────┐   │
│      │ public class OrderReceptor : IReceptor<CreateOrder>  │   │
│      │ { ... }                                               │   │
│      └──────────────────────────────────────────────────────┘   │
│                                                                  │
│  [B] Skip - I'll handle this manually                           │
│  [C] Apply to all similar handlers                              │
│                                                                  │
│  Select option [A/B/C]: _                                       │
└─────────────────────────────────────────────────────────────────┘
```

## Migration Warnings

The analyzer detects patterns that may require manual attention. These warnings help identify custom infrastructure that wraps or extends Marten/Wolverine.

### Warning Types

| Warning | Description |
|---------|-------------|
| **Custom Base Class** | Handler inherits from a non-standard base class (not `IHandle<T>`) |
| **Unknown Interface Parameter** | Handler method has an interface parameter that isn't a known Wolverine/Marten type |
| **Custom Context Parameter** | Handler has a parameter with "Context" in its name that may wrap infrastructure |
| **Nested Handler Class** | Handler is nested inside another class (affects discoverability) |

### Known Types (No Warning)

The analyzer recognizes these standard types and won't generate warnings:

**Wolverine Types:**
- `IHandle<T>`, `IHandle<T, TResult>`
- `IMessageBus`, `IMessageContext`, `MessageContext`

**Marten Types:**
- `IDocumentSession`, `IQuerySession`, `IDocumentStore`

**Standard Types:**
- `CancellationToken`, `ILogger`, `ILogger<T>`, `IServiceProvider`

### Custom Base Class Decisions

When a handler inherits from a custom base class, you decide how to handle it **per type** (not per instance):

```
┌─────────────────────────────────────────────────────────────────┐
│  Custom Base Class Detected                                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Found: BaseMessageHandler<T>                                    │
│  Used by: 5 handlers                                             │
│                                                                  │
│  Files:                                                          │
│    • src/Handlers/CreateOrderHandler.cs:12                      │
│    • src/Handlers/UpdateOrderHandler.cs:15                      │
│    • src/Handlers/DeleteOrderHandler.cs:10                      │
│    • src/Handlers/ShipOrderHandler.cs:8                         │
│    • src/Handlers/CancelOrderHandler.cs:11                      │
│                                                                  │
│  This base class may contain Marten/Wolverine infrastructure.   │
│  How should handlers using this base class be migrated?         │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  [A] Remove Inheritance (Recommended)                           │
│      Migrated handlers implement IReceptor directly.            │
│      Base class functionality must be reimplemented.            │
│                                                                  │
│  [B] Keep Inheritance                                           │
│      Migrated handlers keep the base class AND add IReceptor.   │
│      You must manually adapt the base class to work with        │
│      Whizbang. A TODO comment will be added.                    │
│                                                                  │
│  [C] Skip All                                                   │
│      Don't migrate handlers using this base class.              │
│      They will be left unchanged with a warning.                │
│                                                                  │
│  Select option [A/B/C]: _                                       │
└─────────────────────────────────────────────────────────────────┘
```

The decision applies to **all handlers** using that base class type.

### Unknown Interface Decisions

When a handler method has unknown interface parameters, you decide how to handle each interface type:

```
┌─────────────────────────────────────────────────────────────────┐
│  Unknown Interface Parameter Detected                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Found: IEventStoreContext                                       │
│  Used in: 8 handler methods                                      │
│                                                                  │
│  Example usage:                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ public Task Handle(CreateOrder cmd, IEventStoreContext ctx)│ │
│  │ {                                                          │ │
│  │   ctx.AppendEvent(new OrderCreated(...));                  │ │
│  │ }                                                          │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  This interface may wrap Marten/Wolverine infrastructure.       │
│  How should this parameter be handled?                          │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  [A] Map to Whizbang (Recommended if it wraps event store)     │
│      Replace with IEventStore parameter.                        │
│      Calls will be transformed to Whizbang equivalents.         │
│                                                                  │
│  [B] Keep and Inject                                            │
│      Keep the parameter, inject via DI.                         │
│      You must ensure IEventStoreContext is registered.          │
│                                                                  │
│  [C] Remove Parameter                                           │
│      Remove the parameter entirely.                             │
│      You must reimplement the functionality.                    │
│                                                                  │
│  [D] Skip All                                                   │
│      Don't migrate handlers using this interface.               │
│                                                                  │
│  Select option [A/B/C/D]: _                                     │
└─────────────────────────────────────────────────────────────────┘
```

### Nested Handler Warning

Handlers nested inside static classes are flagged for review:

```
┌─────────────────────────────────────────────────────────────────┐
│  ⚠ Nested Handler Class                                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  CreateOrderHandler is nested inside OrderHandlers              │
│  File: src/Handlers/OrderHandlers.cs:25                         │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ public static class OrderHandlers {                        │ │
│  │   public class CreateOrderHandler : IHandle<CreateOrder> { │ │
│  │     ...                                                    │ │
│  │   }                                                        │ │
│  │ }                                                          │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  Consider extracting to a top-level class for better            │
│  discoverability with Whizbang's source generators.             │
│                                                                  │
│  [A] Extract to top-level class (Recommended)                   │
│  [B] Keep nested (may require manual registration)              │
│                                                                  │
│  Select option [A/B]: _                                         │
└─────────────────────────────────────────────────────────────────┘
```

## Decision Files

Decision files store your migration choices and progress, allowing you to:
- Resume migrations later
- Share decisions across team members
- Edit decisions manually in a text editor
- Replay migrations without prompts

### Default Location

```
~/.whizbang/migrations/<project-name>/decisions.json
```

This location is **outside your repository**, making it safe from:
- Git worktree resets
- Branch switches
- Accidental commits

### Custom Location

```bash
# Store in custom location
whizbang migrate apply ./src --interactive --decision-file ~/myproject-decisions.json

# Replay saved decisions
whizbang migrate apply ./src --decision-file ~/myproject-decisions.json
```

### Decision File Format

```json
{
  "version": "1.0",
  "project_path": "/src/MyProject",
  "generated_at": "2026-01-20T10:00:00Z",
  "state": {
    "status": "in_progress",
    "started_at": "2026-01-18T14:30:00Z",
    "git_commit_before": "abc123def456",
    "completed_categories": ["routing", "handlers"],
    "current_category": "projections",
    "current_item": 5
  },
  "decisions": {
    "routing": {
      "owned_domains": ["orders", "inventory"],
      "detected_domains": ["orders", "inventory", "shipping"],
      "inbox_strategy": "SharedTopic",
      "inbox_topic": null,
      "inbox_suffix": null,
      "outbox_strategy": "DomainTopics",
      "outbox_topic": null,
      "confirmed": true
    },
    "handlers": {
      "default": "Convert",
      "overrides": {
        "src/Handlers/LegacyHandler.cs": "Skip"
      }
    },
    "projections": {
      "default": "Convert",
      "single_stream": "IPerspectiveFor",
      "multi_stream": "IGlobalPerspectiveFor"
    },
    "event_store": {
      "append_exclusive": "ConvertWithWarning",
      "start_stream": "Convert",
      "save_changes": "Skip"
    },
    "id_generation": {
      "guid_new_guid": "Prompt",
      "comb_guid": "Convert"
    },
    "custom_base_classes": {
      "default_strategy": "Prompt",
      "base_class_strategies": {
        "BaseMessageHandler<T>": "RemoveInheritance",
        "BaseEventHandler": "KeepInheritance"
      },
      "confirmed": true
    },
    "unknown_interfaces": {
      "default_strategy": "Prompt",
      "interface_strategies": {
        "IEventStoreContext": "MapToWhizbang",
        "ICustomLogger": "KeepAndInject",
        "ILegacyService": "RemoveParameter"
      },
      "confirmed": true
    }
  }
}
```

### Custom Base Class Strategies

| Strategy | Description |
|----------|-------------|
| `Prompt` | Ask for each handler (default) |
| `RemoveInheritance` | Remove base class, implement IReceptor directly |
| `KeepInheritance` | Keep base class AND add IReceptor (requires manual base class adaptation) |
| `Skip` | Don't migrate handlers using this base class |

### Unknown Interface Strategies

| Strategy | Description |
|----------|-------------|
| `Prompt` | Ask for each handler (default) |
| `MapToWhizbang` | Replace with Whizbang equivalent (e.g., `IEventStoreContext` → `IEventStore`) |
| `KeepAndInject` | Keep parameter, inject via DI |
| `RemoveParameter` | Remove the parameter entirely |
| `Skip` | Don't migrate handlers using this interface |

The `routing` section captures:
- **owned_domains**: Domains this service owns (commands route here)
- **detected_domains**: All domains found in the codebase
- **inbox_strategy**: `SharedTopic` or `DomainTopics`
- **outbox_strategy**: `DomainTopics` or `SharedTopic`

### Generate for Manual Editing

```bash
# Generate decision file with defaults for manual editing
whizbang migrate apply ./src --generate-decisions myproject-decisions.json
```

Edit the JSON file in your text editor, then replay:

```bash
whizbang migrate apply ./src --decision-file myproject-decisions.json
```

## Revert Functionality

If something goes wrong, you can revert all migration changes:

```bash
whizbang migrate revert
```

This will:
1. Reset to the git commit recorded before migration started
2. Clean any untracked files created during migration
3. Update the decision file status to "Reverted"

### Revert Options

```
┌─────────────────────────────────────────────────────────────────┐
│  Revert Migration                                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  This will revert all migration changes:                         │
│  • Git reset to commit: abc123 (before migration)               │
│  • Clean untracked files created during migration               │
│  • Keep decision file (can resume later)                        │
│                                                                  │
│  Warning: Uncommitted changes will be lost!                      │
│                                                                  │
│  [A] Revert and keep decision file (Recommended)                │
│  [B] Revert and delete decision file                            │
│  [C] Cancel                                                      │
│                                                                  │
│  Select option [A/B/C]: _                                       │
└─────────────────────────────────────────────────────────────────┘
```

## Status Command

View detailed migration status:

```bash
whizbang migrate status
```

Output:
```
Migration Status: In Progress
Project: /src/MyProject
Started: 2026-01-18 14:30

Progress:
  [████████████░░░░░░░░] 60% (27/45)

Categories:
  ✓ Handlers (45/45)
  ▶ Projections (12/23) - current
  ○ Event Store (0/67)
  ○ ID Generation (0/34)

Decision file: ~/.whizbang/migrations/MyProject/decisions.json
Git commit (before): abc123def456
```

## Command Reference

| Command | Description |
|---------|-------------|
| `whizbang migrate` | Launch wizard menu |
| `whizbang migrate analyze <path>` | Scan and report patterns |
| `whizbang migrate apply <path> --interactive` | Interactive wizard |
| `whizbang migrate apply <path> --decision-file <file>` | Replay decisions |
| `whizbang migrate revert` | Revert changes |
| `whizbang migrate status` | Show progress |

## Workflow Examples

### Team Migration

```bash
# Lead developer: Create decisions interactively
whizbang migrate apply ./src --interactive --decision-file team-decisions.json

# Share team-decisions.json with team

# Other developers: Apply same decisions
whizbang migrate apply ./src --decision-file team-decisions.json
```

### Incremental Migration

```bash
# Day 1: Migrate handlers
whizbang migrate apply ./src --interactive
# Answer prompts for handlers only, exit

# Day 2: Resume and migrate projections
whizbang migrate
# Select "Continue migration"
```

### Safe Exploration

```bash
# Analyze without changes
whizbang migrate analyze ./src

# Try interactive migration
whizbang migrate apply ./src --interactive

# Something went wrong? Revert
whizbang migrate revert

# Try again with different decisions
whizbang migrate apply ./src --interactive
```
