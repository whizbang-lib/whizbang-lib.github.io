import { Component, HostListener, computed, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TestStatusService, TestOutcome, TestStatusRun } from '../services/test-status.service';
import { VerifiedModalService } from '../services/verified-modal.service';

interface ModalRow {
  method: string;
  key: string;
  outcome: TestOutcome | null;
}
interface ModalGroup {
  className: string;
  githubUrl: string;
  rows: ModalRow[];
}

/**
 * Single app-level modal that shows the exact test(s) behind one inline
 * verified badge. Opened via {@link VerifiedModalService} (which a badge calls
 * with its own keys), so it always highlights just that example / section /
 * table-row / diagram's verifying tests — distinct from the page-level header
 * collapsible, which browses every test on the page.
 *
 * Intentionally NOT a PrimeNG dialog: its scrim is scoped to the doc content
 * column (measured from `main.main-content` at open time) so it centers over the
 * content the reader is looking at — not the whole viewport — and never blacks
 * out the fixed left navigation. Re-measures on resize so it tracks the nav's
 * open/closed state.
 */
@Component({
  selector: 'wb-verified-modal',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div
      class="wb-vmodal-backdrop"
      *ngIf="visible()"
      [style.left.px]="maskLeft()"
      [style.width.px]="maskWidth()"
      (click)="close()"
    >
      <div class="wb-vmodal-card" role="dialog" aria-modal="true" (click)="$event.stopPropagation()">
        <div class="wb-vmodal-header" [class.fail]="anyFail()">
          <span class="wb-vmodal-title">
            <i class="pi" [class.pi-verified]="!anyFail()" [class.pi-times-circle]="anyFail()"></i>
            Verified by tests
          </span>
          <button type="button" class="wb-vmodal-close" (click)="close()" aria-label="Close">
            <i class="pi pi-times"></i>
          </button>
        </div>

        <div class="wb-vmodal-body">
          <p class="wb-vmodal-intro">
            This is verified by the following {{ totalKeys() === 1 ? 'test' : totalKeys() + ' tests' }}:
          </p>

          <div class="wb-vmodal-group" *ngFor="let g of groups()">
            <a class="wb-vmodal-class" [href]="g.githubUrl" target="_blank" rel="noopener">
              {{ g.className }} <i class="pi pi-external-link"></i>
            </a>
            <ul class="wb-vmodal-methods">
              <li *ngFor="let m of g.rows"
                  [class.pass]="m.outcome?.o === 'passed'"
                  [class.fail]="m.outcome?.o === 'failed'"
                  [class.skip]="m.outcome?.o === 'skipped'"
                  [class.unknown]="!m.outcome">
                <i class="pi"
                   [class.pi-check-circle]="m.outcome?.o === 'passed'"
                   [class.pi-times-circle]="m.outcome?.o === 'failed'"
                   [class.pi-minus-circle]="m.outcome?.o === 'skipped'"
                   [class.pi-circle]="!m.outcome"></i>
                <span class="wb-vmodal-method">{{ m.method }}</span>
                <span class="wb-vmodal-dur" *ngIf="m.outcome">{{ m.outcome.d }}ms</span>
                <span class="wb-vmodal-dur" *ngIf="!m.outcome">no live status</span>
              </li>
            </ul>
          </div>
        </div>

        <div class="wb-vmodal-footer">
          <span class="wb-vmodal-run" *ngIf="run() as r; else noRun">
            <ng-container *ngIf="r.runId">
              latest run
              <a [href]="'https://github.com/whizbang-lib/whizbang/actions/runs/' + r.runId" target="_blank" rel="noopener">#{{ r.runId }}</a>
              ({{ r.branch }})<span *ngIf="r.libraryVersion"> · v{{ r.libraryVersion }}</span>
            </ng-container>
          </span>
          <ng-template #noRun><span class="wb-vmodal-run">live CI status not published</span></ng-template>
        </div>
      </div>
    </div>
  `,
  styles: [
    `
      .wb-vmodal-backdrop {
        position: fixed; top: 0; bottom: 0; z-index: 1200;
        display: flex; align-items: center; justify-content: center; padding: 1rem;
        background: color-mix(in srgb, #000 20%, transparent);
        backdrop-filter: blur(2px);
        animation: wb-vmodal-fade 0.12s ease-out;
      }
      @keyframes wb-vmodal-fade { from { opacity: 0; } to { opacity: 1; } }
      .wb-vmodal-card {
        width: min(100%, 560px); max-height: 80vh; overflow: auto;
        background: var(--p-content-background, #ffffff); color: var(--p-text-color, inherit);
        border: 1px solid var(--p-content-border-color, #e2e8f0); border-radius: 0.75rem;
        box-shadow: 0 12px 44px rgba(0, 0, 0, 0.35);
      }
      .wb-vmodal-header {
        display: flex; align-items: center; justify-content: space-between;
        padding: 0.85rem 1rem; border-bottom: 1px solid var(--p-content-border-color, #e2e8f0);
      }
      .wb-vmodal-title { display: inline-flex; align-items: center; gap: 0.5rem; font-weight: 700; }
      .wb-vmodal-title > .pi-verified { color: var(--p-primary-color, #10b981); }
      .wb-vmodal-header.fail .pi-times-circle { color: var(--red-500, #ef4444); }
      .wb-vmodal-close {
        background: none; border: none; cursor: pointer; color: var(--p-text-muted-color, #71717a);
        padding: 0.25rem; border-radius: 0.35rem; display: inline-flex;
      }
      .wb-vmodal-close:hover { background: color-mix(in srgb, var(--p-text-color, #808080) 12%, transparent); color: var(--p-text-color, inherit); }
      .wb-vmodal-body { padding: 0.9rem 1rem; }
      .wb-vmodal-intro { margin: 0 0 0.75rem; color: var(--p-text-muted-color, #71717a); font-size: 0.9rem; }
      .wb-vmodal-group { margin-bottom: 0.9rem; }
      .wb-vmodal-group:last-child { margin-bottom: 0; }
      .wb-vmodal-class {
        display: inline-flex; align-items: center; gap: 0.3rem; margin-bottom: 0.3rem;
        font-family: var(--font-family-mono, monospace); font-weight: 600; color: var(--p-primary-color, #10b981);
      }
      .wb-vmodal-class .pi { font-size: 0.7rem; }
      .wb-vmodal-methods { list-style: none; margin: 0; padding: 0; }
      .wb-vmodal-methods > li {
        display: flex; align-items: center; gap: 0.5rem; padding: 0.3rem 0.5rem;
        border-radius: 0.4rem; font-size: 0.85rem; background: color-mix(in srgb, var(--p-text-color, #808080) 7%, transparent);
        margin-bottom: 0.25rem; border-left: 3px solid transparent;
      }
      .wb-vmodal-methods > li.pass { border-left-color: var(--green-500, #22c55e); }
      .wb-vmodal-methods > li.pass > .pi { color: var(--green-600, #16a34a); }
      .wb-vmodal-methods > li.fail { border-left-color: var(--red-500, #ef4444); }
      .wb-vmodal-methods > li.fail > .pi { color: var(--red-600, #dc2626); }
      .wb-vmodal-methods > li.skip > .pi, .wb-vmodal-methods > li.unknown > .pi { color: var(--p-text-muted-color, #71717a); }
      .wb-vmodal-method { font-family: var(--font-family-mono, monospace); word-break: break-word; }
      .wb-vmodal-dur { color: var(--p-text-muted-color, #71717a); font-size: 0.72rem; margin-left: auto; white-space: nowrap; }
      .wb-vmodal-footer { padding: 0.6rem 1rem; border-top: 1px solid var(--p-content-border-color, #e2e8f0); }
      .wb-vmodal-run { color: var(--p-text-muted-color, #71717a); font-size: 0.8rem; }
      @media (max-width: 768px) {
        /* On mobile the nav is an overlay drawer; center over the full viewport. */
        .wb-vmodal-backdrop { left: 0 !important; width: 100vw !important; }
      }
    `,
  ],
})
export class VerifiedModalComponent {
  private readonly testStatus = inject(TestStatusService);
  private readonly modal = inject(VerifiedModalService);

  readonly visible = signal(false);
  readonly groups = signal<ModalGroup[]>([]);
  readonly run = signal<TestStatusRun | null>(null);
  readonly maskLeft = signal(0);
  readonly maskWidth = signal(0);

  readonly totalKeys = computed(() => this.groups().reduce((n, g) => n + g.rows.length, 0));
  readonly anyFail = computed(() => this.groups().some((g) => g.rows.some((r) => r.outcome?.o === 'failed')));

  constructor() {
    effect(() => {
      const req = this.modal.request();
      if (req.nonce > 0 && req.keys.length > 0) void this.show(req.keys);
    });
  }

  @HostListener('document:keydown.escape')
  close(): void { this.visible.set(false); }

  @HostListener('window:resize')
  onResize(): void { if (this.visible()) this.measureContentRegion(); }

  /** Scope the scrim + centering to the doc content column (right of the nav). */
  private measureContentRegion(): void {
    const el = document.querySelector('main.main-content');
    if (el) {
      const r = el.getBoundingClientRect();
      this.maskLeft.set(Math.round(r.left));
      this.maskWidth.set(Math.round(r.width));
    } else {
      this.maskLeft.set(0);
      this.maskWidth.set(window.innerWidth);
    }
  }

  private async show(keys: string[]): Promise<void> {
    const order: string[] = [];
    const byClass = new Map<string, ModalRow[]>();
    for (const key of keys) {
      const dot = key.indexOf('.');
      const className = dot === -1 ? key : key.slice(0, dot);
      const method = dot === -1 ? key : key.slice(dot + 1);
      if (!byClass.has(className)) { byClass.set(className, []); order.push(className); }
      byClass.get(className)!.push({ method, key, outcome: null });
    }
    this.groups.set(order.map((className) => ({ className, githubUrl: githubSearchUrl(className), rows: byClass.get(className)! })));
    this.measureContentRegion();
    this.visible.set(true);
    // Re-measure once layout has settled (guards a first-open race where the
    // nav column hasn't been positioned yet, which would center over the viewport).
    requestAnimationFrame(() => this.measureContentRegion());

    const idx = await this.testStatus.ensureIndex();
    this.run.set(idx?.run ?? null);
    if (!idx) return;
    const statuses = await this.testStatus.getTestStatuses(keys);
    this.groups.set(
      order.map((className) => ({
        className,
        githubUrl: githubSearchUrl(className),
        rows: byClass.get(className)!.map((r) => ({ ...r, outcome: statuses.get(r.key) ?? null })),
      }))
    );
  }
}

/** Best-effort GitHub link to a test class (search — we only have the class name here). */
function githubSearchUrl(className: string): string {
  return `https://github.com/search?q=repo%3Awhizbang-lib%2Fwhizbang+${encodeURIComponent(className)}&type=code`;
}
