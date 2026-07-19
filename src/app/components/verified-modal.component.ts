import { Component, computed, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DialogModule } from 'primeng/dialog';
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
 */
@Component({
  selector: 'wb-verified-modal',
  standalone: true,
  imports: [CommonModule, DialogModule],
  template: `
    <p-dialog
      [visible]="visible()"
      (visibleChange)="visible.set($event)"
      [modal]="true"
      [dismissableMask]="true"
      [draggable]="false"
      [resizable]="false"
      [style]="{ width: '90vw', maxWidth: '640px' }"
      styleClass="wb-vmodal"
    >
      <ng-template pTemplate="header">
        <span class="wb-vmodal-head" [class.fail]="anyFail()">
          <i class="pi" [class.pi-verified]="!anyFail()" [class.pi-times-circle]="anyFail()"></i>
          Verified by tests
        </span>
      </ng-template>

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

      <ng-template pTemplate="footer">
        <span class="wb-vmodal-run" *ngIf="run() as r; else noRun">
          <ng-container *ngIf="r.runId">
            latest run
            <a [href]="'https://github.com/whizbang-lib/whizbang/actions/runs/' + r.runId" target="_blank" rel="noopener">#{{ r.runId }}</a>
            ({{ r.branch }})<span *ngIf="r.libraryVersion"> · v{{ r.libraryVersion }}</span>
          </ng-container>
        </span>
        <ng-template #noRun><span class="wb-vmodal-run">live CI status not published</span></ng-template>
      </ng-template>
    </p-dialog>
  `,
  styles: [
    `
      .wb-vmodal-head { display: inline-flex; align-items: center; gap: 0.5rem; font-weight: 700; }
      .wb-vmodal-head > .pi-verified { color: var(--primary-color); }
      .wb-vmodal-head.fail > .pi { color: var(--red-500, #ef4444); }
      .wb-vmodal-intro { margin: 0 0 0.75rem; color: var(--text-color-secondary); font-size: 0.9rem; }
      .wb-vmodal-group { margin-bottom: 0.9rem; }
      .wb-vmodal-class {
        display: inline-flex; align-items: center; gap: 0.3rem; margin-bottom: 0.3rem;
        font-family: var(--font-family-mono, monospace); font-weight: 600; color: var(--primary-color);
      }
      .wb-vmodal-class .pi { font-size: 0.7rem; }
      .wb-vmodal-methods { list-style: none; margin: 0; padding: 0; }
      .wb-vmodal-methods > li {
        display: flex; align-items: center; gap: 0.5rem; padding: 0.3rem 0.5rem;
        border-radius: 0.4rem; font-size: 0.85rem; background: var(--surface-ground);
        margin-bottom: 0.25rem; border-left: 3px solid transparent;
      }
      .wb-vmodal-methods > li.pass { border-left-color: var(--green-500, #22c55e); }
      .wb-vmodal-methods > li.pass > .pi { color: var(--green-600, #16a34a); }
      .wb-vmodal-methods > li.fail { border-left-color: var(--red-500, #ef4444); }
      .wb-vmodal-methods > li.fail > .pi { color: var(--red-600, #dc2626); }
      .wb-vmodal-methods > li.skip > .pi, .wb-vmodal-methods > li.unknown > .pi { color: var(--text-color-secondary); }
      .wb-vmodal-method { font-family: var(--font-family-mono, monospace); color: var(--text-color); word-break: break-word; }
      .wb-vmodal-dur { color: var(--text-color-secondary); font-size: 0.72rem; margin-left: auto; white-space: nowrap; }
      .wb-vmodal-run { color: var(--text-color-secondary); font-size: 0.8rem; }
    `,
  ],
})
export class VerifiedModalComponent {
  private readonly testStatus = inject(TestStatusService);
  private readonly modal = inject(VerifiedModalService);

  readonly visible = signal(false);
  readonly groups = signal<ModalGroup[]>([]);
  readonly run = signal<TestStatusRun | null>(null);

  readonly totalKeys = computed(() => this.groups().reduce((n, g) => n + g.rows.length, 0));
  readonly anyFail = computed(() => this.groups().some((g) => g.rows.some((r) => r.outcome?.o === 'failed')));

  constructor() {
    effect(() => {
      const req = this.modal.request();
      if (req.nonce > 0 && req.keys.length > 0) void this.show(req.keys);
    });
  }

  private async show(keys: string[]): Promise<void> {
    // Group by short class name, preserving reference order.
    const order: string[] = [];
    const byClass = new Map<string, ModalRow[]>();
    for (const key of keys) {
      const dot = key.indexOf('.');
      const className = dot === -1 ? key : key.slice(0, dot);
      const method = dot === -1 ? key : key.slice(dot + 1);
      if (!byClass.has(className)) { byClass.set(className, []); order.push(className); }
      byClass.get(className)!.push({ method, key, outcome: null });
    }
    // Show immediately (statuses fill in once loaded).
    this.groups.set(order.map((className) => ({ className, githubUrl: githubSearchUrl(className), rows: byClass.get(className)! })));
    this.visible.set(true);

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
