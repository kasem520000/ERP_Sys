/**
 * PHASE-013 · render-engine holder: production binds the Chromium engine
 * lazily; tests can bind a fake (render contract tests without a browser)
 * or the real one (PDF inspection tests).
 */
import { ChromiumRenderEngine, type RenderEngine } from "./render-engine";

let engine: RenderEngine | undefined;

export function getRenderEngine(): RenderEngine {
  if (engine === undefined) {
    engine = new ChromiumRenderEngine();
  }
  return engine;
}

export function setRenderEngine(replacement: RenderEngine | undefined): void {
  engine = replacement;
}
