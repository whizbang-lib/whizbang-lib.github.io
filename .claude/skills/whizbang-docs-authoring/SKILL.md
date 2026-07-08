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
Mermaid uses an **inline, `=`-delimited** metadata form — only `title` and `description`, no framework/category/difficulty/tags:

````markdown
```mermaid{title="Collective-event apply pipeline" description="Producer → outbox → transport → inbox → perspective runner → one scope-filtered UPDATE."}
sequenceDiagram
  …
```
````

Never give a mermaid block the multi-line code-block format — it breaks diagram rendering.

## Workflow when adding/editing a page
1. Add/refresh the page frontmatter (incl. `codeReferences`/`testReferences`).
2. Give every code fence proper front-matter (mermaid uses the inline form).
3. `pnpm run validate-frontmatter` — fix anything it flags on `v1.0.0/` pages.
4. C# examples follow K&R/Egyptian braces (opening brace on the same line).
