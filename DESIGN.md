---
name: Obsidian Flux
colors:
  surface: '#0b1326'
  surface-dim: '#0b1326'
  surface-bright: '#31394d'
  surface-container-lowest: '#060e20'
  surface-container-low: '#131b2e'
  surface-container: '#171f33'
  surface-container-high: '#222a3d'
  surface-container-highest: '#2d3449'
  on-surface: '#dae2fd'
  on-surface-variant: '#c2c6d6'
  inverse-surface: '#dae2fd'
  inverse-on-surface: '#283044'
  outline: '#8c909f'
  outline-variant: '#424754'
  surface-tint: '#adc6ff'
  primary: '#adc6ff'
  on-primary: '#002e6a'
  primary-container: '#4d8eff'
  on-primary-container: '#00285d'
  inverse-primary: '#005ac2'
  secondary: '#bcc7de'
  on-secondary: '#263143'
  secondary-container: '#3e495d'
  on-secondary-container: '#aeb9d0'
  tertiary: '#4edea3'
  on-tertiary: '#003824'
  tertiary-container: '#00a572'
  on-tertiary-container: '#00311f'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#d8e2ff'
  primary-fixed-dim: '#adc6ff'
  on-primary-fixed: '#001a42'
  on-primary-fixed-variant: '#004395'
  secondary-fixed: '#d8e3fb'
  secondary-fixed-dim: '#bcc7de'
  on-secondary-fixed: '#111c2d'
  on-secondary-fixed-variant: '#3c475a'
  tertiary-fixed: '#6ffbbe'
  tertiary-fixed-dim: '#4edea3'
  on-tertiary-fixed: '#002113'
  on-tertiary-fixed-variant: '#005236'
  background: '#0b1326'
  on-background: '#dae2fd'
  surface-variant: '#2d3449'
typography:
  display:
    fontFamily: Hanken Grotesk
    fontSize: 48px
    fontWeight: '700'
    lineHeight: '1.1'
  headline-lg:
    fontFamily: Hanken Grotesk
    fontSize: 32px
    fontWeight: '600'
    lineHeight: '1.2'
  headline-lg-mobile:
    fontFamily: Hanken Grotesk
    fontSize: 24px
    fontWeight: '600'
    lineHeight: '1.2'
  title-md:
    fontFamily: Hanken Grotesk
    fontSize: 18px
    fontWeight: '600'
    lineHeight: '1.5'
  body-md:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: '1.6'
  body-sm:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: '1.6'
  label-caps:
    fontFamily: JetBrains Mono
    fontSize: 12px
    fontWeight: '500'
    lineHeight: '1.0'
    letterSpacing: 0.05em
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  grid-margin: 2rem
  gutter: 1.5rem
  container-padding: 1.25rem
  stack-gap: 0.75rem
---

## Brand & Style

The design system is engineered for high-performance administrative environments, focusing on deep focus and reduced eye strain. The brand personality is professional, technical, and precise, utilizing a **Corporate Modern** aesthetic with subtle **Glassmorphic** accents. 

The UI evokes a sense of "command and control" through a monochromatic dark base punctuated by high-energy functional accents. The interface prioritizes clarity of data and hierarchy of action, ensuring that information-dense dashboards remain scannable and intuitive.

## Colors

The color strategy uses a **deep navy-black foundation** to create maximum contrast with vibrant functional colors.

- **Primary (#3b82f6):** A technical blue used for active states, primary actions, and brand identification.
- **Surface Layering:** The system uses `#0f172a` for the base background, `#1e293b` for primary containers, and `#334155` for high-contrast borders or secondary text.
- **Accents:** Tertiary greens and purples are used sparingly to categorize different data types (e.g., success states or specific metric categories).

## Typography

This design system employs a tiered typographic approach:
- **Hanken Grotesk** for headlines provides a sharp, contemporary look that feels engineered and modern.
- **Inter** handles the heavy lifting of body text and data grids, chosen for its exceptional legibility in dark mode environments.
- **JetBrains Mono** is utilized for metadata, tags, and secondary labels to reinforce the technical/admin nature of the product.

## Layout & Spacing

The system follows a **12-column fluid grid** for desktop, collapsing to a single-column stack on mobile. 

- **Sidebar:** Fixed at 280px on desktop, transforming into a hidden drawer or bottom navigation on mobile.
- **Spacing Rhythm:** Based on an 8px (0.5rem) base unit. Standard card padding is 20px (1.25rem) to provide breathing room without sacrificing data density.
- **Breakpoints:**
  - Mobile: < 768px (margins: 1rem, gutters: 1rem)
  - Tablet: 768px - 1280px (margins: 1.5rem, gutters: 1.25rem)
  - Desktop: > 1280px (margins: 2rem, gutters: 1.5rem)

## Elevation & Depth

Hierarchy is defined by directional light sources and specific shadow distributions rather than high-contrast borders.

- **Surface Tiers:** Background is the lowest tier. Cards and panels sit on the middle tier. Modals and popovers occupy the top tier.
- **Shadow Directionality:** 
  - **Top Shadow:** Subtle (0.2 opacity) to define the edge against the header.
  - **Side Shadows:** Pronounced (0.3 opacity) to separate the content from the sidebar and right-hand margins.
  - **Bottom Shadow:** Intense and deep (0.6 opacity) to create a strong sense of physical weight and vertical stacking.
- **Hover Interaction:** Inactive cards use a subtle 1px border. On hover, the border is removed and replaced by an **intensive directional shadow bloom** (increased spread and opacity) and a slight vertical translation (-4px) to emphasize the lift.

## Shapes

The shape language is consistently **Rounded**, striking a balance between approachable software and professional utility.

- **Standard Containers:** Cards and input fields use a 0.5rem (8px) radius.
- **Large Components:** High-level sections and prominent dashboard widgets use a 1rem (16px) radius to emphasize their importance.
- **Interactive Elements:** Buttons utilize a slightly more aggressive rounding (rounded-lg) to make them feel "clickable" and distinct from static containers.

## Components

- **Cards:** The core container. Features a subtle background tint (`#1e293b`). Hover states must trigger a significant depth change via the enhanced directional shadows.
- **Buttons:** 
  - **Primary:** Solid Vibrant Blue (#3b82f6) with white text.
  - **Secondary:** Transparent background with a thin stroke and high-blur shadow on hover.
- **Input Fields:** Darker than the card background to create a "recessed" feel. Focus states use a glowing blue outer shadow.
- **Sidebar Nav:** Uses a "pill" highlight for active states. The active item should have a slight glow effect (box-shadow: 0 0 20px rgba(59, 130, 246, 0.4)).
- **Chips & Tags:** Small, semi-transparent background with high-contrast text. Use monospaced font for status tags.
- **Data Grids:** Alternating row highlights (zebra striping) are discouraged; use thin, low-opacity horizontal dividers instead to maintain the "clean" aesthetic.
