"use client";

/**
 * P5-T12 — client-component bridge for SERVER modules. The frozen @erp/ui
 * barrel (`src/index.ts`) mixes pure utilities with client-context modules
 * (createContext in utils/direction), so ANY value import of "@erp/ui" from
 * a React Server Component pulls createContext into the server graph and
 * fails the Turbopack build. Server pages/shells import the client catalog
 * components from THIS "use client" re-export instead — the boundary lands
 * here, the barrel compiles client-side only. Client components keep
 * importing "@erp/ui" directly. (packages/ui is frozen this phase; tracked
 * for the phase report.)
 */
export { AppShell, Breadcrumbs, Icon, Badge, DocumentStatusBadge, EmptyState, ErrorState, LoadingState } from "@erp/ui";
