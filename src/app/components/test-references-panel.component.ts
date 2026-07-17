import { Component, Input, OnChanges, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TestStatusService, ClassStatus, TestStatusRun } from '../services/test-status.service';

interface TestRefRow {
  path: string; // tests/Whizbang.Core.Tests/Security/SecurityContextHelperTests.cs
  className: string; // SecurityContextHelperTests
  githubUrl: string;
  status: ClassStatus | null;
}

/**
 * Living-docs panel: renders a page's `testReferences` frontmatter with live
 * pass/fail status from the latest library CI run (when published). Degrades
 * to a plain list of verifying tests when no status data is available.
 */
@Component({
  selector: 'wb-test-references',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="test-refs" *ngIf="rows().length > 0">
      <div class="test-refs-header">
        <i class="pi pi-verified"></i>
        <span class="test-refs-title">Verified by tests</span>
        <span class="test-refs-run" *ngIf="run() as r">
          <ng-container *ngIf="r.runId">
            run <a [href]="'https://github.com/whizbang-lib/whizbang/actions/runs/' + r.runId"
                   target="_blank" rel="noopener">#{{ r.runId }}</a>
            ({{ r.branch }})
          </ng-container>
          <span class="test-refs-stale" *ngIf="staleDays() !== null && staleDays()! > 7">
            — results {{ staleDays() }} days old
          </span>
        </span>
      </div>
      <ul class="test-refs-list">
        <li *ngFor="let row of rows()">
          <span class="test-refs-badge"
                [class.pass]="row.status && row.status.failed === 0"
                [class.fail]="row.status && row.status.failed > 0"
                [class.unknown]="!row.status">
            <ng-container *ngIf="row.status; else unknownTpl">
              <i class="pi" [class.pi-check-circle]="row.status.failed === 0"
                 [class.pi-times-circle]="row.status.failed > 0"></i>
              {{ row.status.passed }}/{{ row.status.total }} passing
            </ng-container>
            <ng-template #unknownTpl><i class="pi pi-circle"></i> no status</ng-template>
          </span>
          <a [href]="row.githubUrl" target="_blank" rel="noopener">{{ row.className }}</a>
        </li>
      </ul>
    </div>
  `,
  styles: [`
    .test-refs {
      margin: 2rem 0 1rem;
      padding: 0.75rem 1rem;
      border: 1px solid var(--surface-border);
      border-left: 4px solid var(--primary-color);
      border-radius: 0.5rem;
      background: var(--surface-card);
      font-size: 0.9rem;
    }
    .test-refs-header {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      font-weight: 600;
      margin-bottom: 0.5rem;
    }
    .test-refs-run { font-weight: 400; color: var(--text-color-secondary); }
    .test-refs-stale { color: var(--orange-500, #f59e0b); }
    .test-refs-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.25rem; }
    .test-refs-list li { display: flex; align-items: center; gap: 0.5rem; }
    .test-refs-badge {
      display: inline-flex; align-items: center; gap: 0.25rem;
      padding: 0.05rem 0.5rem; border-radius: 1rem; font-size: 0.8rem;
      background: var(--surface-ground); color: var(--text-color-secondary);
    }
    .test-refs-badge.pass { background: color-mix(in srgb, var(--green-500, #22c55e) 15%, transparent); color: var(--green-600, #16a34a); }
    .test-refs-badge.fail { background: color-mix(in srgb, var(--red-500, #ef4444) 15%, transparent); color: var(--red-600, #dc2626); }
  `],
})
export class TestReferencesPanelComponent implements OnChanges {
  @Input() testReferences: string[] = [];

  private testStatus = inject(TestStatusService);

  readonly rows = signal<TestRefRow[]>([]);
  readonly run = signal<TestStatusRun | null>(null);
  readonly staleDays = signal<number | null>(null);

  async ngOnChanges(): Promise<void> {
    const refs = (this.testReferences || []).filter((p) => p.endsWith('.cs'));
    const rows: TestRefRow[] = refs.map((path) => {
      const className = path.split('/').pop()!.replace(/\.cs$/, '');
      return {
        path,
        className,
        githubUrl: `https://github.com/whizbang-lib/whizbang/blob/develop/${path}`,
        status: null,
      };
    });
    this.rows.set(rows);
    if (rows.length === 0) return;

    const idx = await this.testStatus.ensureIndex();
    if (!idx) return; // pipeline not publishing yet — plain list stays
    this.run.set(idx.run);
    this.staleDays.set(this.testStatus.staleDays());
    const withStatus = await Promise.all(
      rows.map(async (row) => ({ ...row, status: await this.testStatus.getClassStatus(row.className) }))
    );
    this.rows.set(withStatus);
  }
}
