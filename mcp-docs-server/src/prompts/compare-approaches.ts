/**
 * Prompt for comparing different implementation approaches
 */
export interface CompareApproachesParams {
  topic: string;
  approaches?: string[];
  criteria?: string[];
}

/**
 * Generate prompt for comparing implementation approaches
 */
export function generateCompareApproachesPrompt(params: CompareApproachesParams): string {
  const { topic, approaches, criteria } = params;

  let prompt = `Please compare different approaches for implementing "${topic}" in the Whizbang .NET library.

Steps:
1. Use search-docs to find documentation about ${topic}
2. Use find-examples to locate code examples showing different implementations
`;

  if (approaches && approaches.length > 0) {
    prompt += `3. Focus on these specific approaches: ${approaches.join(', ')}\n`;
  } else {
    prompt += `3. Identify the common implementation patterns\n`;
  }

  prompt += `4. Create a comparison showing:\n`;

  if (criteria && criteria.length > 0) {
    criteria.forEach((criterion) => {
      prompt += `   - ${criterion}\n`;
    });
  } else {
    prompt += `   - Pros and cons of each approach
   - Use cases where each is most appropriate
   - Performance considerations
   - Code complexity and maintainability
   - Test coverage and testability\n`;
  }

  prompt += `
5. Provide code examples for each approach
6. Make a recommendation based on common scenarios

Present the comparison in a clear, tabular format if possible.`;

  return prompt;
}
