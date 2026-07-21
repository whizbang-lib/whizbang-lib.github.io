import { Injectable, signal } from '@angular/core';

/**
 * Opens a focused "verified by tests" modal for a specific inline badge. A badge
 * (in prose, a table cell, a diagram caption, or a code-block header) calls
 * `open(keys)` with just its own test keys; the single app-level
 * {@link VerifiedModalComponent} listens and shows those exact tests. This is
 * deliberately separate from the page-level header collapsible, which stays a
 * manual browse of every test on the page. The `nonce` makes repeated opens of
 * the same keys distinct so the modal re-triggers.
 */
@Injectable({ providedIn: 'root' })
export class VerifiedModalService {
  private readonly _request = signal<{ keys: string[]; nonce: number }>({ keys: [], nonce: 0 });

  /** Latest open-request: the exact test keys to display and a rising nonce. */
  readonly request = this._request.asReadonly();

  open(keys: string[]): void {
    this._request.update((r) => ({ keys: [...keys], nonce: r.nonce + 1 }));
  }
}
