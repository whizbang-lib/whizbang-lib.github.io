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

## Releases and the release app

The library's CI publishes test status to `develop` and then starts **Start Release** with `auto_merge`, so
most releases run unattended:

1. **Start Release** cuts `release/vX.Y.Z` from `develop` (with `main` merged in and the version bumped),
   opens the release PR into `main`, waits for its Build, and merges it.
2. **Release** sees the merged `chore(release): vX.Y.Z` PR and hands off to a run of itself on `main`,
   which tags `vX.Y.Z` and creates the GitHub release. **Deploy** publishes the site from the push to
   `main`, and **Sync main into develop** brings the bump back to `develop`.

Every push, PR, merge and tag in that chain is made by the organization's release GitHub App, not
`GITHUB_TOKEN`, so each PR runs its own checks and each merge starts the next workflow. Its
`RELEASE_APP_ID` and `RELEASE_APP_PRIVATE_KEY` are secrets of the `release-app` environment, which admits
only `develop`, `main` and `release/v*`, so a workflow pushed on any other branch cannot mint its token.

`develop` and `main` require signed commits, and a commit a workflow makes with `git commit` is unsigned.
So the release and sync branches are published with `.github/scripts/Publish-SignedCommit.ps1` (a copy of
the library's, tested in the Build job): it recreates each new commit through the GitHub API, which signs
it as the app.
