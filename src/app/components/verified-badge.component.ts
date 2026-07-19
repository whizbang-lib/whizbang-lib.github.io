import { ChangeDetectorRef, Component, Input, OnChanges, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TooltipModule } from 'primeng/tooltip';
import { TestStatusService, TestOutcome } from '../services/test-status.service';
import { VerifiedModalService } from '../services/verified-modal.service';

type BadgeState = 'pass' | 'fail' | 'partial' | 'unknown' | 'nodata';

/**
 * Inline "verified by tests" badge. Given one or more `<ShortClassName>.<Method>`
 * keys, it shows live pass/fail status from the latest library CI run and, on
 * click, asks the page's "Verified by tests" collapsible to open and focus those
 * tests. Used both inside code-block headers and — via {@link VerifiedMarkerProcessor}
 * — inline in prose, table cells, and diagram captions. Degrades to a neutral
 * "verified" chip when no status data is published.
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
      [class.fail]="state() === 'fail' || state() === 'partial'"
      [class.unknown]="state() === 'unknown' || state() === 'nodata'"
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
        border: 1px solid transparent; cursor: pointer;
        background: color-mix(in srgb, var(--p-text-color, #808080) 7%, transparent); color: var(--p-text-muted-color, #71717a);
        transition: filter 0.15s ease, box-shadow 0.15s ease;
      }
      .wb-vbadge:hover { filter: brightness(1.05); box-shadow: 0 0 0 2px color-mix(in srgb, var(--p-primary-color, #10b981) 25%, transparent); }
      .wb-vbadge .pi { font-size: 0.72rem; }
      .wb-vbadge.pass { background: color-mix(in srgb, var(--green-500, #22c55e) 15%, transparent); color: var(--green-600, #16a34a); }
      .wb-vbadge.fail { background: color-mix(in srgb, var(--red-500, #ef4444) 15%, transparent); color: var(--red-600, #dc2626); }
      .wb-vbadge.unknown { background: color-mix(in srgb, var(--p-text-color, #808080) 7%, transparent); color: var(--p-text-muted-color, #71717a); }
      .wb-vbadge-label { white-space: nowrap; }
    `,
  ],
})
export class VerifiedBadgeComponent implements OnInit, OnChanges, OnDestroy {
  /** Test keys `<ShortClassName>.<MethodName>` this element is verified by. */
  @Input() tests: string[] = [];
  /** Optional visible word override (default "verified"/"failing"). */
  @Input() word?: string;
  /** Compact mode drops the word and shows just the icon (+ count when >1). */
  @Input() compact = false;

  private readonly testStatus = inject(TestStatusService);
  private readonly modal = inject(VerifiedModalService);
  private readonly cdr = inject(ChangeDetectorRef);
  private destroyed = false;

  readonly state = signal<BadgeState>('unknown');
  private readonly outcomes = signal<Map<string, TestOutcome | null>>(new Map());

  private keys(): string[] {
    return (this.tests || []).map((t) => t.trim()).filter(Boolean);
  }

  readonly countLabel = computed(() => {
    const vals = [...this.outcomes().values()];
    const total = vals.length;
    if (total <= 1) return '';
    const passed = vals.filter((v) => v && v.o === 'passed').length;
    return `${passed}/${total}`;
  });

  readonly label = computed(() => {
    const count = this.countLabel();
    if (this.compact) return count; // icon-only unless multiple
    const word = this.word ?? (this.state() === 'fail' ? 'failing' : this.state() === 'partial' ? 'partial' : 'verified');
    return count ? `${word} ${count}` : word;
  });

  readonly icon = computed(() => {
    switch (this.state()) {
      case 'pass': return 'pi-verified';
      case 'fail': return 'pi-times-circle';
      case 'partial': return 'pi-exclamation-circle';
      default: return 'pi-circle';
    }
  });

  readonly tooltip = computed(() => {
    const keys = this.keys();
    const map = this.outcomes();
    if (this.state() === 'nodata') {
      return `Verified by ${keys.map(shortMethod).join(', ')} (live status unavailable)`;
    }
    if (keys.length === 1) {
      const o = map.get(keys[0]);
      const verb = o ? (o.o === 'passed' ? 'passed' : o.o) : 'no live status';
      return `${shortMethod(keys[0])} — ${verb}${o ? ` (${o.d}ms)` : ''}`;
    }
    const vals = [...map.values()];
    const passed = vals.filter((v) => v && v.o === 'passed').length;
    const failed = vals.filter((v) => v && v.o === 'failed').length;
    const parts = [`${passed}/${keys.length} passing`];
    if (failed) parts.push(`${failed} failing`);
    return `${parts.join(', ')} — click for detail`;
  });

  // Load on init (covers dynamic createComponent() mounts where ngOnChanges
  // never fires) and on input changes (template-bound usage in code blocks).
  ngOnInit(): void { void this.load(); }
  ngOnChanges(): void { void this.load(); }
  ngOnDestroy(): void { this.destroyed = true; }

  private async load(): Promise<void> {
    const keys = this.keys();
    if (keys.length === 0) { this.set('nodata', new Map()); return; }
    const idx = await this.testStatus.ensureIndex();
    if (!idx) {
      this.set('nodata', new Map<string, TestOutcome | null>(keys.map((k) => [k, null])));
      return;
    }
    const map = await this.testStatus.getTestStatuses(keys);
    const known = [...map.values()].filter((v): v is TestOutcome => !!v);
    if (known.length === 0) { this.set('unknown', map); return; }
    if (known.some((v) => v.o === 'failed')) { this.set('fail', map); return; }
    this.set(known.length === keys.length ? 'pass' : 'partial', map);
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
    this.modal.open(this.keys());
  }
}

/** `DispatcherTests.Send_WithValidMessage_...Async` -> `Send_WithValidMessage_...Async`. */
function shortMethod(key: string): string {
  const dot = key.indexOf('.');
  return dot === -1 ? key : key.slice(dot + 1);
}
