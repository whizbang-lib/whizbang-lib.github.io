import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ToastModule } from 'primeng/toast';
import { MessageService } from 'primeng/api';

@Component({
  selector: 'wb-global-toast',
  standalone: true,
  imports: [CommonModule, ToastModule],
  template: `
    <p-toast position="bottom-right" [baseZIndex]="1000" key="global" 
             styleClass="mobile-toast-fix global-toast">
    </p-toast>
  `,
  styles: [`
    /* Global toast styling - enhanced glassmorphism for all toast types */
    :host ::ng-deep .global-toast .p-toast-message,
    :host ::ng-deep .mobile-toast-fix .p-toast-message {
      background: rgba(255, 255, 255, 0.02) !important;
      backdrop-filter: blur(5px) saturate(200%) !important;
      -webkit-backdrop-filter: blur(5px) saturate(200%) !important;
      border: 1px solid rgba(255, 255, 255, 0.3) !important;
      border-radius: 8px !important;
      box-shadow: 
        0 8px 32px rgba(0, 0, 0, 0.2),
        0 4px 16px rgba(0, 0, 0, 0.1),
        inset 0 1px 0 rgba(255, 255, 255, 0.1) !important;
      color: var(--p-text-color) !important;
    }
    
    :host ::ng-deep .global-toast .p-toast-message-content,
    :host ::ng-deep .mobile-toast-fix .p-toast-message-content {
      background: transparent !important;
      color: var(--p-text-color) !important;
    }
    
    :host ::ng-deep .global-toast .p-toast-summary,
    :host ::ng-deep .mobile-toast-fix .p-toast-summary {
      color: var(--p-text-color) !important;
      font-weight: 600 !important;
    }
    
    :host ::ng-deep .global-toast .p-toast-detail,
    :host ::ng-deep .mobile-toast-fix .p-toast-detail {
      color: var(--p-text-color-secondary) !important;
    }
    
    :host ::ng-deep .global-toast .p-toast-icon-close,
    :host ::ng-deep .mobile-toast-fix .p-toast-icon-close {
      color: var(--p-text-color-secondary) !important;
    }
    
    /* Severity-specific glass backgrounds - subtle color tints with glass effect */
    :host ::ng-deep .global-toast .p-toast-message-info,
    :host ::ng-deep .mobile-toast-fix .p-toast-message-info {
      background: rgba(59, 130, 246, 0.08) !important;
      border-color: rgba(59, 130, 246, 0.5) !important;
      backdrop-filter: blur(5px) saturate(200%) !important;
      -webkit-backdrop-filter: blur(5px) saturate(200%) !important;
      box-shadow: 
        0 8px 32px rgba(59, 130, 246, 0.2),
        0 4px 16px rgba(0, 0, 0, 0.1),
        inset 0 1px 0 rgba(59, 130, 246, 0.3) !important;
    }
    
    :host ::ng-deep .global-toast .p-toast-message-success,
    :host ::ng-deep .mobile-toast-fix .p-toast-message-success {
      background: rgba(34, 197, 94, 0.08) !important;
      border-color: rgba(34, 197, 94, 0.5) !important;
      backdrop-filter: blur(5px) saturate(200%) !important;
      -webkit-backdrop-filter: blur(5px) saturate(200%) !important;
      box-shadow: 
        0 8px 32px rgba(34, 197, 94, 0.2),
        0 4px 16px rgba(0, 0, 0, 0.1),
        inset 0 1px 0 rgba(34, 197, 94, 0.3) !important;
    }
    
    :host ::ng-deep .global-toast .p-toast-message-warn,
    :host ::ng-deep .mobile-toast-fix .p-toast-message-warn {
      background: rgba(249, 115, 22, 0.08) !important;
      border-color: rgba(249, 115, 22, 0.5) !important;
      backdrop-filter: blur(5px) saturate(200%) !important;
      -webkit-backdrop-filter: blur(5px) saturate(200%) !important;
      box-shadow: 
        0 8px 32px rgba(249, 115, 22, 0.2),
        0 4px 16px rgba(0, 0, 0, 0.1),
        inset 0 1px 0 rgba(249, 115, 22, 0.3) !important;
    }
    
    :host ::ng-deep .global-toast .p-toast-message-error,
    :host ::ng-deep .mobile-toast-fix .p-toast-message-error {
      background: rgba(239, 68, 68, 0.08) !important;
      border-color: rgba(239, 68, 68, 0.5) !important;
      backdrop-filter: blur(5px) saturate(200%) !important;
      -webkit-backdrop-filter: blur(5px) saturate(200%) !important;
      box-shadow: 
        0 8px 32px rgba(239, 68, 68, 0.2),
        0 4px 16px rgba(0, 0, 0, 0.1),
        inset 0 1px 0 rgba(239, 68, 68, 0.3) !important;
    }

    /* Toast positioning - responsive with max-width */
    :host ::ng-deep .mobile-toast-fix {
      position: fixed !important;
      bottom: 20px !important;
      right: 20px !important;
      left: auto !important;
      width: auto !important;
      max-width: calc(100vw - 40px) !important;
      z-index: 1100 !important;
    }
    
    :host ::ng-deep .mobile-toast-fix .p-toast-message {
      width: 100% !important;
      max-width: 400px !important;
      margin: 0 !important;
      box-sizing: border-box !important;
    }
    
    /* Mobile screens - full width with margins */
    @media (max-width: 480px) {
      :host ::ng-deep .mobile-toast-fix {
        right: 8px !important;
        left: 8px !important;
        max-width: none !important;
      }
      
      :host ::ng-deep .mobile-toast-fix .p-toast-message {
        max-width: none !important;
      }
    }
  `]
})
export class GlobalToastComponent {
  constructor(private messageService: MessageService) {}
}