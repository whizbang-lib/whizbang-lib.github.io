import { bootstrapApplication } from '@angular/platform-browser';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideRouter } from '@angular/router';
import { importProvidersFrom, SecurityContext, APP_INITIALIZER } from '@angular/core';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';
import { providePrimeNG } from 'primeng/config';
import { WhizbangPreset } from './app/themes/whizbang-theme';
import { MarkdownModule } from 'ngx-markdown';
import { AppComponent } from './app/app.component';
import { routes } from './app/app.routes';
import { HttpClientModule } from '@angular/common/http';
import { MessageService } from 'primeng/api';
import { ThemeService } from './app/services/theme.service';
import { ThemeConfigService } from './app/services/theme-config.service';

// Import highlight.js for syntax highlighting
import hljs from 'highlight.js/lib/core';
import csharp from 'highlight.js/lib/languages/csharp';
import typescript from 'highlight.js/lib/languages/typescript';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import bash from 'highlight.js/lib/languages/bash';
import sql from 'highlight.js/lib/languages/sql';
import xml from 'highlight.js/lib/languages/xml';

// Register languages with highlight.js
hljs.registerLanguage('csharp', csharp);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('json', json);
hljs.registerLanguage('bash', bash);
hljs.registerLanguage('sql', sql);
hljs.registerLanguage('xml', xml);

// Theme initialization function
function initializeTheme(themeConfigService: ThemeConfigService) {
  return () => {
    themeConfigService.initialize();
  };
}

bootstrapApplication(AppComponent, {
  providers: [
    provideRouter(routes),
    provideAnimationsAsync(),
    providePrimeNG({
            theme: {
                preset: WhizbangPreset,
                options: {
                    darkModeSelector: '[data-theme="dark"]',
                    cssLayer: {
                        name: 'primeng',
                        order: 'tailwind-base, primeng, tailwind-utilities'
                    }
                }
            }
    }),
    importProvidersFrom(
      BrowserAnimationsModule,
      HttpClientModule, 
      MarkdownModule.forRoot({
        sanitize: SecurityContext.NONE
      })
    ),
    MessageService,
    // Initialize theme system
    {
      provide: APP_INITIALIZER,
      useFactory: initializeTheme,
      deps: [ThemeConfigService],
      multi: true
    }
  ]
}).catch(err => console.error(err));
console.log("App loaded");
