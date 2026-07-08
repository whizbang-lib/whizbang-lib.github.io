#!/usr/bin/env node
// Validates docs front-matter for RELEASED pages (src/assets/docs/v1.0.0). Two checks:
//   1. Every content page (not _folder.md) has page frontmatter with codeReferences.
//   2. Every fenced code block of a "should-have" language carries {...} front-matter
//      (the same set the site flags with a "Missing Front-Matter" banner).
// Drafts / proposals / roadmap are unreleased and exempt.
// Exit 1 on any violation (CI gate). Pass --report to list without failing.

import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

const ROOT = 'src/assets/docs/v1.0.0';
const REPORT_ONLY = process.argv.includes('--report');

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

for (const file of walk(ROOT)) {
  const text = readFileSync(file, 'utf8');
  const lines = text.split('\n');
  // Exempt structural / non-code-documentation pages: nav markers, section indexes,
  // and the glossary (term definitions, not a specific-code page).
  const base = file.slice(file.lastIndexOf('/') + 1);
  const exemptPage = base === '_folder.md' || base === 'README.md' || base === 'glossary.md';

  // 1. Page frontmatter with codeReferences (content pages only).
  if (!exemptPage) {
    const fm = text.startsWith('---\n') ? text.slice(4, text.indexOf('\n---', 4)) : '';
    if (!/^codeReferences:/m.test(fm)) {
      violations.push(`${file}: page is missing 'codeReferences' frontmatter`);
    }
  }

  // 2. Code-block front-matter.
  let inBlock = false;
  lines.forEach((line, i) => {
    const m = line.match(/^```([A-Za-z0-9#+_-]+)(.*)$/);
    if (m && !inBlock) {
      inBlock = true;
      const lang = m[1].toLowerCase();
      const rest = m[2];
      if (LANGS.has(lang) && !rest.includes('{')) {
        violations.push(`${file}:${i + 1}: \`\`\`${lang} code block missing front-matter`);
      }
      return;
    }
    if (/^```\s*$/.test(line) && inBlock) inBlock = false;
  });
}

if (violations.length === 0) {
  console.log('✓ Front-matter validation passed for src/assets/docs/v1.0.0 (pages + code blocks).');
  process.exit(0);
}

console.log(`✗ Front-matter validation: ${violations.length} issue(s) in released docs (v1.0.0):\n`);
for (const v of violations) console.log(`  ${v}`);
console.log('\nSee .claude/skills/whizbang-docs-authoring/SKILL.md for the required format.');
process.exit(REPORT_ONLY ? 0 : 1);
