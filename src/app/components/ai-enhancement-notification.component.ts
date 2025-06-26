import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ToastModule } from 'primeng/toast';
import { MessageService } from 'primeng/api';
import { AIEnhancementService, AIEnhancementState, AIEnhancementProgress } from '../services/ai-enhancement.service';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';

@Component({
  selector: 'wb-ai-enhancement-notification',
  standalone: true,
  imports: [CommonModule, ToastModule],
  template: `
    <p-toast position="bottom-right" [baseZIndex]="1000" key="ai-enhancement" 
             styleClass="mobile-toast-fix">
      <ng-template let-message pTemplate="message">
        <div class="custom-toast-content">
          <div class="toast-header">
            <i [class]="getIconClass(message.severity)" class="toast-icon"></i>
            <span class="toast-summary">{{ message.summary }}</span>
          </div>
          <div class="toast-detail" *ngIf="message.detail">{{ message.detail }}</div>
          <div class="toast-progress" *ngIf="showProgress && currentProgress > 0">
            <div class="progress-bar">
              <div class="progress-fill" [style.width.%]="currentProgress"></div>
            </div>
            <span class="progress-text">{{ currentProgress }}%</span>
          </div>
        </div>
      </ng-template>
    </p-toast>
  `,
  styles: [`
    /* Toast background and styling fixes - enhanced glassmorphism for both themes */
    :host ::ng-deep .mobile-toast-fix .p-toast-message,
    :host ::ng-deep .p-toast-message {
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
    
    :host ::ng-deep .p-toast-message-content {
      background: transparent !important;
      color: var(--p-text-color) !important;
    }
    
    :host ::ng-deep .p-toast-summary {
      color: var(--p-text-color) !important;
      font-weight: 600 !important;
    }
    
    :host ::ng-deep .p-toast-detail {
      color: var(--p-text-color-secondary) !important;
    }
    
    :host ::ng-deep .p-toast-icon-close {
      color: var(--p-text-color-secondary) !important;
    }
    
    /* Severity-specific glass backgrounds - subtle color tints with glass effect */
    :host ::ng-deep .mobile-toast-fix .p-toast-message-info,
    :host ::ng-deep .p-toast-message-info {
      background: rgba(59, 130, 246, 0.08) !important;
      border-color: rgba(59, 130, 246, 0.5) !important;
      backdrop-filter: blur(5px) saturate(200%) !important;
      -webkit-backdrop-filter: blur(5px) saturate(200%) !important;
      box-shadow: 
        0 8px 32px rgba(59, 130, 246, 0.2),
        0 4px 16px rgba(0, 0, 0, 0.1),
        inset 0 1px 0 rgba(59, 130, 246, 0.3) !important;
    }
    
    :host ::ng-deep .mobile-toast-fix .p-toast-message-success,
    :host ::ng-deep .p-toast-message-success {
      background: rgba(34, 197, 94, 0.08) !important;
      border-color: rgba(34, 197, 94, 0.5) !important;
      backdrop-filter: blur(5px) saturate(200%) !important;
      -webkit-backdrop-filter: blur(5px) saturate(200%) !important;
      box-shadow: 
        0 8px 32px rgba(34, 197, 94, 0.2),
        0 4px 16px rgba(0, 0, 0, 0.1),
        inset 0 1px 0 rgba(34, 197, 94, 0.3) !important;
    }
    
    :host ::ng-deep .mobile-toast-fix .p-toast-message-warn,
    :host ::ng-deep .p-toast-message-warn {
      background: rgba(249, 115, 22, 0.08) !important;
      border-color: rgba(249, 115, 22, 0.5) !important;
      backdrop-filter: blur(5px) saturate(200%) !important;
      -webkit-backdrop-filter: blur(5px) saturate(200%) !important;
      box-shadow: 
        0 8px 32px rgba(249, 115, 22, 0.2),
        0 4px 16px rgba(0, 0, 0, 0.1),
        inset 0 1px 0 rgba(249, 115, 22, 0.3) !important;
    }
    
    :host ::ng-deep .mobile-toast-fix .p-toast-message-error,
    :host ::ng-deep .p-toast-message-error {
      background: rgba(239, 68, 68, 0.08) !important;
      border-color: rgba(239, 68, 68, 0.5) !important;
      backdrop-filter: blur(5px) saturate(200%) !important;
      -webkit-backdrop-filter: blur(5px) saturate(200%) !important;
      box-shadow: 
        0 8px 32px rgba(239, 68, 68, 0.2),
        0 4px 16px rgba(0, 0, 0, 0.1),
        inset 0 1px 0 rgba(239, 68, 68, 0.3) !important;
    }
    
    
    /* Custom toast content styling */
    .custom-toast-content {
      padding: 1rem;
    }
    
    .toast-header {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      margin-bottom: 0.5rem;
    }
    
    .toast-icon {
      font-size: 1.125rem;
      flex-shrink: 0;
    }
    
    .toast-summary {
      flex: 1;
      font-weight: 600;
      color: var(--p-text-color);
    }
    
    .toast-close {
      background: none;
      border: none;
      color: var(--p-text-color-secondary);
      cursor: pointer;
      padding: 0.25rem;
      border-radius: 0.25rem;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    
    .toast-close:hover {
      background: var(--p-surface-hover);
    }
    
    .toast-detail {
      color: var(--p-text-color-secondary);
      font-size: 0.875rem;
      line-height: 1.4;
      margin-bottom: 0.75rem;
    }
    
    .toast-progress {
      margin-top: 0.75rem;
    }
    
    .progress-bar {
      background: var(--p-surface-border);
      border-radius: 0.25rem;
      height: 0.5rem;
      overflow: hidden;
      margin-bottom: 0.25rem;
    }
    
    .progress-fill {
      background: var(--p-primary-color);
      height: 100%;
      transition: width 0.3s ease;
      border-radius: inherit;
    }
    
    .progress-text {
      font-size: 0.75rem;
      color: var(--p-text-color-secondary);
      text-align: center;
      display: block;
    }
    
    /* Icon colors by severity */
    .toast-icon.pi-info-circle {
      color: var(--p-primary-color);
    }
    
    .toast-icon.pi-check-circle {
      color: var(--p-green-500);
    }
    
    .toast-icon.pi-exclamation-triangle {
      color: var(--p-orange-500);
    }
    
    .toast-icon.pi-times-circle {
      color: var(--p-red-500);
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
    
    /* Mobile content adjustments */
    @media (max-width: 480px) {
      .custom-toast-content {
        padding: 0.75rem;
      }
      
      .toast-summary {
        font-size: 0.875rem;
        line-height: 1.3;
      }
      
      .toast-detail {
        font-size: 0.8125rem;
        line-height: 1.3;
      }
      
      .progress-text {
        font-size: 0.6875rem;
      }
    }
    
    /* Very small screens */
    @media (max-width: 380px) {
      .custom-toast-content {
        padding: 0.5rem;
      }
      
      .toast-header {
        gap: 0.25rem;
        margin-bottom: 0.25rem;
      }
      
      .toast-summary {
        font-size: 0.8125rem;
      }
      
      .toast-detail {
        font-size: 0.75rem;
        margin-bottom: 0.5rem;
      }
    }
  `]
})
export class AIEnhancementNotificationComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();
  private currentToastId: string | null = null;
  currentProgress = 0;
  showProgress = false;

  constructor(
    private aiEnhancementService: AIEnhancementService,
    private messageService: MessageService
  ) {}

  ngOnInit() {
    // Subscribe to AI enhancement progress
    this.aiEnhancementService.getProgress().pipe(
      takeUntil(this.destroy$)
    ).subscribe(progress => {
      this.handleProgressUpdate(progress);
    });
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
    if (this.currentToastId) {
      this.messageService.clear(this.currentToastId);
    }
  }

  private handleProgressUpdate(progress: AIEnhancementProgress) {
    // Don't show notification for initial states
    if (progress.state === AIEnhancementState.NOT_STARTED || 
        progress.state === AIEnhancementState.DISABLED ||
        !progress.message) {
      return;
    }

    // Update progress percentage if available
    this.currentProgress = progress.progress || 0;
    this.showProgress = progress.state === AIEnhancementState.LOADING && this.currentProgress > 0;

    // Show appropriate toast based on state
    let severity: 'success' | 'info' | 'warn' | 'error' = 'info';
    let summary = '';
    let detail = progress.message;
    let life = 0; // 0 means don't auto-close for loading states
    let closable = false;

    switch (progress.state) {
      case AIEnhancementState.CHECKING_CAPABILITY:
        severity = 'info';
        summary = 'Checking device capabilities...';
        detail = 'Determining if AI enhancement is supported';
        life = 0;
        closable = false;
        this.showProgress = false;
        break;
      
      case AIEnhancementState.LOADING:
        severity = 'info';
        summary = 'Enhancing search with AI...';
        detail = `${progress.message}`;
        life = 0;
        closable = progress.canDismiss || false;
        this.showProgress = this.currentProgress > 0;
        break;
      
      case AIEnhancementState.READY:
        severity = 'success';
        summary = 'Smart search is now available!';
        detail = 'Search now includes semantic understanding for better results';
        life = 5000;
        closable = true;
        this.showProgress = false;
        break;
      
      case AIEnhancementState.FAILED:
        severity = 'warn';
        summary = 'AI enhancement unavailable';
        detail = `${progress.message}\nStandard search is working normally`;
        life = 5000;
        closable = true;
        this.showProgress = false;
        break;
    }

    // If we have an existing toast, update it instead of creating a new one
    if (this.currentToastId) {
      // For loading states, just update the existing toast
      if (progress.state === AIEnhancementState.LOADING) {
        // The template will automatically update with new progress values
        return;
      } else {
        // For state changes, clear and create new
        this.messageService.clear(this.currentToastId);
        this.currentToastId = null;
      }
    }

    // Create new toast
    this.currentToastId = `ai-enhancement-sticky`;
    this.messageService.add({
      key: 'ai-enhancement',
      id: this.currentToastId,
      severity,
      summary,
      detail,
      life,
      closable
    });
  }

  getIconClass(severity: string): string {
    switch (severity) {
      case 'success': return 'pi pi-check-circle toast-icon';
      case 'info': return 'pi pi-info-circle toast-icon';
      case 'warn': return 'pi pi-exclamation-triangle toast-icon';
      case 'error': return 'pi pi-times-circle toast-icon';
      default: return 'pi pi-info-circle toast-icon';
    }
  }
}