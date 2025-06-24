import { Component } from '@angular/core';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { CommonModule } from '@angular/common';

@Component({
  standalone: true,
  imports: [CardModule, ButtonModule, CommonModule],
  template: `
    <div class="container mt-4">
      <h1>Examples</h1>
      <p>Code examples and demos will be available here.</p>
      
      <div class="grid">
        <div class="col-12 md:col-6 lg:col-4">
          <p-card header="Hello World Example">
            <p>A simple example to get you started.</p>
            <p-button label="View Example" class="mt-2"></p-button>
          </p-card>
        </div>
        
        <div class="col-12 md:col-6 lg:col-4">
          <p-card header="Advanced Usage">
            <p>More complex examples and use cases.</p>
            <p-button label="View Example" class="mt-2"></p-button>
          </p-card>
        </div>
      </div>
    </div>
  `
})
export class ExamplesPage {}

