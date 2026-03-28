---
description: Audit a single doc page against its library source code
---

Audit the documentation page at `$ARGUMENTS` against its corresponding library source code.

**Steps:**

1. Read the doc page at `src/assets/docs/v1.0.0/$ARGUMENTS`
2. Extract `codeReferences` from the frontmatter
3. For each code reference, read the corresponding library source file at `/Users/philcarbone/src/whizbang/whizbang/`
4. Run through the 12-dimension audit checklist below
5. Report findings as a structured list of issues

**12-Dimension Audit Checklist:**

| # | Dimension | What to check |
|---|-----------|--------------|
| 1 | **Incomplete docs** | Compare page's API descriptions against current source. Look for: new enum values, new parameters, changed defaults, new overloads |
| 2 | **Code/Tests/Docs links** | Verify codeReferences paths exist. Check `<docs>` tags in source files point back correctly |
| 3 | **Diagram clarity** | Read actual source code flow, compare against mermaid diagrams |
| 4 | **Code samples current** | Does each code sample compile against current API? |
| 5 | **Code sample frontmatter** | Every code block should have: title, description, category, difficulty, tags |
| 6 | **Page frontmatter** | Check: title, version, category, order, description, tags, codeReferences all present and accurate |
| 7 | **Redundancy** | Does this page repeat content from another page? |
| 8 | **Persona gaps** | Is this topic documented for both user-developers and contributors? |
| 9 | **Diagram needs** | Pages without diagrams that should have them |
| 10 | **RTD rendering** | Does this page use custom syntax that RTD's build.py handles? |
| 11 | **Search quality** | Good description? Keyword-rich tags with synonyms? |
| 12 | **Best practices** | Missing: "see also" links, prerequisites, version badges |

**Output format:**

For each issue found:
- **[Dimension]** Summary of issue
  - Details: What's wrong and what it should be
  - Source: Which file/line in the library
  - Effort: S/M/L

If the page passes all checks, report "Page is up to date" with the current library HEAD commit for `lastMaintainedCommit`.
