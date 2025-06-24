import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ButtonModule } from 'primeng/button';

@Component({
  standalone: true,
  imports: [CommonModule, ButtonModule],
  selector: 'simple-button-test',
  template: `
    <div style="padding: 20px; background: #f0f0f0; border: 2px solid #ccc; margin: 10px;">
      <h3>Simple Button Test Component</h3>
      <p>Counter: {{ counter }}</p>
      
      <!-- Native HTML Button -->
      <button 
        style="background: green; color: white; padding: 10px; margin: 5px; border: none; cursor: pointer;"
        (click)="incrementCounter()"
        type="button">
        Native Button ({{ counter }})
      </button>
      
      <!-- PrimeNG Button -->
      <button 
        pButton 
        label="PrimeNG Button"
        (click)="incrementCounter()"
        type="button"
        style="margin: 5px;">
      </button>
      
      <!-- Alternative event handling -->
      <button 
        type="button"
        style="background: orange; color: white; padding: 10px; margin: 5px; border: none; cursor: pointer;"
        (click)="logClick()">
        Log Click Test
      </button>
    </div>
  `
})
export class SimpleButtonTestComponent {
  counter = 0;

  incrementCounter() {
    console.log('=== incrementCounter called ===');
    this.counter++;
    console.log('New counter value:', this.counter);
  }

  logClick() {
    console.log('=== logClick called ===');
    console.log('Simple click test successful!');
  }
}
