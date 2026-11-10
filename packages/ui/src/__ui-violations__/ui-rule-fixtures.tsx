/**
 * NEGATIVE FIXTURES for the erp-ui lint rules — deliberately violating each
 * rule. Ignored by the normal lint run (root config ignores
 * **/__ui-violations__/**) and linted with --no-ignore by
 * scripts/ci/negative-ui-rules-test.sh, which asserts that EVERY fixture
 * fails `pnpm lint` (PHASE-001 negative meta-test pattern, PHASE-005 T2).
 */
import { Dialog as RadixDialog } from "@radix-ui/react-dialog"; // violates erp-ui/no-raw-radix (outside primitives)

export function BadPhysical(): React.ReactNode {
  return <div className="pl-4 text-left">physical</div>; // violates erp-ui/no-physical-direction
}

export function BadLeft(): React.ReactNode {
  return <div className="left-0 border-l-2">anchored</div>; // violates erp-ui/no-physical-direction
}

export function BadRawValue(): React.ReactNode {
  return <div style={{ color: "#0F766E", padding: "12px" }}>raw</div>; // violates erp-ui/no-raw-design-values
}

export { RadixDialog };
