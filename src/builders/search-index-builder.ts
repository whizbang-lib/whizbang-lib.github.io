/**
 * Custom Angular Builder for Search Index Generation
 * Automatically generates enhanced search index before Angular builds
 */

import { BuilderContext, BuilderOutput, createBuilder } from '@angular-devkit/architect';
import { JsonObject } from '@angular-devkit/core';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

interface Options extends JsonObject {
  command: string;
  args?: string[];
  cwd?: string;
}

export default createBuilder<Options>((options, context) => {
  return new Promise<BuilderOutput>((resolve) => {
    try {
      const indexScriptPath = path.join(context.workspaceRoot, 'src/scripts/gen-enhanced-search-index.mjs');
      
      // Check if the search index script exists
      if (!fs.existsSync(indexScriptPath)) {
        context.logger.warn('Enhanced search index script not found, skipping index generation');
        resolve({ success: true });
        return;
      }

      context.logger.info('🔍 Generating enhanced search index...');
      
      // Run the search index generation script
      const startTime = Date.now();
      execSync(`node ${indexScriptPath}`, { 
        cwd: context.workspaceRoot,
        stdio: 'inherit'
      });
      
      const duration = Date.now() - startTime;
      context.logger.info(`✅ Enhanced search index generated successfully in ${duration}ms`);
      
      resolve({ success: true });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      context.logger.error('❌ Failed to generate enhanced search index:', errorMessage);
      resolve({ success: false, error: errorMessage });
    }
  });
});
