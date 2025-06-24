import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { EnhancedCodeBlockV2Component } from '../components/enhanced-code-block-v2.component';

@Component({
  standalone: true,
  imports: [CommonModule, EnhancedCodeBlockV2Component],
  template: `
    <div class="test-container">
      <h1>🧪 Enhanced Code Block V2 Test</h1>
      
      <div class="info-section">
        <h2>📋 Test Information</h2>
        <p>This page tests the new Angular-native <code>EnhancedCodeBlockV2Component</code> that replaces the directive approach.</p>
        <ul>
          <li>✅ Uses proper Angular component lifecycle</li>
          <li>✅ Reactive state management with signals</li>
          <li>✅ Angular animations for smooth transitions</li>
          <li>✅ No timing issues or manual DOM manipulation</li>
        </ul>
      </div>
      
      <div class="test-section">
        <h2>🔄 Test 1: Collapsible Code Block</h2>
        <p><strong>Expected:</strong> Should start collapsed showing only lines 1,2,3,⋯,8,9,⋯,12,13 with immediate line numbers</p>
        <wb-enhanced-code-v2 
          [code]="testCode"
          [options]="testOptions">
        </wb-enhanced-code-v2>
      </div>
      
      <div class="test-section">
        <h2>📝 Test 2: Non-Collapsible Code Block</h2>
        <p><strong>Expected:</strong> Should show all lines normally with sequential line numbers</p>
        <wb-enhanced-code-v2 
          [code]="simpleCode"
          [options]="simpleOptions">
        </wb-enhanced-code-v2>
      </div>
      
      <div class="test-results">
        <h3>✅ Success Criteria:</h3>
        <ul>
          <li>Line numbers appear immediately (no timing delays)</li>
          <li>Collapsible block starts collapsed with gap indicators</li>
          <li>Smooth expand/collapse animations</li>
          <li>No visual flash or re-rendering issues</li>
          <li>Proper syntax highlighting</li>
          <li>Copy/download buttons work correctly</li>
        </ul>
      </div>
      
      <div class="next-steps">
        <h3>🚀 Next Steps:</h3>
        <ol>
          <li>Verify both test blocks work correctly</li>
          <li>Test on the enhanced-csharp-examples page</li>
          <li>Gradually migrate from directive to component approach</li>
          <li>Remove directive code once migration is complete</li>
        </ol>
      </div>
    </div>
  `,
  styles: [`
    .test-container {
      max-width: 1200px;
      margin: 0 auto;
      padding: 2rem;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    }
    
    .info-section {
      background: #f0fdf4;
      border: 1px solid #86efac;
      border-radius: 8px;
      padding: 1.5rem;
      margin: 2rem 0;
    }
    
    .test-section {
      margin: 2rem 0;
      padding: 1.5rem;
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      background: white;
    }
    
    .test-results {
      background: #dbeafe;
      border: 1px solid #93c5fd;
      border-radius: 8px;
      padding: 1.5rem;
      margin: 2rem 0;
    }
    
    .next-steps {
      background: #fef3c7;
      border: 1px solid #fbbf24;
      border-radius: 8px;
      padding: 1.5rem;
      margin: 2rem 0;
    }
    
    h1 {
      color: #1f2937;
      text-align: center;
      margin-bottom: 2rem;
    }
    
    h2 {
      color: #374151;
      margin-bottom: 1rem;
    }
    
    h3 {
      color: #374151;
      margin-bottom: 0.5rem;
    }
    
    code {
      background: #f3f4f6;
      padding: 0.25rem 0.5rem;
      border-radius: 4px;
      font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
      color: #1f2937;
    }
    
    p {
      margin-bottom: 1rem;
      line-height: 1.6;
      color: #374151;
    }
    
    ul, ol {
      margin-bottom: 1rem;
      padding-left: 1.5rem;
      color: #374151;
    }
    
    li {
      margin-bottom: 0.5rem;
      color: #374151;
    }
    
    strong {
      color: #1f2937;
    }
  `]
})
export class TestV2Page {
  testCode = `using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using MyApp.Models;

[ApiController]
[Route("api/[controller]")]
public class UsersController : ControllerBase
{
    private readonly AppDbContext _context;
    
    public UsersController(AppDbContext context)
    {
        _context = context;
    }
    
    [HttpGet]
    public async Task<ActionResult<IEnumerable<User>>> GetUsers()
    {
        return await _context.Users.ToListAsync();
    }
}`;

  testOptions = {
    title: 'User Controller Example',
    language: 'csharp',
    filename: 'UsersController.cs',
    showLineNumbers: true,
    collapsible: true,
    showLinesOnly: [1, 2, 3, 8, 9, 12, 13],
    framework: 'ASP.NET Core',
    difficulty: 'intermediate',
    showCopyButton: true,
    description: 'Basic API controller for user management'
  };

  simpleCode = `public class SimpleExample
{
    public string Message { get; set; } = "Hello World";
}`;

  simpleOptions = {
    title: 'Simple Example',
    language: 'csharp',
    showLineNumbers: true,
    collapsible: false,
    showCopyButton: true
  };
}
