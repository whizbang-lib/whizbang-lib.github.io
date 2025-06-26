import { Component, Input, ViewChild, ElementRef } from '@angular/core';
import { ButtonModule } from 'primeng/button';

@Component({
  standalone: true,
  imports: [ButtonModule],
  selector: 'wb-code',
  template: `
    <pre><code #codeEl [innerHTML]="content"></code></pre>
    <button pButton icon="pi pi-copy" class="copy-btn" (click)="copy()"></button>
  `,
  styles: [`.copy-btn{position:absolute;top:8px;right:8px}`]
})
export class CodeViewerComponent {
  @Input() content = '';
  @ViewChild('codeEl', { static: true }) codeEl!: ElementRef<HTMLElement>;
  copy() {
    navigator.clipboard.writeText(this.codeEl.nativeElement.innerText);
  }
}
