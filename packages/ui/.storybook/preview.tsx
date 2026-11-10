import type { Decorator, Preview } from "@storybook/react";
import React from "react";

import "@fontsource/ibm-plex-sans-arabic/400.css";
import "@fontsource/ibm-plex-sans-arabic/500.css";
import "@fontsource/ibm-plex-sans-arabic/600.css";
import "@fontsource/ibm-plex-sans-arabic/700.css";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "../src/testing/storybook.css";

import { DirectionProvider, DensityProvider, type Density, type Direction } from "../src/utils/direction";

/** VISUAL_TESTING §3 — deterministic canvas: fixed clock + fonts-ready marker. */
const FIXED_CLOCK = new Date("2026-10-27T09:00:00").getTime();
const RealDate = Date;
class FixedDate extends RealDate {
  constructor(...args: Parameters<DateConstructor>) {
    if (args.length === 0) super(FIXED_CLOCK);
    else super(...args);
  }
  static now(): number {
    return FIXED_CLOCK;
  }
}
(globalThis as { Date: DateConstructor }).Date = FixedDate as unknown as DateConstructor;

/** locale/dir/density are GLOBALS (toolbar + iframe.html?globals=) so the
 *  Playwright matrix can drive both directions over the same stories. */
const withDeterministicCanvas: Decorator = (Story, context) => {
  const locale = ((context.globals.locale as "ar" | "en" | undefined) ?? "ar") as "ar" | "en";
  const dir = ((context.globals.dir as Direction | undefined) ?? (locale === "ar" ? "rtl" : "ltr")) as Direction;
  const density = ((context.globals.density as Density | undefined) ?? "compact") as Density;
  document.documentElement.lang = locale;
  document.documentElement.dir = dir;
  document.documentElement.setAttribute("data-density", density);
  void document.fonts.ready.then(() => {
    document.documentElement.setAttribute("data-visual-ready", "true");
  });
  return (
    <DirectionProvider dir={dir}>
      <DensityProvider density={density}>
        <Story />
      </DensityProvider>
    </DirectionProvider>
  );
};

const preview: Preview = {
  parameters: {
    layout: "centered",
    backgrounds: { default: "page", values: [{ name: "page", value: "var(--erp-surface-page)" }] },
  },
  globalTypes: {
    locale: { description: "Locale (AR default — Arabic-first)", defaultValue: "ar", toolbar: { title: "Locale", items: ["ar", "en"], dynamicTitle: true } },
    dir: { description: "Canvas direction (derived from locale unless forced)", defaultValue: "rtl", toolbar: { title: "Dir", items: ["rtl", "ltr"], dynamicTitle: true } },
    density: { description: "Density mode", defaultValue: "compact", toolbar: { title: "Density", items: ["compact", "comfortable"], dynamicTitle: true } },
  },
  decorators: [withDeterministicCanvas],
};

export default preview;
