import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { EnhancedCodeBlockV2Component } from '../components/enhanced-code-block-v2.component';
import { SimpleButtonTestComponent } from '../components/simple-button-test.component';

@Component({
  standalone: true,
  imports: [CommonModule, EnhancedCodeBlockV2Component, SimpleButtonTestComponent],
  template: `
    <div style="padding: 20px; background: #f5f5f5; font-family: Arial, sans-serif;">
      <h1>🔧 Button Debug Test Page</h1>
      
      <div style="background: white; padding: 20px; margin: 20px 0; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
        <h2>Button Functionality Test</h2>
        <p>This page tests only the button functionality of the V2 component.</p>
        
        <!-- Simple Button Test Component -->
        <div style="margin: 20px 0; padding: 15px; border: 2px solid #28a745; border-radius: 8px;">
          <h3>Simple Button Test Component</h3>
          <simple-button-test></simple-button-test>
        </div>
        
        <!-- Simple Native Button Test -->
        <div style="margin: 20px 0; padding: 15px; border: 2px solid #007bff; border-radius: 8px;">
          <h3>Native Button Test</h3>
          <button 
            style="background: green; color: white; padding: 10px 20px; border: none; border-radius: 4px; cursor: pointer; font-size: 16px;"
            (click)="testNativeButton()">
            CLICK ME - Native Button
          </button>
          <p>Status: {{ nativeButtonStatus }}</p>
        </div>
        
        <!-- V2 Component Test -->
        <div style="margin: 20px 0; padding: 15px; border: 2px solid #ff6b6b; border-radius: 8px;">
          <h3>V2 Component Test</h3>
          <wb-enhanced-code-v2 
            [code]="simpleCode"
            [options]="simpleOptions">
          </wb-enhanced-code-v2>
        </div>
        
        <!-- Manual Event Test -->
        <div style="margin: 20px 0; padding: 15px; border: 2px solid #ffa500; border-radius: 8px;">
          <h3>Manual Event Test</h3>
          <button 
            style="background: purple; color: white; padding: 10px 20px; border: none; border-radius: 4px; cursor: pointer; font-size: 16px;"
            (click)="manualToggleTest()">
            Manual Toggle Test
          </button>
          <p>Manual toggle count: {{ manualToggleCount }}</p>
        </div>
      </div>
    </div>
  `
})
export class ButtonDebugPage {
  nativeButtonStatus = 'Not clicked yet';
  manualToggleCount = 0;
  
  simpleCode = `public class SimpleTest
{
    public string Message = "Hello World";
}`;

  simpleOptions = {
    title: 'Button Test Code',
    language: 'csharp',
    showLineNumbers: true,
    showLinesOnly: [1, 2, 3],
    showCopyButton: true
  };

  testNativeButton() {
    console.log('=== Native button clicked! ===');
    this.nativeButtonStatus = `Clicked at ${new Date().toLocaleTimeString()}`;
  }
  
  manualToggleTest() {
    console.log('=== Manual toggle clicked! ===');
    this.manualToggleCount++;
  }
}
