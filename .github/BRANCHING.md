# Git Flow Branching Strategy

This repository follows Git Flow. Branch direction is enforced by CI.

## Branch Types

| Branch | Purpose | Merges Into |
|--------|---------|-------------|
| `main` | Production (triggers GitHub Pages deploy) | — |
| `develop` | Integration branch | `main` (via release) |
| `feature/*`, `feat/*` | New features | `develop` |
| `fix/*` | Bug fixes | `develop` |
| `chore/*`, `docs/*`, `ci/*` | Maintenance | `develop` |
| `release/*` | Release preparation | `main` |
| `hotfix/*` | Urgent production fixes | `main` or `develop` |

## Allowed PR Directions

```
feature/*, feat/*, fix/*, chore/*, docs/*, ci/*,
refactor/*, test/*, perf/*, build/*, style/*  →  develop

release/*          →  main
hotfix/*           →  main OR develop
dependabot/*       →  develop
main               →  develop (sync after release)
develop            →  release/*
```

All other directions are blocked by the `git-flow-check` workflow.

## Workflow

1. Create feature branch from `develop`
2. Open PR targeting `develop`
3. CI build check runs automatically
4. Merge to `develop`
5. When ready to deploy: merge `develop → main` (or use release branch)
6. Push to `main` triggers GitHub Pages deploy
