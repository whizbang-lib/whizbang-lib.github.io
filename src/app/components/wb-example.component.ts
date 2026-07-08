import { Component, inject, Input, OnInit } from "@angular/core";
import { DomSanitizer, SafeResourceUrl } from "@angular/platform-browser";
import { ButtonModule } from "primeng/button";
import { DocsService } from "../services/docs.service";
import { ExampleMeta } from "../core/models";
import { CardModule } from "primeng/card";

@Component({
  selector: 'wb-example',
  standalone: true,
  imports: [ButtonModule, CardModule],
  template: `
    <p-card header="{{meta?.title}}">
      @if (meta) {
        <iframe [src]="safeSrc"
                width="100%" height="400" frameborder="0"></iframe>
      }
      <button pButton icon="pi pi-copy" label="Open"
              (click)="open()"></button>
    </p-card>
  `
})
export class WbExampleComponent implements OnInit {
  @Input({ required: true }) id = '';
  meta?: ExampleMeta;
  private docs = inject(DocsService);
  private sanitizer = inject(DomSanitizer);

  get safeSrc(): SafeResourceUrl | null {
    return this.meta ? this.sanitizer.bypassSecurityTrustResourceUrl(this.meta.stackblitz) : null;
  }

  ngOnInit() {
    this.docs.allExamples().subscribe(arr =>
      this.meta = arr.find(e => e.id === this.id)
    );
  }
  open() { window.open(this.meta!.stackblitz, '_blank'); }
}
