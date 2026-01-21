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
│  [1] Handlers (45 files)          ▶ Start                       │
│  [2] Projections (23 files)       ○ Pending                     │
│  [3] Event Store Operations (67)  ○ Pending                     │
│  [4] ID Generation (34 locations) ○ Pending                     │
│  [5] DI Registration (12)         ○ Pending                     │
│                                                                  │
│  Select category [1-5]: _                                       │
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
    "completed_categories": ["handlers"],
    "current_category": "projections",
    "current_item": 5
  },
  "decisions": {
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
    }
  }
}
```

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
