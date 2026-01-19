# Planning System

The `plans/` folder contains structured development plans for complex features and enhancements. This system helps track progress and maintain organization across Claude sessions.

## When to Use Planning
- Complex multi-step features requiring 3+ distinct actions
- Non-trivial tasks that need careful planning
- When user provides multiple tasks or features to implement
- Before starting any significant development work

## Plan Structure
Plans are organized in category folders:
- `search-enhancements/` - Search functionality improvements
- `ui-improvements/` - User interface enhancements  
- `performance-optimizations/` - Performance improvements
- `content-management/` - Content creation and organization
- `templates/` - Standardized plan templates

## Using the Planning System
1. **Check existing plans** before starting new work - update existing plans rather than creating duplicates
2. **Create new plans** using templates from `templates/` folder
3. **Update progress** using status conventions: ❌ Not Started, 🔄 In Progress, ⚠️ Blocked, ✅ Complete, 🧪 Testing
4. **Document decisions** and approach changes in Progress Tracking sections
5. **Be specific** with task descriptions and realistic with time estimates

## CRITICAL: Real-Time Plan Updates
**ALWAYS update plans in real-time as you work - this is mandatory for all sessions:**
- Mark tasks as `🔄 In Progress` when you START working on them
- Update with specific implementation details as you complete each step
- Mark as `✅ Complete` IMMEDIATELY when finished
- Track actual time spent vs estimates
- Document any deviations, additional work discovered, or technical decisions made
- Update progress percentages and phase status as work progresses
- Note any blockers or issues encountered in real-time

Plans must be living documents that accurately track the development process, not just end-state summaries. Update plans throughout the work session, not just at the end.

Always reference and update relevant plans during development sessions to maintain continuity.

## Library Feature Development Requirements

When planning library features (not documentation site features), plans MUST include:

### Documentation Tasks

- [ ] Write documentation BEFORE or DURING implementation
- [ ] Create complete C# examples
- [ ] Document all public APIs
- [ ] Explain concepts and use cases
- [ ] Show error handling patterns

Documentation is NOT optional - it's part of the definition of done for any library feature.

### Example Validation

- [ ] All examples must be complete and runnable
- [ ] Examples follow library best practices
- [ ] Error scenarios are demonstrated
- [ ] Migration guides for breaking changes

### Breaking Change Handling

If the feature introduces breaking changes:

- [ ] Document what breaks and why
- [ ] Provide before/after examples
- [ ] Create migration guide
- [ ] Specify deprecation timeline
- [ ] Update affected documentation

### Roadmap Integration

If feature is not yet released:

- [ ] Create roadmap documentation in `src/assets/docs/Roadmap/`
- [ ] Set `unreleased: true` in frontmatter
- [ ] Specify `target_version` and `status`
- [ ] Move to appropriate category when released

**Remember**: Plans for library features should allocate ~30-40% of time to documentation. If planning says "3 days implementation", plan should include "+1-2 days documentation".