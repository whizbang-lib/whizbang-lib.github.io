import { ChangeDetectorRef, Component, Input, OnChanges, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TooltipModule } from 'primeng/tooltip';
import { TestStatusService, TestOutcome } from '../services/test-status.service';
import { VerifiedModalService } from '../services/verified-modal.service';

type BadgeState = 'pass' | 'fail' | 'unverified' | 'na';

/**
 * Coverage-map badge. Labels an example / section / diagram / table row with its
 * verification state, so gaps are visible rather than silent:
 *  - `pass`       — linked test(s) all found and passing (green)
 *  - `fail`       — a linked test is failing (red)
 *  - `unverified` — should have a test but none is linked, or the linked test
 *                   isn't in the latest run (amber "needs test") — the gap callout
 *  - `na`         — intentionally not verified, with a reason (muted; e.g. a
 *                   counter-example, or an API verified elsewhere)
 * Clicking a badge that has tests opens the focused modal via
 * {@link VerifiedModalService}. Used in code-block headers and — via
 * {@link VerifiedMarkerProcessor} — inline in prose, tables, and diagram captions.
 */
@Component({
  selector: 'wb-verified-badge',
  standalone: true,
  imports: [CommonModule, TooltipModule],
  template: `
    <button
      type="button"
      class="wb-vbadge"
      [class.pass]="state() === 'pass'"
      [class.fail]="state() === 'fail'"
      [class.unverified]="state() === 'unverified'"
      [class.na]="state() === 'na'"
      [class.actionable]="hasKeys()"
      [pTooltip]="tooltip()"
      tooltipPosition="top"
      [attr.aria-label]="tooltip()"
      (click)="open($event)"
    >
      <i class="pi" [ngClass]="icon()"></i>
      <span class="wb-vbadge-label" *ngIf="!compact || countLabel()">{{ label() }}</span>
    </button>
  `,
  styles: [
    `
      :host { display: inline-flex; vertical-align: baseline; }
      .wb-vbadge {
        display: inline-flex; align-items: center; gap: 0.25rem;
        padding: 0.05rem 0.45rem; border-radius: 1rem;
        font-size: 0.72rem; line-height: 1.4; font-weight: 600;
        border: 1px solid transparent; cursor: default;
        background: color-mix(in srgb, var(--p-text-color, #808080) 7%, transparent); color: var(--p-text-muted-color, #71717a);
        transition: filter 0.15s ease, box-shadow 0.15s ease;
      }
      .wb-vbadge.actionable { cursor: pointer; }
      .wb-vbadge.actionable:hover { filter: brightness(1.05); box-shadow: 0 0 0 2px color-mix(in srgb, var(--p-primary-color, #10b981) 25%, transparent); }
      .wb-vbadge .pi { font-size: 0.72rem; }
      .wb-vbadge.pass { background: color-mix(in srgb, var(--green-500, #22c55e) 15%, transparent); color: var(--green-600, #16a34a); }
      .wb-vbadge.fail { background: color-mix(in srgb, var(--red-500, #ef4444) 15%, transparent); color: var(--red-600, #dc2626); }
      .wb-vbadge.unverified { background: color-mix(in srgb, var(--orange-500, #f59e0b) 18%, transparent); color: var(--orange-700, #b45309); }
      .wb-vbadge.na { background: color-mix(in srgb, var(--p-text-color, #808080) 8%, transparent); color: var(--p-text-muted-color, #71717a); font-weight: 500; }
      .wb-vbadge-label { white-space: nowrap; }
    `,
  ],
})
export class VerifiedBadgeComponent implements OnInit, OnChanges, OnDestroy {
  /** Test keys `<ShortClassName>.<MethodName>` this element is verified by. */
  @Input() tests: string[] = [];
  /** When set (and no tests), marks the element intentionally-not-verified with this reason. */
  @Input() naReason?: string;
  /** Compact mode drops the word and shows just the icon (+ count when >1). */
  @Input() compact = false;

  private readonly testStatus = inject(TestStatusService);
  private readonly modal = inject(VerifiedModalService);
  private readonly cdr = inject(ChangeDetectorRef);
  private destroyed = false;

  readonly state = signal<BadgeState>('unverified');
  private readonly outcomes = signal<Map<string, TestOutcome | null>>(new Map());

  private keys(): string[] {
    return (this.tests || []).map((t) => t.trim()).filter(Boolean);
  }
  hasKeys(): boolean { return this.keys().length > 0; }

  readonly countLabel = computed(() => {
    const vals = [...this.outcomes().values()];
    const total = vals.length;
    if (total <= 1) return '';
    const passed = vals.filter((v) => v && v.o === 'passed').length;
    return `${passed}/${total}`;
  });

  readonly label = computed(() => {
    const s = this.state();
    if (this.compact) return s === 'pass' ? this.countLabel() : '';
    switch (s) {
      case 'pass': { const c = this.countLabel(); return c ? `verified ${c}` : 'verified'; }
      case 'fail': return 'failing';
      case 'na': return 'not verified';
      default: return this.hasKeys() ? 'unverified' : 'needs test';
    }
  });

  readonly icon = computed(() => {
    switch (this.state()) {
      case 'pass': return 'pi-verified';
      case 'fail': return 'pi-times-circle';
      case 'na': return 'pi-ban';
      default: return 'pi-exclamation-triangle';
    }
  });

  readonly tooltip = computed(() => {
    const keys = this.keys();
    const map = this.outcomes();
    switch (this.state()) {
      case 'na':
        return this.naReason ? `Not verified — ${this.naReason}` : 'Intentionally not verified';
      case 'unverified':
        return keys.length === 0
          ? 'No test linked yet — this example should be verified'
          : `Linked test(s) not in the latest run: ${keys.map(shortMethod).join(', ')}`;
      case 'fail':
      case 'pass': {
        if (keys.length === 1) {
          const o = map.get(keys[0]);
          const verb = o ? (o.o === 'passed' ? 'passed' : o.o) : 'no live status';
          return `${shortMethod(keys[0])} — ${verb}${o ? ` (${o.d}ms)` : ''} · click for detail`;
        }
        const vals = [...map.values()];
        const passed = vals.filter((v) => v && v.o === 'passed').length;
        const failed = vals.filter((v) => v && v.o === 'failed').length;
        const parts = [`${passed}/${keys.length} passing`];
        if (failed) parts.push(`${failed} failing`);
        return `${parts.join(', ')} — click for detail`;
      }
    }
  });

  // Load on init (covers dynamic createComponent() mounts where ngOnChanges
  // never fires) and on input changes (template-bound usage in code blocks).
  ngOnInit(): void { void this.load(); }
  ngOnChanges(): void { void this.load(); }
  ngOnDestroy(): void { this.destroyed = true; }

  private async load(): Promise<void> {
    const keys = this.keys();
    if (keys.length === 0) {
      this.set(this.naReason ? 'na' : 'unverified', new Map());
      return;
    }
    const idx = await this.testStatus.ensureIndex();
    if (!idx) {
      this.set('unverified', new Map<string, TestOutcome | null>(keys.map((k) => [k, null])));
      return;
    }
    const map = await this.testStatus.getTestStatuses(keys);
    const known = [...map.values()].filter((v): v is TestOutcome => !!v);
    if (known.some((v) => v.o === 'failed')) { this.set('fail', map); return; }
    // Fully verified only when every linked test is found and passing.
    this.set(known.length === keys.length && known.length > 0 ? 'pass' : 'unverified', map);
  }

  private set(state: BadgeState, outcomes: Map<string, TestOutcome | null>): void {
    if (this.destroyed) return;
    this.outcomes.set(outcomes);
    this.state.set(state);
    // The view may be detached (dynamically mounted badge) — self-check so the
    // async result renders regardless of the host's change-detection tree.
    // Guarded: a rare synchronous path could re-enter an in-flight CD pass.
    try { this.cdr.detectChanges(); } catch { /* will be picked up by next tick */ }
  }

  open(event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    if (this.hasKeys()) this.modal.open(this.keys());
  }
}

/** `DispatcherTests.Send_WithValidMessage_...Async` -> `Send_WithValidMessage_...Async`. */
function shortMethod(key: string): string {
  const dot = key.indexOf('.');
  return dot === -1 ? key : key.slice(dot + 1);
}
