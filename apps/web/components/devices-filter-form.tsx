"use client";

/**
 * PHASE-020 T14 — the device registry filter form: class + status selects
 * that submit through the router so the filters stay URL-encoded and
 * shareable (the platform/audit filter pattern).
 */
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FormEvent, JSX } from "react";

import { Button, Select } from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";

const CLASS_OPTIONS = [
  { value: "pos-terminal", key: "syncDevicesClassPosTerminal" },
  { value: "tauri-desktop", key: "syncDevicesClassTauriDesktop" },
  { value: "android-field", key: "syncDevicesClassAndroidField" },
  { value: "android-personal", key: "syncDevicesClassAndroidPersonal" },
] as const;

export function DevicesFilterForm({
  locale,
  initialClass,
  initialStatus,
}: {
  locale: Locale;
  initialClass: string;
  initialStatus: string;
}): JSX.Element {
  const d = getDictionary(locale);
  const router = useRouter();
  const [deviceClass, setDeviceClass] = useState(initialClass);
  const [status, setStatus] = useState(initialStatus);

  function onSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const params = new URLSearchParams();
    if (deviceClass !== "") {
      params.set("class", deviceClass);
    }
    if (status !== "") {
      params.set("status", status);
    }
    const search = params.toString();
    router.push(`/${locale}/platform/devices${search === "" ? "" : `?${search}`}`);
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-wrap items-end gap-3">
      <div className="w-full max-w-56">
        <Select
          label={d.syncDevicesFilterClass}
          value={deviceClass}
          onValueChange={setDeviceClass}
          options={[
            { value: "", label: d.syncDevicesFilterClassAll },
            ...CLASS_OPTIONS.map((option) => ({
              value: option.value,
              label: d[option.key],
            })),
          ]}
        />
      </div>
      <div className="w-full max-w-56">
        <Select
          label={d.syncDevicesFilterStatus}
          value={status}
          onValueChange={setStatus}
          options={[
            { value: "", label: d.syncDevicesFilterStatusAll },
            { value: "active", label: d.syncDevicesFilterStatusActive },
            { value: "revoked", label: d.syncDevicesFilterStatusRevoked },
          ]}
        />
      </div>
      <Button type="submit" variant="primary">
        {d.syncDevicesFilterApply}
      </Button>
    </form>
  );
}
