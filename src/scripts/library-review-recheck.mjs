#!/usr/bin/env node
// Which library pull requests a docs pull request names, so the library re-runs their review checks
// (whizbang-lib/whizbang#1806).
//
// Usage (in CI, .github/workflows/library-review-recheck.yml):
//   GITHUB_EVENT_PATH=... GITHUB_OUTPUT=... node src/scripts/library-review-recheck.mjs
//
// A library pull request's "Gate · Review checks" fails (rule pr.docs-link) until a docs pull request names it
// ("Docs for whizbang-lib/whizbang#N"). The library pull request usually comes first, so that check almost
// always runs before the docs pull request exists. When a docs pull request is opened or reopened, or its
// description edited, this script writes the library numbers it names as the step output `numbers` (a JSON
// array); the workflow's next job sends each to the library as a docs-pr-changed dispatch, and the library
// decides whether there is anything to re-run.
//
// It reads the pull_request_target event file, never the pull request's code, and parses the description
// the way "Gate · Linked change" does (check-linked-change.mjs): references in code do not count. Only
// positive numbers of at most nine digits are written, at most MAX_DISPATCHES of them.

import { appendFileSync, readFileSync } from 'fs';
import { pathToFileURL } from 'url';
import { findLibraryRefs, LIBRARY_REPO } from './check-linked-change.mjs';

export const MAX_DISPATCHES = 10;
const ACTIONS = new Set(['opened', 'reopened', 'edited']);

/** The library pull request numbers to re-check for a pull_request_target event, ascending. */
export function libraryPullRequestsToRecheck(event) {
  const action = event?.action;
  if (!ACTIONS.has(action)) return [];
  if (action === 'edited' && !event?.changes?.body) return [];
  return findLibraryRefs(event?.pull_request?.body)
    .filter((n) => Number.isInteger(n) && n > 0 && n < 1_000_000_000)
    .slice(0, MAX_DISPATCHES);
}

/** The step output line. */
export function formatOutput(numbers) {
  return `numbers=${JSON.stringify(numbers)}\n`;
}

/** Reads the event, writes the step output, and returns the numbers. */
export function run({ eventPath, outputPath, log }) {
  if (!eventPath || !outputPath) throw new Error('GITHUB_EVENT_PATH and GITHUB_OUTPUT are required');
  const event = JSON.parse(readFileSync(eventPath, 'utf8'));
  const numbers = libraryPullRequestsToRecheck(event);
  appendFileSync(outputPath, formatOutput(numbers));
  const which = `Docs pull request #${event?.pull_request?.number} (${event?.action})`;
  log(numbers.length > 0
    ? `${which} names ${numbers.map((n) => `${LIBRARY_REPO}#${n}`).join(', ')}.`
    : `${which} names no library pull request to re-check.`);
  return numbers;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    run({ eventPath: process.env.GITHUB_EVENT_PATH, outputPath: process.env.GITHUB_OUTPUT, log: console.log });
  } catch (err) {
    console.error(`Library review re-check: could not read the event. ${err.message}`);
    process.exit(1);
  }
}
