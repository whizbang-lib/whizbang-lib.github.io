import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ButtonModule } from 'primeng/button';
import { MessageService } from 'primeng/api';
import { GlobalToastService } from './services/global-toast.service';

@Component({
  selector: 'app-test-toast',
  standalone: true,
  imports: [CommonModule, ButtonModule],
  template: `
    <div style="padding: 20px;">
      <h2>Toast Test</h2>
      <div style="display: flex; flex-direction: column; gap: 10px; max-width: 300px;">
        <h3>Global Toast Service Examples</h3>
        <button pButton
                class="p-button-outlined p-button-success"
                (click)="showSuccessToast()"><span pButtonLabel>Success Toast</span></button>
        <button pButton
                class="p-button-outlined p-button-primary"
                (click)="showInfoToast()"><span pButtonLabel>Info Toast</span></button>
        <button pButton
                class="p-button-outlined p-button-warn"
                (click)="showWarningToast()"><span pButtonLabel>Warning Toast</span></button>
        <button pButton
                class="p-button-outlined p-button-danger"
                (click)="showErrorToast()"><span pButtonLabel>Error Toast</span></button>
        <button pButton
                class="p-button-outlined p-button-secondary"
                (click)="showStickyToast()"><span pButtonLabel>Sticky Toast</span></button>
      </div>
      <p>Screen width: {{ screenWidth }}px</p>
    </div>
`
})
export class TestToastComponent implements OnInit {
  screenWidth = typeof window !== 'undefined' ? window.innerWidth : 0;
  private progressValue = 0;
  private progressInterval: any;

  constructor(
    private messageService: MessageService,
    private globalToast: GlobalToastService
  ) {
    if (typeof window !== 'undefined') {
      window.addEventListener('resize', () => {
        this.screenWidth = window.innerWidth;
      });
    }
  }

  ngOnInit() {
    // Add just one sticky toast
    setTimeout(() => {
      this.messageService.add({
        severity: 'info',
        summary: 'Auto-Loaded Sticky Toast',
        detail: 'This sticky toast automatically opened when the page loaded. It should fit perfectly within the 375px viewport and stay until manually closed.',
        life: 0, // Don't auto-close
        sticky: true, // Real sticky toast!
        closable: true
      });
    }, 500);
  }

  showSuccessToast() {
    this.globalToast.success('Operation completed successfully!');
  }

  showInfoToast() {
    this.globalToast.info('Here is some useful information for you.');
  }

  showWarningToast() {
    this.globalToast.warn('Please review this important warning.');
  }

  showErrorToast() {
    this.globalToast.error('An error occurred while processing your request.');
  }

  showStickyToast() {
    this.globalToast.show('info', 'Sticky Notification', 
      'This toast will stay until you manually close it.', 
      { sticky: true, life: 0 }
    );
  }
}