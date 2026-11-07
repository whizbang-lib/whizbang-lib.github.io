---
title: Release Versioning and the Version Rollup
pageType: concept
audience: [contributor]
status: current
order: 6
description: How Whizbang numbers its packages on each channel (develop alphas, release-branch betas and rcs, stable, hotfix), and the rule that a stable release's version adds the latest number of each prerelease label since the last stable to the minor, with the reason for each design choice.
tags: contributing, releases, versioning, gitversion, nuget, prerelease, alpha, beta, rc
codeReferences:
  - .github/scripts/Get-ReleaseVersion.ps1
  - .github/release-version.json
  - .github/workflows/start-release.yml
  - .github/workflows/release-prerelease.yml
  - .github/workflows/release.yml
  - .github/scripts/Find-TestedPackages.ps1
  - docs/RELEASING.md
testReferences:
  - .github/scripts/tests/Get-ReleaseVersion.Tests.ps1
  - .github/scripts/tests/Find-TestedPackages.Tests.ps1
---

# Release Versioning and the Version Rollup

Every Whizbang package version comes from the release pipeline, never from a hand-edited file. This page explains how the number is chosen on each channel and, in detail, the **version rollup**: the rule that decides a stable release's number from the prereleases that came before it. The operating procedure (which workflow to run, what to approve, how to recover) lives in the library's `docs/RELEASING.md`; this page is the why.

## The channels

| Channel | Published as | Who picks the number |
|---|---|---|
| develop (every merge) | `0.Y.0-alpha.N`, one minor above the last tag | GitVersion: `develop` increments the minor, `N` is the commit height |
| release cut | names the branch `release/vX.Y.Z` | Start Release, `release_type: auto`: GitVersion's base plus the cut commit's alpha number (the rollup) |
| beta, rc | `X.Y.Z-beta.N` / `X.Y.Z-rc.N`, the branch's own number | Release Prerelease, numbered from the existing tags |
| stable | the branch number plus each beta and rc label's latest number | the stable publish, from the cut's record and the line's tags |
| hotfix | `X.Y.(Z+1)` on an existing line | the hotfix branch's name |

The git tag is the source of truth for "what version are we at": GitVersion derives the next number from the highest tag in the repository, so every publish except the develop alphas creates one.

## The version rollup {#version-rollup}

**The rule.** A stable release's version is computed from the prereleases of its line. For each distinct prerelease label published since the last stable release (alpha, beta, rc, or any other label), take that label's latest number, sum the numbers, and add the sum to the target component of the line's base. With the minor as the target, the patch resets to 0. The result carries no prerelease suffix.

### Worked example

The line's base is `0.2627.0` (the last stable was below it, and develop has been publishing `0.2627.0-alpha.N`).

| Published since the last stable | Release branch | Stable version | Run summary |
|---|---|---|---|
| `0.2627.0-alpha.674` | `release/v0.3301.0` | `0.3301.0` | `alpha 674 = 674 -> 0.3301.0` |
| then `0.3301.0-beta.5` | `release/v0.3301.0` | `0.3306.0` | `alpha 674 + beta 5 = 679 -> 0.3306.0` |
| then `0.3301.0-rc.3` | `release/v0.3301.0` | `0.3309.0` | `alpha 674 + beta 5 + rc 3 = 682 -> 0.3309.0` |
| `alpha.2`, `beta.5`, `rc.3` | `release/v0.2629.0` | `0.2637.0` | `alpha 2 + beta 5 + rc 3 = 10 -> 0.2637.0` |

With the patch as the target (see [the target is a setting](#the-target-is-a-setting)), `1.4.0-alpha.674` would ship as `1.4.674`.

Labels are discovered from the tags, not listed anywhere: a `preview.2` tag on the line would add 2 like any other label, ordered with the others the way SemVer orders labels.

### How a release moves through it

```mermaid{caption="The version rollup across one release: the cut adds the develop alpha number and names the branch for it; every beta and rc published from the branch raises the stable by one; the stable publish recomputes the sum from the cut's record and the line's tags and, when the number moved, repacks the tested build at it."}
flowchart LR
    A["develop<br/>0.2627.0-alpha.674"] -->|"Start Release (auto)<br/>2627 + 674"| B["release/v0.3301.0<br/>record: base=0.2627.0 alpha=674"]
    B -->|"Release Prerelease"| C["0.3301.0-beta.5"]
    C -->|"Release Prerelease"| D["0.3301.0-rc.3"]
    D -->|"merge release PR<br/>3301 + 5 + 3"| E["stable 0.3309.0<br/>tested build repacked"]
```

The number is computed twice, by one function (`.github/scripts/Get-ReleaseVersion.ps1`), because betas and rcs are published from the branch after it is cut and the final number is only known when the release PR merges:

1. **The cut.** Start Release adds GitVersion's prerelease number for the cut commit (the develop `alpha.N` that commit is) to GitVersion's base and names the branch for the result. It writes the inputs into the release PR body as a hidden record, for example `<!-- release-rollup: base=0.2627.0 target=minor alpha=674 -->`, and prints the summary line.
2. **Betas and rcs.** Each publishes from the branch at its number (`0.3301.0-beta.N`, `0.3301.0-rc.N`) under the usual ordering rules (no beta after an rc, none after stable). Each one raises the stable by one, and the Release Prerelease summary says what merging the release PR would now ship.
3. **The stable publish.** It reads the record back, checks that the record computes the branch's number (a record that does not is refused, with the recovery named), adds the latest number of every label tagged on the line, prints the sum, and publishes and tags it. When the sum differs from the branch number, it repacks the release-branch run's tested build at the stable version instead of promoting the packages the branch packed at its own number.

A release with no betas or rcs ships exactly the branch number, and every name agrees: PR title, branch, preview, packages and tag.

### Design choices {#rollup-design-choices}

Each choice below is an owner decision on [#2136](https://github.com/whizbang-lib/whizbang/issues/2136), locked by the named test in `.github/scripts/tests/Get-ReleaseVersion.Tests.ps1` (run by the `Test · Pipeline scripts` job), which fails if the behavior flips.

| Choice | Why | Verified by |
|---|---|---|
| The stable adds the latest number of **each** label since the last stable, not only the alpha count. | Every prerelease a consumer could have installed is reflected in the number that supersedes it, and the stable sorts above every one of them on nuget.org. The inputs are facts (published tags and GitVersion's count for the cut commit), so the result can be recomputed and checked rather than chosen. | `Get-ReleaseRollup: the issue's rows` (all four rows); `Resolve-StableVersion / adds the betas and rcs: alpha 674 + beta 5 + rc 3 ships 0.3309.0` |
| Labels are discovered from the tags, never listed. | A new label (a `preview`, say) is counted the day it is first published, with no script change; a fixed list would silently drop it and ship a number too low. | `Get-ReleaseRollup: the rule / counts a label it has never heard of, in SemVer label order`; `Get-LinePrerelease / discovers each label published on the line and keeps its latest number` |
| The target component is a setting, `rollupTarget` in `.github/release-version.json`: `minor` now, possibly `patch` after v1.0. | Before v1.0 the minor carries no compatibility promise, so it can absorb the rollup. After v1.0 the minor means "new features", and the patch may be the right place for the count; moving it is a one-line configuration change, not a script change. | `Get-RollupTarget / is minor in the repository's own configuration`; `Get-ReleaseRollup: the rule / adds to the patch when the target is the patch`; `The script, as the workflows run it / Cut takes the target from the configuration: patch` |
| The cut records the target it used, and the stable applies the recorded one. | Changing the setting must never change the number of a release already in flight, whose branch and prereleases were named under the old target. | `Resolve-StableVersion / applies the target the cut recorded, not today's` |
| The branch is named for the alpha rollup (`release/v0.3301.0`), not GitVersion's base. | A release without betas or rcs then stays on the path it always had: one number for title, branch, packages and tag. The bands stay disjoint too: while the release is open, develop computes one minor above the branch, and a stable with any beta or rc is at least one above the branch, so it sorts above every alpha develop published meanwhile and `Gate · Alpha is not below NuGet` holds. | `Resolve-CutVersion / names the release branch from GitVersion's base and prerelease number, and records them`; `Resolve-StableVersion / ships the line's own number when nothing was published from the branch` |
| The release PR's title keeps the branch number once betas or rcs exist; it is not re-titled to the rolled-up number. | The title and branch identify the merge as this line's release, which `Plan · Is this a release?` checks; re-titling a PR on every prerelease would change what that check validated. The number that ships is printed by Release Prerelease's preview and by the stable publish's summary. | `Resolve-StableVersion / adds the betas: alpha.674 then beta.5 ships 0.3306.0`; `The release workflows use it / Release Prerelease previews the stable number` |
| Only the alpha number is recorded at the cut; betas and rcs are read from the tags at the stable publish. | The alpha number is a fact only at the cut (develop keeps moving afterwards), while betas and rcs do not exist yet then and are tagged on the line as they are published. If a label is both recorded and tagged, the higher number wins. | `The rollup record / round-trips the base, the target and each label`; `Resolve-StableVersion / keeps the higher number when a label is both recorded and tagged` |
| A record that does not compute the branch's number is refused, never guessed around. | An edited or foreign record would publish a number nobody can explain, and a published version is permanent. The refusal names the recovery: compute the version with the script and re-dispatch. | `Resolve-StableVersion / refuses a record that does not compute the branch's number`; `The rollup record / refuses a malformed record rather than guessing`; `The script, as the workflows run it / fails with an error annotation, and writes no version, when the record is inconsistent` |
| Hotfixes never roll up. | A hotfix is a patch on an existing line (`X.Y.(Z+1)`), named by its branch. Adding a count to the minor would move it off its line and into develop's band. Its release PR is opened without a record, so it ships its branch's number. | `Resolve-StableVersion / ships the branch's own number when the release PR carries no record (an override or a hotfix)` |
| `major`, `minor`, `patch` and `manual` cuts are overrides with no rollup. | Each is a deliberate choice of number (a breaking release, or a recovery); adding counts to it would defeat the choice. The cut writes no record, so the stable ships the branch number however many betas or rcs follow. A release PR cut before #2136 carries no record and is treated the same way. | `The script, as the workflows run it / Stable with no record ships the line and says rolled=false` |
| A continued open series adds no new alpha count; its betas and rcs still roll up. | Its alphas were counted when the series was first cut, and counting develop's newer alphas again would add work that is not in the release. If GitVersion fails at the cut there is no alpha fact, so the fallback number is treated as an override. | `Resolve-CutVersion / keeps a pinned line's number when there is no prerelease number to add`; `Resolve-StableVersion / rolls up a pinned line from its own number` |
| A rolled-up stable repacks the tested build at the stable number; the DLLs' informational version still names the branch number. | Rebuilding to stamp the new number would publish bytes no suite ran against. The repack is the same one a beta uses: the package version is the stable number, and the assemblies inside are the tested ones, so their `AssemblyInformationalVersion` reads the line (`0.3301.0`). The package version is authoritative. | `The release workflows use it / a rolled-up stable repacks the tested build at its own number, and publish takes either package set` |

## Related

- [Repository checks](repository-checks.md): the other guards the `Test · Pipeline scripts` job runs.
- [Installation](../v1.0.0/getting-started/installation.md#version-numbers): what the numbers mean for a consumer choosing a package version.
