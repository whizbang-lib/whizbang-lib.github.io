import { Component, inject, Input, OnInit } from "@angular/core";
import { ButtonModule } from "primeng/button";
import { DocsService } from "../services/docs.service";
import { ExampleMeta } from "../core/models";

@Component({
  selector: 'wb-example',
  standalone: true,
  imports: [ButtonModule],
  template: `
    <p-card header="{{meta?.title}}">
      <iframe *ngIf="meta"
              [src]="meta.stackblitz | safeUrl"
              width="100%" height="400" frameborder="0"></iframe>
      <button pButton icon="pi pi-copy" label="Open"
              (click)="open()"></button>
    </p-card>
  `
})
export class WbExampleComponent implements OnInit {
  @Input({ required: true }) id = '';
  meta?: ExampleMeta;
  private docs = inject(DocsService);

  ngOnInit() {
    this.docs.allExamples().subscribe(arr =>
      this.meta = arr.find(e => e.id === this.id)
    );
  }
  open() { window.open(this.meta!.stackblitz, '_blank'); }
}
