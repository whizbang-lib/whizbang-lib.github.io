/**
 * Prompt for explaining Whizbang library concepts in detail
 */
export interface ExplainConceptParams {
  concept: string;
  includeExamples?: boolean;
  difficulty?: 'beginner' | 'intermediate' | 'advanced';
}

/**
 * Generate prompt for explaining a concept
 */
export function generateExplainConceptPrompt(params: ExplainConceptParams): string {
  const { concept, includeExamples = true, difficulty } = params;

  let prompt = `Please explain the concept of "${concept}" in the Whizbang .NET library.

I need:
1. A clear definition of what ${concept} is
2. When and why to use ${concept}
3. Key benefits and considerations
4. Best practices and anti-patterns to avoid
`;

  if (includeExamples) {
    prompt += `5. Code examples demonstrating ${concept}\n`;
  }

  if (difficulty) {
    prompt += `\nPlease tailor the explanation for a ${difficulty}-level developer.\n`;
  }

  prompt += `
Use the documentation resources and search tools to find relevant information about ${concept}.
If there are multiple related concepts, explain how they relate to each other.`;

  return prompt;
}

/**
 * Get suggested resources for a concept
 */
export function getSuggestedResources(concept: string): string[] {
  const conceptLower = concept.toLowerCase();

  // Map common concepts to likely documentation URIs
  const resourceMap: Record<string, string[]> = {
    'aggregate': ['doc://aggregates', 'doc://domain-driven-design'],
    'projection': ['doc://projections', 'doc://read-models'],
    'event': ['doc://events', 'doc://event-sourcing'],
    'command': ['doc://commands', 'doc://cqrs'],
    'query': ['doc://queries', 'doc://cqrs'],
    'repository': ['doc://repositories', 'doc://data-access'],
    'api': ['doc://api', 'doc://rest-api']
  };

  // Find matching resources
  for (const [key, resources] of Object.entries(resourceMap)) {
    if (conceptLower.includes(key)) {
      return resources;
    }
  }

  return [`doc://${conceptLower}`];
}
