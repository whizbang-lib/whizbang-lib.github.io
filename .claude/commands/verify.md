Verify UI/visual changes using Playwright browser automation.

**CRITICAL**: You MUST verify all UI/visual changes before claiming work complete.

Process:
1. Make changes to code
2. Use `mcp__playwright__browser_navigate` to visit the affected page
3. Use `mcp__playwright__browser_take_screenshot` to capture current state
4. Examine screenshot to verify change worked as intended
5. If change didn't work, investigate and fix before claiming completion

DO NOT rely on user verification - you must validate changes independently.

Example pages to verify:
- http://localhost:4200 - Home page
- http://localhost:4200/docs/v1.0.0/getting-started - Documentation
- http://localhost:4200/docs/drafts/ - Draft documentation

**The dev server is ALWAYS running at http://localhost:4200 during development sessions.**

Use this command when:
- After making UI changes
- After updating styles
- After modifying templates
- Before claiming work complete
