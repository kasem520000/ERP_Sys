# packages/ui — Design System (PHASE-005)

Placeholder package. The bilingual (AR/EN) design system — tokens per
[docs/ui/DESIGN_TOKENS.md](../../docs/ui/DESIGN_TOKENS.md), 49 catalog
components, RTL-first — is implemented in
[PHASE-005](../../docs/implementation/phases/PHASE-005.md) under
[ADR-0016](../../docs/architecture/ADR/ADR-0016-design-system.md).

Enforced from PHASE-001 by ESLint (`erp-rules/no-physical-direction`): code in
this package may never use physical-direction utilities (`pl-`, `pr-`, `ml-`,
`mr-`, `text-left`, `text-right`); logical `start/end` utilities only
([RTL rules](../../docs/ui/RTL_DESIGN_RULES.md)).
