import { describe, expect, it } from "vitest";
import TestRenderer from "react-test-renderer";

/**
 * PHASE-022 scaffold smoke test — proves the vitest JSX pipeline end-to-end
 * BEFORE the screen waves rely on it: esbuild `jsx: "automatic"` compiles
 * .tsx without a React-in-scope import (matching tsconfig `"jsx":
 * "react-jsx"`), and react-test-renderer (the RN component renderer) loads
 * and runs on Node.
 *
 * HONEST DEFERRAL (T-P22-1a recorded observation, feeds DR-P22-xx): the
 * react-native package itself ships Flow syntax (`import typeof …` in
 * index.js + `@flow strict-local` Library sources) that Node, esbuild and
 * rollup all refuse to parse — verified on react-native 0.76.9 — so RN
 * *components* (View/Text trees) need a flow-stripping transform pipeline
 * before they can render under vitest. babel (@babel/core +
 * babel-plugin-syntax-hermes-parser + @babel/plugin-transform-flow-strip —
 * all already in the pnpm store via RN's own dependency tree) provably
 * produces clean, parseable output; wiring it into vite-node is the
 * remaining engineering task (candidate: the community
 * vite-plugin-react-native). Until then this test renders a pure-React
 * component to validate the JSX pipeline itself.
 */
describe("PHASE-022 scaffold — JSX pipeline (esbuild automatic runtime)", () => {
  it("renders a .tsx component through react-test-renderer on Node", () => {
    function ScaffoldLabel({ title }: { title: string }) {
      return <span data-testid="scaffold-label">{title}</span>;
    }

    const renderer = TestRenderer.create(<ScaffoldLabel title="ERP Field" />);

    expect(renderer.root.findByProps({ "data-testid": "scaffold-label" }).props.children).toBe(
      "ERP Field",
    );
    expect(renderer.toJSON()).toMatchObject({
      props: { "data-testid": "scaffold-label" },
      children: ["ERP Field"],
    });

    renderer.unmount();
  });
});
