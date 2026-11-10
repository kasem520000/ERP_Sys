/**
 * P5-T12 — server-safe class join. The @erp/ui barrel re-exports
 * client-context modules (DirectionProvider uses createContext), so pure
 * app-side presentational components that render inside BOTH server and
 * client trees must not import `cn` from the barrel — a server-module value
 * import of "@erp/ui" pulls createContext into the RSC graph and fails the
 * Turbopack build. This join covers the app-side primitives (card, notices,
 * def-list, link-button) whose class lists never contain conflicts.
 */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter((part): part is string => typeof part === "string" && part !== "").join(" ");
}
