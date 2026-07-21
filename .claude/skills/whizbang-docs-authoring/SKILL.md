---
name: whizbang-docs-authoring
description: Use when writing or editing Whizbang documentation pages under src/assets/docs (any .md), or when adding/reviewing code samples in the docs. Encodes the required page frontmatter (code/test links) and the code-block front-matter format the site enforces, so new content doesn't ship with "Missing Front-Matter" warnings or unlinked pages.
---

# Authoring Whizbang docs

The docs site (whizba.ng + the Read the Docs mirror) is generated from `src/assets/docs/**/*.md`. Two kinds of front-matter are required. Both are checked by `src/scripts/validate-frontmatter.mjs` (run `pnpm run validate-frontmatter`), which the CI Build gate enforces for **released** pages under `src/assets/docs/v1.0.0/`.

## 1. Page frontmatter (YAML at the very top of the file)

Every **released** content page (`v1.0.0/…`, excluding `_folder.md` nav markers) must carry:

```yaml
---
title: "Concise page title"
description: >-
  One or two sentences describing the page for search + social cards.
order: 31
tags: 'comma, separated, keywords'
codeReferences:
  - src/Whizbang.Core/…/RelevantType.cs        # library paths, relative to the whizbang repo
  - src/Whizbang.Generators/…/RelevantGenerator.cs
testReferences:
  - tests/Whizbang.Core.Tests/…/RelevantTests.cs
---
```

`codeReferences` / `testReferences` are the code-alignment contract: they link each page to the library code and tests it documents, so it's obvious which docs track the latest library. Point them at real files in the sibling `whizbang/` repo. Exempt: drafts/proposals/roadmap pages (unreleased), `_folder.md` nav markers, and non-code pages (`README.md` section indexes, `getting-started/glossary.md`).

## 2. Code-block front-matter

The site flags **any** fenced code block of a common language (`csharp`, `cs`, `ts`, `js`, `json`, `yaml`, `xml`, `bash`, `sh`, `sql`, `powershell`, `python`, `go`, `rust`, `java`, `php`, `html`, `css`, `scss`) that has no `{…}` metadata — it renders a red "⚠️ Missing Front-Matter" banner. So every such block needs metadata immediately after the language on the fence line:

````markdown
```csharp{
title: "Register the Azure Blob body-offload provider"
description: "Wires the production offload provider into DI so oversized message bodies claim-check to blob storage."
framework: "NET10"
category: "Offloads"
difficulty: "INTERMEDIATE"
tags: ["body-offload", "azure-blob", "claim-check", "dependency-injection"]
}
services.AddWhizbangAzureBlobOffload("azure-blob-prod", opts => { /* … */ });
```
````

Rules:
- **title / description** — specific to what *that* block shows; derive from the code + the nearest heading. No generic filler ("Code example", "Configuration") — auto-generated placeholder metadata was mass-deleted once already.
- **framework** — `"NET10"` for C#/.NET code. **Omit** for non-.NET languages (bash, sql, json, yaml, xml).
- **category** — title-case, matching the page area: `Messaging`, `Perspectives`, `Workers`, `Offloads`, `Sagas`, `Identity`, `Observability`, `Configuration`, `Diagnostics`, `Dead Letter Queue`, `Core Concepts`, `Design`, `API`, `Lenses`, `Attributes`.
- **difficulty** — `BEGINNER` (basic config/usage), `INTERMEDIATE` (typical API usage), `ADVANCED` (internals, lease/transport/exactly-once semantics).
- **tags** — a JSON array of 3–6 specific, content-derived tags.
- Optional richness: `filename`, `nugetPackages`, `highlightLines`, `usingStatements`.

### Mermaid diagrams are different
Mermaid uses an **inline, `=`-delimited** metadata form. Every diagram is **required** to
declare a `caption` and its verifying `tests` (see §3) — the site renders it as a `<figure>`
with a "Figure — <caption>" caption + a verified badge, and shows a warning if either is missing:

````markdown
```mermaid{caption="Collective-event apply pipeline — producer → outbox → transport → inbox." tests=["PerspectiveRunnerTests.Apply_ScopeFiltered_SingleUpdateAsync"]}
sequenceDiagram
  …
```
````

Never give a mermaid block the multi-line code-block format — it breaks diagram rendering.

## 3. Test verification — the coverage map

Whizbang docs **are the living spec**, so every documented behavior should be *proven by a test*.
The site labels each C# example / diagram / table row / section with its verification state, so
gaps are visible instead of silent (checks-and-balances). A **green** badge tells the reader the
documented behavior actually works; an **amber** badge flags a spec that isn't verified yet.

**Join key:** everything links by `<ShortClassName>.<TestMethodName>` (e.g.
`DispatcherTests.Send_WithValidMessage_ShouldReturnDeliveryReceiptAsync`) — the same identity used by
`src/assets/code-tests-map.json` (`testsToCode`) and the live test-status data. Method names end in
`Async` by project convention.

### Badge states
| State | When | Author action |
|-------|------|---------------|
| 🟢 verified   | linked test(s) found & passing | add `tests=[…]` |
| 🔴 failing    | a linked test is failing | (fix the code/doc/test) |
| 🟠 needs test | a C# example with no `tests=`/`unverified=` | link a test, or leave honestly as a gap |
| ⚪ not verified | intentionally excused, with a reason | add `unverified="reason"` |

### Code fences
Add the verifying test(s) to the fence metadata:
```csharp{title="…" … tests=["DispatchOptionsTests.WithTimeout_SetsTimeout_ReturnsSelfAsync"]}```
- **Every C# block should be verified.** A C# block with neither `tests=` nor `unverified=` renders
  amber **"needs test"**. Non-C# blocks (bash/json/output) show a badge only when `tests=` is given.
- **Find the right test** — precision matters (a green badge that points at the wrong test is worse
  than an honest amber). Use the page's `testReferences` classes as the candidate set, confirm the key
  exists in `code-tests-map.json`, and read the actual test to confirm it verifies *that* example:
  ```bash
  grep -oE '"DispatcherTests\.[A-Za-z0-9_]+Async"' src/assets/code-tests-map.json | sort -u
  ```
  If you cannot confidently map an example, **leave it as a gap** — do not guess.
- **Opt out** with a reason for legitimate non-examples:
  `unverified="counter-example — intentionally wrong"` (a "don't-do-this" block), or
  `unverified="raw IEventStore.AppendAsync — verified in the Event Store docs"` (another component's API).

### Inline markers (tables, prose, section headings, diagram captions)
Use the token `{verified: Class.MethodAsync, Class.OtherAsync}` anywhere in prose. It becomes a badge
that opens a modal with those exact tests. Put **section** markers on their **own line** right under the
heading (so heading anchor slugs stay clean). Quick-reference tables get a trailing **Verified** column
whose cells hold the token.

### Local preview vs production
Production publishes real per-method results to `src/assets/data/test-status/` (via the library CI).
Locally that folder is a **git-excluded dev fixture** — to see a badge render green in local dev, its
key must be in `src/assets/data/test-status/Whizbang.Core.Tests.json`. Never commit the fixture; never
rely on it for correctness (production has the real data). Correct **keys** are what matter.

### The reference model + burndown
`fundamentals/dispatcher/dispatcher.md` is the fully-annotated **model page** — copy its patterns.
Burndown status + the per-page table live in `plans/verified-coverage-burndown.md`.

## Workflow when adding/editing a page
1. Add/refresh the page frontmatter (incl. `codeReferences`/`testReferences`).
2. Give every code fence proper front-matter (mermaid uses the inline form).
3. Add test verification (§3): `tests=[…]` / `unverified="…"` on C# blocks, `caption`+`tests` on
   diagrams, `{verified: …}` on key tables/sections. Model off `dispatcher.md`.
4. `pnpm run validate-frontmatter` — fix anything it flags on `v1.0.0/` pages (now incl. mermaid caption/tests).
5. C# examples follow K&R/Egyptian braces (opening brace on the same line).
