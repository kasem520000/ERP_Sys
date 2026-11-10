"use client";

/**
 * P4-T12a — branch create form. POST /api/bff/tenancy/branches
 * { code, name, nameAr? }; 409 tenancy/branch-code-taken maps to the
 * localized duplicate-code message.
 */
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FormEvent, JSX } from "react";

import { Button, Input } from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type { BranchRow } from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import { localizedTenancyError } from "../lib/messages";
import { ErrorNotice } from "./notices";

export function BranchCreateForm({ locale }: { locale: Locale }): JSX.Element {
  const d = getDictionary(locale);
  const router = useRouter();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [nameAr, setNameAr] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    if (code.trim() === "" || name.trim() === "") {
      setError(d.errorsValidation);
      return;
    }
    const body: Record<string, unknown> = { code: code.trim(), name: name.trim() };
    if (nameAr.trim() !== "") {
      body.nameAr = nameAr.trim();
    }
    setBusy(true);
    const result = await bffFetch<BranchRow>("tenancy/branches", { method: "POST", body });
    setBusy(false);
    if (!result.ok) {
      setError(localizedTenancyError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setCode("");
    setName("");
    setNameAr("");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <Input
        id="branch-code"
        label={d.branchesCodeLabel}
        type="text"
        name="code"
        required
        mono
        bidiIsolate
        value={code}
        onValueChange={setCode}
      />
      <Input
        id="branch-name"
        label={d.branchesNameLabel}
        type="text"
        name="name"
        required
        value={name}
        onValueChange={setName}
      />
      <Input
        id="branch-name-ar"
        label={d.branchesNameArLabel}
        type="text"
        name="nameAr"
        value={nameAr}
        onValueChange={setNameAr}
      />
      <div>
        <Button type="submit" variant="primary" loading={busy}>
          {d.branchesCreateSubmit}
        </Button>
      </div>
      {error !== null && <ErrorNotice>{error}</ErrorNotice>}
    </form>
  );
}
