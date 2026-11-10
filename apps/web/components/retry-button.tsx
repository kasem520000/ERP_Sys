"use client";

/**
 * P5-T12 — Retry action for server-rendered ErrorState blocks: refreshes the
 * current route (server components re-run their fetches).
 */
import { useRouter } from "next/navigation";
import type { JSX } from "react";

import { Button } from "@erp/ui";

export function RetryButton({ label }: { label: string }): JSX.Element {
  const router = useRouter();
  return (
    <Button variant="secondary" size="sm" onClick={() => router.refresh()}>
      {label}
    </Button>
  );
}
