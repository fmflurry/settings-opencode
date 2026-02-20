# Figma Component Implementation Playbook

When implementing components from Figma, treat this document as high-priority guidance.

## Localization Rules

- For UI labels, always use `transloco` translation keys (never hardcode labels).
- Current supported language is French only.
- Use only the French locale source: `fr-FR.json`.
- Do not introduce or depend on other locale files unless explicitly requested.

## Angular Implementation Rules

- Use modern Angular patterns and current best practices.
- Prefer standalone components, typed APIs, and clear unidirectional data flow.
- Keep templates declarative and avoid legacy patterns when modern alternatives exist.

## Figma Proposal Handling

- Treat generated code component proposals from Figma as guidance, not source of truth.
- Validate proposal structure against project architecture before adopting it.
- If proposal conflicts with local conventions, follow local conventions.

## Styling and Tokens

- Always use design system SCSS variables instead of hardcoded values.
- Never hardcode colors, spacing, radius, shadows, or typography values when a DS variable exists.
- If a required token is missing, add or request a DS variable rather than hardcoding.

## Quality Guardrails

- Build semantic and accessible markup for all interactive elements.
- Keep behavior consistent across supported responsive breakpoints.
- Document assumptions when Figma is ambiguous.
