import { Component, Input, OnChanges, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TestStatusService, ClassStatus, TestOutcome, TestStatusRun } from '../services/test-status.service';

interface MethodRow {
  method: string;
  key: string;
  outcome: TestOutcome;
}

interface ClassRow {
  path: string;
  className: string;
  githubUrl: string;
  status: ClassStatus | null;
  methods: MethodRow[] | null; // lazy — loaded when expanded
  expanded: boolean;
}

/**
 * Prominent, collapsible "Verified by tests" summary shown near the top of a doc
 * page — a manual, page-level browse. A compact button reports the page's
 * aggregate pass count; expanding it reveals each verifying test class, each of
 * which expands to its individual test methods with live pass/fail status.
 * (Inline badges instead open a focused modal — see {@link VerifiedModalService}.)
 * Degrades to a plain class list when no CI data is published.
 */
@Component({
  selector: 'wb-verified-summary',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="vsum" *ngIf="classRows().length > 0">
      <button type="button" class="vsum-toggle" [class.has-fail]="anyFail()" (click)="toggle()"
              [attr.aria-expanded]="expanded()">
        <i class="pi pi-verified"></i>
        <span class="vsum-title">Verified by tests</span>
        <span class="vsum-count" *ngIf="total() > 0"
              [class.pass]="!anyFail()" [class.fail]="anyFail()">
          {{ passed() }}/{{ total() }} passing
        </span>
        <span class="vsum-count muted" *ngIf="total() === 0">{{ classRows().length }} test classes</span>
        <i class="pi" [class.pi-chevron-down]="!expanded()" [class.pi-chevron-up]="expanded()"></i>
      </button>

      <div class="vsum-body" *ngIf="expanded()">
        <div class="vsum-run" *ngIf="run() as r">
          <ng-container *ngIf="r.runId">
            latest run
            <a [href]="'https://github.com/whizbang-lib/whizbang/actions/runs/' + r.runId" target="_blank" rel="noopener">#{{ r.runId }}</a>
            ({{ r.branch }})<span *ngIf="r.libraryVersion"> · v{{ r.libraryVersion }}</span>
          </ng-container>
          <span class="vsum-stale" *ngIf="staleDays() !== null && staleDays()! > 7">— {{ staleDays() }} days old</span>
        </div>

        <ul class="vsum-classes">
          <li *ngFor="let c of classRows()">
            <div class="vsum-class-head" (click)="toggleClass(c)">
              <i class="pi vsum-caret" [class.pi-caret-right]="!c.expanded" [class.pi-caret-down]="c.expanded"></i>
              <span class="vsum-badge"
                    [class.pass]="c.status && c.status.failed === 0"
                    [class.fail]="c.status && c.status.failed > 0"
                    [class.unknown]="!c.status">
                <ng-container *ngIf="c.status; else noStatus">
                  <i class="pi" [class.pi-check-circle]="c.status.failed === 0" [class.pi-times-circle]="c.status.failed > 0"></i>
                  {{ c.status.passed }}/{{ c.status.total }}
                </ng-container>
                <ng-template #noStatus><i class="pi pi-circle"></i> no status</ng-template>
              </span>
              <a class="vsum-class-name" [href]="c.githubUrl" target="_blank" rel="noopener" (click)="$event.stopPropagation()">{{ c.className }}</a>
            </div>

            <ul class="vsum-methods" *ngIf="c.expanded">
              <li *ngFor="let m of c.methods || []"
                  [class.pass]="m.outcome.o === 'passed'"
                  [class.fail]="m.outcome.o === 'failed'"
                  [class.skip]="m.outcome.o === 'skipped'">
                <i class="pi"
                   [class.pi-check-circle]="m.outcome.o === 'passed'"
                   [class.pi-times-circle]="m.outcome.o === 'failed'"
                   [class.pi-minus-circle]="m.outcome.o === 'skipped'"></i>
                <span class="vsum-method-name">{{ m.method }}</span>
                <span class="vsum-method-dur">{{ m.outcome.d }}ms</span>
              </li>
              <li class="vsum-empty" *ngIf="c.methods && c.methods.length === 0">no methods matched</li>
            </ul>
          </li>
        </ul>
      </div>
    </div>
  `,
  styles: [
    `
      .vsum { margin: 0.5rem 0 1.25rem; }
      .vsum-toggle {
        display: inline-flex; align-items: center; gap: 0.5rem;
        padding: 0.4rem 0.85rem; border-radius: 0.5rem; cursor: pointer;
        border: 1px solid var(--p-content-border-color, #e2e8f0); background: var(--p-content-background, #ffffff);
        color: var(--p-text-color, inherit); font-size: 0.9rem; font-weight: 600;
        transition: box-shadow 0.15s ease, border-color 0.15s ease;
      }
      .vsum-toggle:hover { border-color: var(--p-primary-color, #10b981); box-shadow: 0 0 0 2px color-mix(in srgb, var(--p-primary-color, #10b981) 15%, transparent); }
      .vsum-toggle > .pi-verified { color: var(--p-primary-color, #10b981); }
      .vsum-toggle.has-fail > .pi-verified { color: var(--red-500, #ef4444); }
      .vsum-count { padding: 0.05rem 0.5rem; border-radius: 1rem; font-size: 0.78rem; }
      .vsum-count.pass { background: color-mix(in srgb, var(--green-500, #22c55e) 15%, transparent); color: var(--green-600, #16a34a); }
      .vsum-count.fail { background: color-mix(in srgb, var(--red-500, #ef4444) 15%, transparent); color: var(--red-600, #dc2626); }
      .vsum-count.muted { background: color-mix(in srgb, var(--p-text-color, #808080) 7%, transparent); color: var(--p-text-muted-color, #71717a); }

      .vsum-body {
        margin-top: 0.5rem; padding: 0.75rem 1rem;
        border: 1px solid var(--p-content-border-color, #e2e8f0); border-left: 4px solid var(--p-primary-color, #10b981);
        border-radius: 0.5rem; background: var(--p-content-background, #ffffff); font-size: 0.88rem;
      }
      .vsum-run { color: var(--p-text-muted-color, #71717a); font-size: 0.8rem; margin-bottom: 0.5rem; }
      .vsum-stale { color: var(--orange-500, #f59e0b); margin-left: 0.35rem; }

      .vsum-classes, .vsum-methods { list-style: none; margin: 0; padding: 0; }
      .vsum-classes > li { padding: 0.15rem 0; border-radius: 0.35rem; }
      .vsum-classes > li.focused { background: color-mix(in srgb, var(--p-primary-color, #10b981) 12%, transparent); }
      .vsum-class-head { display: flex; align-items: center; gap: 0.5rem; cursor: pointer; padding: 0.15rem 0.25rem; }
      .vsum-caret { font-size: 0.7rem; color: var(--p-text-muted-color, #71717a); width: 0.8rem; }
      .vsum-badge {
        display: inline-flex; align-items: center; gap: 0.25rem; min-width: 3.4rem; justify-content: center;
        padding: 0.05rem 0.5rem; border-radius: 1rem; font-size: 0.76rem;
        background: color-mix(in srgb, var(--p-text-color, #808080) 7%, transparent); color: var(--p-text-muted-color, #71717a);
      }
      .vsum-badge.pass { background: color-mix(in srgb, var(--green-500, #22c55e) 15%, transparent); color: var(--green-600, #16a34a); }
      .vsum-badge.fail { background: color-mix(in srgb, var(--red-500, #ef4444) 15%, transparent); color: var(--red-600, #dc2626); }
      .vsum-class-name { font-family: var(--font-family-mono, monospace); color: var(--p-text-color, inherit); }

      .vsum-methods { margin: 0.1rem 0 0.35rem 2rem; }
      .vsum-methods > li { display: flex; align-items: center; gap: 0.45rem; padding: 0.08rem 0.35rem; border-radius: 0.3rem; font-size: 0.8rem; }
      .vsum-methods > li.pass > .pi { color: var(--green-600, #16a34a); }
      .vsum-methods > li.fail > .pi { color: var(--red-600, #dc2626); }
      .vsum-methods > li.skip > .pi { color: var(--p-text-muted-color, #71717a); }
      .vsum-methods > li.focused { background: color-mix(in srgb, var(--p-primary-color, #10b981) 18%, transparent); font-weight: 600; }
      .vsum-method-name { font-family: var(--font-family-mono, monospace); color: var(--p-text-color, inherit); }
      .vsum-method-dur { color: var(--p-text-muted-color, #71717a); font-size: 0.72rem; margin-left: auto; }
      .vsum-empty { color: var(--p-text-muted-color, #71717a); font-style: italic; padding-left: 0.35rem; }
    `,
  ],
})
export class VerifiedSummaryComponent implements OnChanges {
  /** `tests/...ClassNameTests.cs` paths from page frontmatter (`testReferences`). */
  @Input() testReferences: string[] = [];

  private readonly testStatus = inject(TestStatusService);

  readonly classRows = signal<ClassRow[]>([]);
  readonly expanded = signal(false);
  readonly run = signal<TestStatusRun | null>(null);
  readonly staleDays = signal<number | null>(null);

  readonly total = computed(() => this.classRows().reduce((n, c) => n + (c.status?.total ?? 0), 0));
  readonly passed = computed(() => this.classRows().reduce((n, c) => n + (c.status?.passed ?? 0), 0));
  readonly anyFail = computed(() => this.classRows().some((c) => (c.status?.failed ?? 0) > 0));

  async ngOnChanges(): Promise<void> {
    const refs = (this.testReferences || []).filter((p) => p.endsWith('.cs'));
    const rows: ClassRow[] = refs.map((path) => ({
      path,
      className: path.split('/').pop()!.replace(/\.cs$/, ''),
      githubUrl: `https://github.com/whizbang-lib/whizbang/blob/develop/${path}`,
      status: null,
      methods: null,
      expanded: false,
    }));
    this.classRows.set(rows);
    if (rows.length === 0) return;

    const idx = await this.testStatus.ensureIndex();
    if (!idx) return; // no data — plain class list on expand
    this.run.set(idx.run);
    this.staleDays.set(this.testStatus.staleDays());
    const withStatus = await Promise.all(
      rows.map(async (r) => ({ ...r, status: await this.testStatus.getClassStatus(r.className) }))
    );
    this.classRows.set(withStatus);
  }

  toggle(): void { this.expanded.update((v) => !v); }

  async toggleClass(row: ClassRow): Promise<void> {
    row.expanded = !row.expanded;
    if (row.expanded && row.methods === null) {
      row.methods = await this.testStatus.getClassMethods(row.className);
    }
    this.classRows.set([...this.classRows()]);
  }

}
