/**
 * Story matrix generator (VISUAL_TESTING: "story names encode locale — the
 * matrix is generated, not hand-listed"). Produces CSF story objects for
 * state × locale (× density on the comfortable companion) with parameters
 * the preview decorator consumes (dir/lang/density).
 */
import type { ReactNode } from "react";

export type StoryState = "default" | "focus-visible" | "disabled" | "error" | "loading" | "empty";

export const STATE_LABELS: Record<StoryState, string> = {
  default: "default",
  "focus-visible": "focus",
  disabled: "disabled",
  error: "error",
  loading: "loading",
  empty: "empty",
};

export interface MatrixStory {
  name: string;
  render: () => ReactNode;
  parameters: { dir: "rtl" | "ltr"; locale: "ar" | "en"; density?: "compact" | "comfortable" };
}

/**
 * buildMatrix({ default: <Comp/>, error: <Comp error/> }) →
 *   { "ar/default": …, "en/default": …, "ar/error": …, "en/error": …,
 *     "ar/default comfortable": …, "en/default comfortable": … }
 * AR is the base canvas (RTL-first); EN is the mirrored verification pass;
 * comfortable density lands once per state on the default story.
 */
export function buildMatrix(
  states: Partial<Record<StoryState, ReactNode>>,
  options: { comfortableOn?: StoryState } = {},
): Record<string, MatrixStory> {
  const stories: Record<string, MatrixStory> = {};
  const comfortableOn = options.comfortableOn ?? "default";
  for (const [state, node] of Object.entries(states) as Array<[StoryState, ReactNode]>) {
    for (const locale of ["ar", "en"] as const) {
      stories[`${locale}/${STATE_LABELS[state]}`] = {
        name: `${locale}/${STATE_LABELS[state]}`,
        render: () => node,
        parameters: { dir: locale === "ar" ? "rtl" : "ltr", locale },
      };
      if (state === comfortableOn) {
        stories[`${locale}/${STATE_LABELS[state]} comfortable`] = {
          name: `${locale}/${STATE_LABELS[state]} comfortable`,
          render: () => node,
          parameters: { dir: locale === "ar" ? "rtl" : "ltr", locale, density: "comfortable" },
        };
      }
    }
  }
  return stories;
}
