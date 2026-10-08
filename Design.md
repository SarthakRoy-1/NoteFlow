# Design System

> This document defines the project's visual implementation choices. It does not add product requirements beyond the assignment.

## Design Direction

Create a refined AI productivity product.

The visual language should communicate:

- intelligent
- calm
- focused
- trustworthy
- modern
- technical without looking like developer tooling

Avoid a generic "AI SaaS" appearance.

The interface should prioritize content and actions over decoration.

---

# 1. Brand Identity

## Product Personality

The product should feel:

- intelligent
- precise
- quiet
- organized
- dependable

It should not feel:

- childish
- overly futuristic
- noisy
- overly corporate
- like a generic chatbot wrapper

## Brand Principle

The core visual metaphor is:

**Capture → Understand → Organize → Act**

Notes are the raw input.

AI understanding is the invisible intelligence layer.

Todos and reminders are the structured outcome.

---

# 2. Colour & Theme

Use a restrained neutral-first palette.

## Light Theme

```text
Background       #F8FAFC
Surface          #FFFFFF
Surface Muted    #F1F5F9
Text Primary     #0F172A
Text Secondary   #475569
Border           #E2E8F0
Primary          #4F46E5
Primary Hover    #4338CA
Success          #16A34A
Warning          #D97706
Error            #DC2626
Info             #0284C7
```

## Dark Theme

```text
Background       #09090B
Surface          #111113
Surface Muted    #18181B
Text Primary     #FAFAFA
Text Secondary   #A1A1AA
Border           #27272A
Primary          #818CF8
Primary Hover    #6366F1
Success          #4ADE80
Warning          #FBBF24
Error            #F87171
Info             #38BDF8
```

Use semantic tokens rather than hardcoding colors throughout components.

Do not use gradients as the default visual language.

---

# 3. Spacing

Use a consistent 4px-based spacing scale.

```text
4px   — xs
8px   — sm
12px  — md
16px  — base
20px  — lg
24px  — xl
32px  — 2xl
40px  — 3xl
48px  — 4xl
64px  — 5xl
```

Primary content should generally use:

- 16–24px internal card padding
- 24–32px section spacing
- 32–48px page-level separation

Do not compress unrelated controls into one visual block.

---

# 4. Border Radius

Use moderate, consistent rounding.

```text
4px   — compact controls
6px   — inputs/buttons
8px   — cards
12px  — prominent panels
16px  — large surfaces/dialogs
```

Avoid excessive pill-shaped UI except for:

- status badges
- compact filters
- tags

---

# 5. Components

## App Shell

Desktop:

- compact sidebar/navigation
- primary content area
- optional contextual panel

Mobile:

- top navigation or bottom navigation
- full-width content

## Cards

Use cards selectively.

Cards should group meaningful information rather than wrap every element.

## Buttons

Primary:

- one obvious primary action per context

Secondary:

- supporting actions

Destructive:

- visually distinct
- confirmation for consequential deletion where appropriate

## Inputs

Inputs should have:

- visible label
- clear focus state
- validation feedback
- disabled/loading state

## Note Editor

Prioritize writing space.

Suggested hierarchy:

```text
Title
Metadata
Content
Save / action controls
AI result summary
```

AI-created results should not visually overpower the note itself.

## Todo Item

Show:

- checkbox
- title
- due date
- AI label when applicable
- source note
- edit/delete controls

## Reminder Item

Show:

- reminder content
- person
- date/time
- due state
- AI label
- source note

## Ask AI

Structure:

```text
Question input
        ↓
Answer
        ↓
Sources
        ↓
History
```

Keep the interaction clearly tied to the user's notes.

---

# 6. Icons

Use one icon family consistently.

Preferred:

- Lucide Icons
- another existing project icon library if already established

Do not mix multiple unrelated icon styles.

Icons should support meaning, not replace labels for important actions.

Use tooltips for unfamiliar icon-only actions.

Recommended semantic icons:

- Notes: FileText
- Todo: CheckSquare
- Reminder: Bell
- Ask AI: Sparkles / MessageSquare
- Search: Search
- Edit: Pencil
- Delete: Trash2
- Settings: Settings
- Source: ExternalLink / FileText

---

# 7. Responsive Breakpoints

Use these conceptual breakpoints:

```text
Mobile:       < 640px
Tablet:       640–1023px
Desktop:      1024–1279px
Large:        ≥ 1280px
```

Do not design only for a single desktop viewport.

## Mobile

- single-column layout
- full-width forms
- comfortable touch targets
- navigation simplified
- no horizontal overflow

## Tablet

- flexible two-column layouts where useful
- preserve readable content width

## Desktop

- sidebar/navigation
- centered content
- optional secondary context areas

## Large Desktop

Do not simply stretch content indefinitely.

Use max-width containers.

---

# 8. Fonts

Preferred:

- Inter for primary UI
- system sans-serif fallback

Example:

```css
font-family:
  Inter,
  ui-sans-serif,
  system-ui,
  -apple-system,
  BlinkMacSystemFont,
  "Segoe UI",
  sans-serif;
```

Do not use decorative display fonts.

---

# 9. Typography

Suggested scale:

```text
Display       32–40px / 1.1
Page Heading  28–32px / 1.2
Section       20–24px / 1.3
Card Heading  16–18px / 1.4
Body          14–16px / 1.5
Small         12–13px / 1.4
Caption       11–12px / 1.4
```

Weight:

- Display: 600–700
- Heading: 600
- Body: 400
- Labels: 500
- Metadata: 400–500

Avoid excessive bold text.

---

# Visual Quality Rules

1. Establish hierarchy before decoration.
2. Use whitespace deliberately.
3. Keep alignment consistent.
4. Avoid unnecessary borders.
5. Avoid excessive shadows.
6. Do not use gradients everywhere.
7. Keep interactive states obvious.
8. Use motion sparingly.
9. Maintain accessibility.
10. Preserve readability over visual novelty.

The product should look polished because its hierarchy and spacing are disciplined, not because it contains many visual effects.
