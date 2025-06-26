import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { EnhancedCodeBlockV2Component } from '../components/enhanced-code-block-v2.component';

@Component({
  standalone: true,
  imports: [CommonModule, EnhancedCodeBlockV2Component],
  template: `
    <div class="simple-test">
      <h1>🔧 Simple V2 Component Test</h1>
      
      <div class="debug-info">
        <h3>Debug Information</h3>
        <p>Test Options: {{ JSON.stringify(testOptions) }}</p>
        <p>Is Collapsible Expected: {{ testOptions.showLinesOnly && testOptions.showLinesOnly.length > 0 }}</p>
      </div>
      
      <div class="component-test">
        <h3>V2 Component Rendering:</h3>
        <wb-enhanced-code-v2 
          [code]="testCode"
          [options]="testOptions">
        </wb-enhanced-code-v2>
      </div>
      
      <div class="verification">
        <h3>Expected Behavior:</h3>
        <ul>
          <li>✅ Component should render</li>
          <li>✅ Should show "Show Full Code" button</li>
          <li>✅ Should start collapsed showing only lines 1,2,3,8,9</li>
          <li>✅ Button click should expand/collapse</li>
        </ul>
      </div>
    </div>
  `,
  styles: [`
    .simple-test {
      max-width: 800px;
      margin: 0 auto;
      padding: 20px;
      font-family: Arial, sans-serif;
    }
    
    .debug-info, .verification {
      background: #f5f5f5;
      padding: 15px;
      margin: 20px 0;
      border-radius: 5px;
    }
    
    .component-test {
      border: 2px solid #007bff;
      padding: 20px;
      margin: 20px 0;
      border-radius: 5px;
    }
    
    h1, h3 {
      color: #333;
    }
  `]
})
export class SimpleTestPage {
  JSON = JSON;
  
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
    title: 'Simple Collapsible Test',
    language: 'csharp',
    filename: 'UsersController.cs',
    showLineNumbers: true,
    showLinesOnly: [1, 2, 3, 8, 9],
    framework: 'ASP.NET Core',
    difficulty: 'intermediate',
    showCopyButton: true,
    description: 'Testing collapsible functionality'
  };
}
