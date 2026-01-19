Load documentation standards and guidelines.

Read these files to understand documentation standards:
- ai-docs/standards.md - Code standards, documentation requirements, anti-patterns
- ai-docs/design-system.md - UI/UX standards, visual design, accessibility
- DOCUMENTATION-STANDARDS.md - Comprehensive documentation requirements
- CODE_SAMPLES.editorconfig - C# code style (K&R/Egyptian braces)

Key standards:
1. **C# Code Style**: K&R/Egyptian braces (opening brace on same line)
2. **Documentation-First**: Write docs BEFORE implementation
3. **Test-Driven Examples**: All examples must have tests
4. **Mobile-First Design**: Progressive disclosure, touch-friendly
5. **Version-Based Organization**: Released in version folders, unreleased in state folders
6. **SEO Optimization**: Comprehensive structured data

C# code style example:
```csharp
// ✅ CORRECT - K&R/Egyptian braces
public class Example {
    public void Method() {
        if (condition) {
            DoSomething();
        }
    }
}
```

Use this command when:
- Writing new documentation
- Code review preparation
- Need standards reminder
