// Guards for the generators that scan a library checkout and overwrite a committed map.
//
// Without a library to scan, a generator used to find nothing and write an empty map over the committed one,
// exiting 0. That happens whenever the default sibling path (../whizbang beside this repo) is wrong, as it is
// from a git worktree or any other clone location. These guards make that a failure that writes nothing.

import { existsSync, statSync } from 'fs';

const HINT = 'Set WHIZBANG_LIB_PATH to a whizbang library checkout.';

/** Throws unless libraryPath is an existing directory. */
export function requireLibrary(libraryPath) {
  if (!existsSync(libraryPath) || !statSync(libraryPath).isDirectory()) {
    throw new Error(`Library path ${libraryPath} does not exist; the map was not written. ${HINT}`);
  }
}

/** Throws when a scan found none of what every library checkout has, so an empty result is never written. */
export function requireFound(count, what, libraryPath) {
  if (count === 0) {
    throw new Error(`Found ${what} under ${libraryPath}; the map was not written. ${HINT}`);
  }
}
