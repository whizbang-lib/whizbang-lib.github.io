import { Injectable } from '@angular/core';
import { MessageService } from 'primeng/api';

export type ToastType = 'success' | 'info' | 'warn' | 'error';

export interface ToastOptions {
  summary?: string;
  detail?: string;
  life?: number;
  sticky?: boolean;
  closable?: boolean;
}

@Injectable({
  providedIn: 'root'
})
export class GlobalToastService {
  constructor(private messageService: MessageService) {}

  /**
   * Show a success toast
   */
  success(message: string, options?: ToastOptions): void {
    this.showToast('success', message, options);
  }

  /**
   * Show an info toast
   */
  info(message: string, options?: ToastOptions): void {
    this.showToast('info', message, options);
  }

  /**
   * Show a warning toast
   */
  warn(message: string, options?: ToastOptions): void {
    this.showToast('warn', message, options);
  }

  /**
   * Show an error toast
   */
  error(message: string, options?: ToastOptions): void {
    this.showToast('error', message, options);
  }

  /**
   * Show a custom toast with full control
   */
  show(type: ToastType, summary: string, detail?: string, options?: ToastOptions): void {
    this.messageService.add({
      key: 'global',
      severity: type,
      summary,
      detail,
      life: options?.life ?? 5000,
      sticky: options?.sticky ?? false,
      closable: options?.closable ?? true
    });
  }

  /**
   * Clear all global toasts
   */
  clear(): void {
    this.messageService.clear('global');
  }

  /**
   * Internal method to show toast
   */
  private showToast(type: ToastType, message: string, options?: ToastOptions): void {
    const summary = options?.summary || this.getDefaultSummary(type);
    const detail = options?.detail || message;
    
    this.messageService.add({
      key: 'global',
      severity: type,
      summary,
      detail,
      life: options?.life ?? 5000,
      sticky: options?.sticky ?? false,
      closable: options?.closable ?? true
    });
  }

  /**
   * Get default summary based on toast type
   */
  private getDefaultSummary(type: ToastType): string {
    switch (type) {
      case 'success': return 'Success';
      case 'info': return 'Information';
      case 'warn': return 'Warning';
      case 'error': return 'Error';
      default: return 'Notification';
    }
  }
}