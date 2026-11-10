/**
 * Direction + density contexts (DESIGN_SYSTEM §7, RTL_DESIGN_RULES §2).
 *
 * The app shell is the ONLY place that sets `<html lang dir>` (from the
 * session locale). These providers carry that fact down to components in
 * React-land — components never read global state themselves and never set
 * `dir` on layout containers (embedded value runs use the bidi helpers).
 */
import { createContext, useContext } from "react";
import type { JSX, ReactNode } from "react";

export type Direction = "rtl" | "ltr";
export type Density = "compact" | "comfortable";

const DirectionContext = createContext<Direction>("rtl"); // RTL-first: default canvas direction

export function DirectionProvider({
  dir,
  children,
}: {
  dir: Direction;
  children: ReactNode;
}): JSX.Element {
  return <DirectionContext.Provider value={dir}>{children}</DirectionContext.Provider>;
}

/** The active canvas direction — used by the icon registry (§4) and geometry. */
export function useDirection(): Direction {
  return useContext(DirectionContext);
}

const DensityContext = createContext<Density>("compact"); // compact is the documented default

export function DensityProvider({
  density,
  touch = false,
  children,
}: {
  density: Density;
  /** ACCESSIBILITY §8 — touch contexts raise targets to ≥44px. */
  touch?: boolean;
  children: ReactNode;
}): JSX.Element {
  return (
    <div data-density={density} data-touch={touch ? "true" : undefined} className="contents">
      <DensityContext.Provider value={density}>{children}</DensityContext.Provider>
    </div>
  );
}

export function useDensity(): Density {
  return useContext(DensityContext);
}

/** Density-aware control sizing: components apply via cn() — the raw 32/40px
 *  live only in density.css/tokens.ts (§9), referenced through the var. */
export const controlCx = "h-[var(--erp-density-control-height)]";
export const rowCx = "h-[var(--erp-density-row-height)]";
