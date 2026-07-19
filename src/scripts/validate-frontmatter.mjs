#!/usr/bin/env node
// Validates docs front-matter for RELEASED pages (src/assets/docs/v1.0.0). Checks:
//   1. Every content page (not _folder.md) has page frontmatter with codeReferences.
//   2. Every fenced code block of a "should-have" language carries {...} front-matter
//      (the same set the site flags with a "Missing Front-Matter" banner).
//   2b. Every ```mermaid diagram carries {caption="…" tests=[…]} — the site
//      requires a caption and verifying tests on every diagram (and flags misses).
//   3. Taxonomy: pageType (Diátaxis-based enum), audience, status — WARNINGS until
//      backfill completes; pass --strict-taxonomy to make them exit-1 failures.
// Drafts / proposals / roadmap are unreleased and exempt from 1–2; taxonomy enum
// validity (not presence) is still checked there when fields exist.
// Exit 1 on any violation (CI gate). Pass --report to list without failing.

import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

const ROOT = 'src/assets/docs/v1.0.0';
const REPORT_ONLY = process.argv.includes('--report');
const STRICT_TAXONOMY = process.argv.includes('--strict-taxonomy');

const PAGE_TYPES = new Set(['overview', 'concept', 'tutorial', 'guide', 'reference', 'troubleshooting']);
const AUDIENCES = new Set(['consumer', 'contributor', 'porter']);
const STATUSES = new Set(['current', 'draft', 'proposal', 'deprecated']);

// Mirrors code-block-parser.service.ts shouldHaveFrontMatter.
const LANGS = new Set([
  'csharp', 'cs', 'c#', 'javascript', 'js', 'typescript', 'ts', 'json', 'xml',
  'yaml', 'yml', 'bash', 'sh', 'powershell', 'ps1', 'sql', 'html', 'css', 'scss',
  'python', 'py', 'java', 'go', 'rust', 'php',
]);

function walk(dir) {
  let out = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out = out.concat(walk(p));
    else if (entry.endsWith('.md')) out.push(p);
  }
  return out;
}

const violations = [];
const taxonomyWarnings = [];

function checkTaxonomy(file, fm, isFolderPage) {
  const scalar = (key) => (fm.match(new RegExp(`^${key}:\\s*(.+)$`, 'm')) || [])[1]?.trim().replace(/^["']|["']$/g, '');
  const pageType = scalar('pageType');
  if (!pageType) {
    if (!isFolderPage) taxonomyWarnings.push(`${file}: missing 'pageType' (${[...PAGE_TYPES].join('|')})`);
  } else if (!PAGE_TYPES.has(pageType)) {
    taxonomyWarnings.push(`${file}: invalid pageType '${pageType}'`);
  } else if (isFolderPage && pageType !== 'overview') {
    taxonomyWarnings.push(`${file}: _folder.md pageType must be 'overview', got '${pageType}'`);
  }
  // _folder.md carries the versioning system's own status vocabulary
  // (released|development|planning|deprecated) — out of scope here.
  const status = scalar('status');
  if (status && !isFolderPage && !STATUSES.has(status)) {
    taxonomyWarnings.push(`${file}: invalid status '${status}' (${[...STATUSES].join('|')})`);
  }
  // Verification stamp: set ONLY when a page's content has actually been
  // verified against library code — records the library commit checked.
  const vCommit = scalar('verifiedAgainstCommit');
  if (vCommit && !/^[0-9a-f]{7,40}$/i.test(vCommit)) {
    taxonomyWarnings.push(`${file}: verifiedAgainstCommit '${vCommit}' is not a git sha`);
  }
  const vDate = scalar('verifiedDate');
  if (vDate && !/^\d{4}-\d{2}-\d{2}$/.test(vDate.replace(/["']/g, ''))) {
    taxonomyWarnings.push(`${file}: verifiedDate '${vDate}' must be YYYY-MM-DD`);
  }

  // audience: inline list "audience: [consumer, porter]" or block list lines "  - consumer"
  const audienceInline = fm.match(/^audience:\s*\[([^\]]*)\]/m);
  const audienceBlock = fm.match(/^audience:\s*\n((?:\s+-\s+.+\n?)+)/m);
  const values = audienceInline
    ? audienceInline[1].split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean)
    : audienceBlock
      ? audienceBlock[1].split('\n').map((l) => l.replace(/^\s+-\s+/, '').trim().replace(/^["']|["']$/g, '')).filter(Boolean)
      : null;
  if (values) {
    for (const v of values) {
      if (!AUDIENCES.has(v)) taxonomyWarnings.push(`${file}: invalid audience '${v}' (${[...AUDIENCES].join('|')})`);
    }
  }
}

for (const file of walk(ROOT)) {
  const text = readFileSync(file, 'utf8');
  const lines = text.split('\n');
  // Exempt structural / non-code-documentation pages: nav markers, section indexes,
  // and the glossary (term definitions, not a specific-code page).
  const base = file.slice(file.lastIndexOf('/') + 1);
  const exemptPage = base === '_folder.md' || base === 'README.md' || base === 'glossary.md';
  const fm = text.startsWith('---\n') ? text.slice(4, text.indexOf('\n---', 4)) : '';

  // 1. Page frontmatter with codeReferences (content pages only).
  if (!exemptPage) {
    if (!/^codeReferences:/m.test(fm)) {
      violations.push(`${file}: page is missing 'codeReferences' frontmatter`);
    }
  }

  // 3. Taxonomy (pageType/audience/status) — warnings unless --strict-taxonomy.
  if (base !== 'README.md') checkTaxonomy(file, fm, base === '_folder.md');

  // 2. Code-block front-matter.
  let inBlock = false;
  lines.forEach((line, i) => {
    const m = line.match(/^```([A-Za-z0-9#+_-]+)(.*)$/);
    if (m && !inBlock) {
      inBlock = true;
      const lang = m[1].toLowerCase();
      const rest = m[2];
      if (lang === 'mermaid') {
        // Every diagram must declare a caption and its verifying test(s).
        const meta = rest.trim();
        if (!meta.startsWith('{')) {
          violations.push(`${file}:${i + 1}: mermaid diagram missing {caption="…" tests=["Class.MethodAsync"]} metadata`);
        } else {
          if (!/caption\s*=\s*["'][^"']+["']/.test(meta)) {
            violations.push(`${file}:${i + 1}: mermaid diagram missing a non-empty caption`);
          }
          if (!/tests\s*=\s*\[\s*["'][^"']+["']/.test(meta)) {
            violations.push(`${file}:${i + 1}: mermaid diagram missing tests=["Class.MethodAsync", …]`);
          }
        }
        return;
      }
      if (LANGS.has(lang) && !rest.includes('{')) {
        violations.push(`${file}:${i + 1}: \`\`\`${lang} code block missing front-matter`);
      }
      return;
    }
    if (/^```\s*$/.test(line) && inBlock) inBlock = false;
  });
}

if (taxonomyWarnings.length > 0) {
  const label = STRICT_TAXONOMY ? '✗' : '⚠';
  console.log(`${label} Taxonomy: ${taxonomyWarnings.length} issue(s)${STRICT_TAXONOMY ? '' : ' (warnings — enforce with --strict-taxonomy)'}:\n`);
  for (const w of taxonomyWarnings) console.log(`  ${w}`);
  console.log('');
  if (STRICT_TAXONOMY) violations.push(...taxonomyWarnings);
}

if (violations.length === 0) {
  console.log('✓ Front-matter validation passed for src/assets/docs/v1.0.0 (pages + code blocks).');
  process.exit(0);
}

console.log(`✗ Front-matter validation: ${violations.length} issue(s) in released docs (v1.0.0):\n`);
for (const v of violations.filter((v) => !taxonomyWarnings.includes(v))) console.log(`  ${v}`);
console.log('\nSee .claude/skills/whizbang-docs-authoring/SKILL.md for the required format.');
process.exit(REPORT_ONLY ? 0 : 1);
