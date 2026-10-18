#!/usr/bin/env node
// Gate · Linked change: every docs pull request into develop or main names the library change it documents.
//
// Usage (in CI):
//   GH_TOKEN=... GITHUB_REPOSITORY=owner/repo PR_NUMBER=N node src/scripts/check-linked-change.mjs
//
// The check passes when the pull request description contains either:
//   1. a library issue or pull request reference: whizbang-lib/whizbang#N, or a URL
//      https://github.com/whizbang-lib/whizbang/issues/N or .../pull/N, or
//   2. a closing keyword for an issue in this repository (Fixes #N, Closes #N, Resolves #N and their
//      tenses, any case).
// Text inside inline code or fenced code blocks does not count, as GitHub neither links nor closes from it.
// Every reference is looked up through the GitHub API; one that does not exist does not count.
//
// Exempt: pull requests authored by a bot (account type Bot), and the release pull request from a release/*
// branch into main.
//
// The pull request is read from the API at run time, not from the event payload, so editing the description
// and re-running the job is enough. No dependencies: plain Node and fetch.

import { appendFileSync } from 'fs';
import { pathToFileURL } from 'url';

export const LIBRARY_REPO = 'whizbang-lib/whizbang';
export const DOCS_REPO = 'whizbang-lib/whizbang-lib.github.io';
export const CHECK_NAME = 'Gate · Linked change';
const API = 'https://api.github.com';
const TIMEOUT_MS = 20000;

export const FIX_INSTRUCTIONS =
  `Add \`Docs for ${LIBRARY_REPO}#N\` (the library pull request or issue this documents) to the description, ` +
  'then re-run this check. On the library side, that one link is what lets the library pull request find its docs. ' +
  'A docs change with no library counterpart can instead close an issue in this repository with `Fixes #N`.';

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/;

/** The text with fenced code blocks and inline code spans removed. An unterminated fence runs to the end. */
export function stripCode(text) {
  const kept = [];
  let fence = null;
  for (const line of String(text ?? '').split(/\r?\n/)) {
    if (fence) {
      const close = line.match(/^ {0,3}(`{3,}|~{3,})\s*$/);
      if (close && close[1][0] === fence[0] && close[1].length >= fence.length) fence = null;
      continue;
    }
    const open = line.match(FENCE_OPEN);
    if (open) {
      fence = open[1];
      continue;
    }
    kept.push(line);
  }
  // A run of N backticks opens a code span that the next run of exactly N backticks closes.
  return kept.join('\n').replace(/(?<!`)(`+)(?!`)[\s\S]*?(?<!`)\1(?!`)/g, ' ');
}

const LIBRARY_REF =
  /(?<![\w.\-/])(?:(?:https?:\/\/)?(?:www\.)?github\.com\/)?whizbang-lib\/whizbang(?:#(\d+)|\/(?:issues|pull)\/(\d+))(?!\w)/gi;

const CLOSING_REF =
  /(?<![\w-])(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)(?:\s*:\s*|\s+)(?:([\w.-]+\/[\w.-]+))?#(\d+)(?!\w)/gi;

const uniqueAscending = (numbers) => [...new Set(numbers)].sort((a, b) => a - b);

/** Library issue or pull request numbers the text references outside code. */
export function findLibraryRefs(text) {
  const numbers = [];
  for (const m of stripCode(text).matchAll(LIBRARY_REF)) numbers.push(Number(m[1] ?? m[2]));
  return uniqueAscending(numbers);
}

/** Issue numbers in `repo` that a closing keyword outside code points at. */
export function findClosingRefs(text, repo = DOCS_REPO) {
  const numbers = [];
  for (const m of stripCode(text).matchAll(CLOSING_REF)) {
    if (m[1] && m[1].toLowerCase() !== repo.toLowerCase()) continue;
    numbers.push(Number(m[2]));
  }
  return uniqueAscending(numbers);
}

/** Why this pull request needs no linked change, or null when it does. */
export function exemptionReason(pr) {
  if (pr?.user?.type === 'Bot') return `authored by a bot (${pr.user.login})`;
  const head = pr?.head?.ref ?? '';
  if (pr?.base?.ref === 'main' && head.startsWith('release/')) return `the release pull request from ${head} into main`;
  return null;
}

/**
 * The gate's decision. `lookup(repo, number)` resolves to { kind: 'issue' | 'pull' } or null when the item does
 * not exist; a lookup that throws propagates, so an API failure fails the check rather than deciding it.
 * Resolves to { status: 'pass' | 'exempt' | 'fail', ... }.
 */
export async function evaluate(pr, { repo = DOCS_REPO, lookup }) {
  const reason = exemptionReason(pr);
  if (reason) return { status: 'exempt', reason };

  const wanted = [
    ...findLibraryRefs(pr?.body).map((number) => ({ repo: LIBRARY_REPO, number, issueOnly: false })),
    ...findClosingRefs(pr?.body, repo).map((number) => ({ repo, number, issueOnly: true })),
  ];
  if (wanted.length === 0) {
    return { status: 'fail', found: [], missing: [], message: `This pull request does not name the library change it documents. ${FIX_INSTRUCTIONS}` };
  }

  const found = [];
  const missing = [];
  const notes = [];
  for (const ref of wanted) {
    const id = `${ref.repo}#${ref.number}`;
    const item = await lookup(ref.repo, ref.number);
    if (!item) {
      missing.push(id);
      notes.push(`${id} does not exist`);
    } else if (ref.issueOnly && item.kind !== 'issue') {
      missing.push(id);
      notes.push(`${id} is a pull request, and a closing keyword only closes an issue`);
    } else {
      found.push(id);
    }
  }
  if (found.length > 0) return { status: 'pass', found, missing };
  return {
    status: 'fail',
    found,
    missing,
    message: `None of the references in the description counts: ${notes.join('; ')}. ${FIX_INSTRUCTIONS}`,
  };
}

/** One step-summary line for the result. */
export function renderSummary(result) {
  if (result.status === 'pass') return `${CHECK_NAME}: passed, the description names ${result.found.join(', ')}.`;
  if (result.status === 'exempt') return `${CHECK_NAME}: exempt, ${result.reason}.`;
  return `${CHECK_NAME}: failed. ${result.message}`;
}

function headers(token) {
  const h = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'linked-change-check' };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

/** A lookup over the GitHub issues endpoint, which serves pull requests too (marked by a pull_request key). */
export function makeGitHubLookup({ token, fetchImpl = fetch, apiUrl = API } = {}) {
  return async (repo, number) => {
    const res = await fetchImpl(`${apiUrl}/repos/${repo}/issues/${number}`, { headers: headers(token), signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (res.status === 404 || res.status === 410) return null;
    if (!res.ok) throw new Error(`GitHub API returned ${res.status} looking up ${repo}#${number}`);
    const body = await res.json();
    return { kind: body.pull_request ? 'pull' : 'issue' };
  };
}

async function getPullRequest({ repo, number, token, fetchImpl = fetch, apiUrl = API }) {
  const res = await fetchImpl(`${apiUrl}/repos/${repo}/pulls/${number}`, { headers: headers(token), signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`GitHub API returned ${res.status} reading pull request ${repo}#${number}`);
  return res.json();
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const repo = process.env.GITHUB_REPOSITORY;
  const number = process.env.PR_NUMBER;
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  const apiUrl = process.env.GITHUB_API_URL || API;
  const summary = (line) => {
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${line}\n`);
  };
  try {
    if (!repo || !number) throw new Error('GITHUB_REPOSITORY and PR_NUMBER are required');
    const pr = await getPullRequest({ repo, number, token, apiUrl });
    const result = await evaluate(pr, { repo, lookup: makeGitHubLookup({ token, apiUrl }) });
    const line = renderSummary(result);
    console.log(line);
    summary(line);
    if (result.status === 'fail') {
      console.log(`::error title=${CHECK_NAME}::${result.message}`);
      process.exit(1);
    }
  } catch (err) {
    const line = `${CHECK_NAME}: could not run. ${err.message}`;
    console.error(line);
    summary(line);
    process.exit(1);
  }
}
