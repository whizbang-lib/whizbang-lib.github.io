/**
 * Prompt for showing code examples with specific criteria
 */
export interface ShowExampleParams {
  topic: string;
  framework?: string;
  difficulty?: 'beginner' | 'intermediate' | 'advanced';
  withTests?: boolean;
}

/**
 * Generate prompt for showing code examples
 */
export function generateShowExamplePrompt(params: ShowExampleParams): string {
  const { topic, framework, difficulty, withTests = true } = params;

  let prompt = `Please show me code examples for "${topic}" in the Whizbang .NET library.

Requirements:
- Use the find-examples tool to search for relevant code examples
- Show complete, working examples with proper context
`;

  if (framework) {
    prompt += `- Filter for ${framework} framework\n`;
  }

  if (difficulty) {
    prompt += `- Focus on ${difficulty}-level examples\n`;
  }

  if (withTests) {
    prompt += `- Include test references (testFile and testMethod) to show the examples are verified\n`;
  }

  prompt += `
For each example, provide:
1. The code with syntax highlighting
2. Explanation of what it does
3. Link to the documentation page (doc:// URI)
4. Test file reference if available
5. Required NuGet packages

If multiple examples are found, show the most relevant ones first.`;

  return prompt;
}
