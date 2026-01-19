# Design System & UI Standards

These design standards have been established through implementation and should be maintained:

## Visual Design

### Header & Container Styling
- **Code block headers**: Dark background (`--code-block-header-bg`) forced in all themes
- **Tools container**: Transparent background with subtle button styling
- **Button styling**: `rgba(255, 255, 255, 0.1)` backgrounds with hover effects
- **Hover animations**: `translateY(-1px)` with smooth transitions

### Chip & Tag Styling
- **Shape**: Pill/bubble appearance with `border-radius: 9999px`
- **Size**: Vertically thin with `min-height: 1.5rem` and tight padding
- **Colors**: Color-coded by type:
  - Language chips: Dynamic colors via `getLanguageColor()` method
  - Framework chips: Success green (`--color-success`)
  - Difficulty chips: Severity-based (success/info/warning/danger)
  - Tag chips: Primary brand color (`--color-primary`)
- **Hover**: Lift effect with `box-shadow` and `color-mix()` for hover states

### Responsive Behavior
- **Metadata chips**: Hidden below 768px to reduce mobile clutter
- **More Info content**: Toggle on desktop, modal on mobile
- **Typography**: Scaled down on mobile (md → sm → xs at breakpoints)
- **Spacing**: Reduced padding and margins on mobile

## Component Patterns

### Code Blocks
- Header with title, metadata row (chips), and action buttons
- Transparent tools container integrated with header
- Progressive disclosure for description and metadata sections
- Mobile: Chips hidden, More Info opens modal, icon-only buttons

### Navigation
- Hamburger menu with push sidebar
- Sidebar width: 320px (tablet), 100vw (mobile)
- 44px minimum touch targets throughout
- Responsive toolbar with mobile-optimized spacing

### Search
- MiniSearch + Fuse.js baseline (excellent keyword search)
- AI enhancement as progressive addition (not replacement)
- Hybrid scoring when AI available (60% semantic + 40% keyword)
- Graceful fallback to keyword-only search

## Accessibility Standards
- **Touch targets**: 44px minimum (WCAG 2.1 Level AAA)
- **Color contrast**: Proper ratios maintained across themes
- **Focus indicators**: Visible focus states on all interactive elements
- **Screen readers**: ARIA labels and proper semantic HTML
- **Keyboard navigation**: Full functionality without mouse

## Theme System
- Light and dark themes supported
- CSS custom properties for all colors
- Dark header forced even in light theme (code blocks)
- Consistent visual language across themes