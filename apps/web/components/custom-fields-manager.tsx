"use client";

/**
 * WEB-036 (PHASE-036) — the custom-fields manager (/settings/custom-fields;
 * settings archetype, 12-template discipline): three tabs over the
 * configuration/custom-fields manager routes —
 *
 * 1. Definitions (FD-18): the per-entity field registry (entity, key,
 *    label, data type, required, status) with the create dialog (per-type
 *    config + the validation-rule × data-type matrix) and the
 *    edit/archive/restore actions. Entity, key and data type are immutable
 *    — the edit dialog renders them read-only.
 * 2. Picklists (FD-20): the shared value lists with the option editor
 *    (add/edit/archive/restore + up/down reorder riding the full ACTIVE id
 *    order) — archived options stay listed for history (BR-057).
 * 3. Form designer (FD-19): per-entity default layouts + role overrides;
 *    sections as cards, fields as chip rows. Mandatory native fields carry
 *    the lock marker (BR-059) — their remove/reorder controls are disabled
 *    and the server re-enforces anyway.
 *
 * Writes gate in-screen on the manager permissions (the page passes the
 * session-derived flags); every typed 400/422 family renders localized via
 * localizedCustomFieldsError.
 */
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { JSX } from "react";

import {
  Badge,
  Button,
  Checkbox,
  DataTable,
  Dialog,
  IconButton,
  Input,
  NumberInput,
  Select,
  Tabs,
} from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type {
  CustomFieldDataType,
  CustomFieldDefinitionRow,
  CustomFieldEntityInfo,
  CustomPicklistOptionRow,
  CustomPicklistRow,
  FormLayoutRow,
} from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import {
  formatMessage,
  localizedCustomFieldDataType,
  localizedCustomFieldRole,
  localizedCustomFieldsError,
  localizedName,
} from "../lib/messages";
import { Card } from "./card";
import { DefList } from "./def-list";
import { ErrorNotice, InfoNotice, SuccessNotice } from "./notices";
import { activeLocaleHeader } from "./table-header";

type ManagerTab = "definitions" | "picklists" | "layouts";

const DATA_TYPES: readonly CustomFieldDataType[] = [
  "TEXT",
  "NUMBER",
  "DATE",
  "BOOLEAN",
  "SELECT",
  "MULTISELECT",
  "REFERENCE",
];

const ROLE_KEYS: readonly string[] = [
  "owner",
  "accountant",
  "sales",
  "purchasing",
  "warehouse",
  "cashier",
  "viewer",
  "payroll_officer",
];

/** BR-058 key syntax (the server's typed 422 is the authority; this is UX). */
const KEY_RE = /^[a-z][a-z0-9_]{0,63}$/;

/** Picklist detail payload (GET picklists/:id — row + options). */
type PicklistDetail = CustomPicklistRow & { options?: readonly CustomPicklistOptionRow[] };

/** The designer's editable section shape (the wire FormLayoutSection). */
interface SectionDraft {
  key: string;
  label: string;
  labelAr: string;
  collapsed: boolean;
  columns: number;
  fields: Array<{ key: string; custom: boolean }>;
}

/** The create/edit definition form draft (all inputs are strings). */
interface DefinitionDraft {
  entityType: string;
  key: string;
  label: string;
  labelAr: string;
  dataType: CustomFieldDataType;
  picklistId: string;
  referenceEntity: string;
  precision: string;
  required: boolean;
  validationRegex: string;
  minLength: string;
  maxLength: string;
  minValue: string;
  maxValue: string;
}

function emptyDefinitionDraft(entityType: string): DefinitionDraft {
  return {
    entityType,
    key: "",
    label: "",
    labelAr: "",
    dataType: "TEXT",
    picklistId: "",
    referenceEntity: "",
    precision: "2",
    required: false,
    validationRegex: "",
    minLength: "",
    maxLength: "",
    minValue: "",
    maxValue: "",
  };
}

function draftFromDefinition(row: CustomFieldDefinitionRow): DefinitionDraft {
  return {
    entityType: row.entityType,
    key: row.key,
    label: row.label,
    labelAr: row.labelAr,
    dataType: row.dataType,
    picklistId: row.config.picklistId ?? "",
    referenceEntity: row.config.referenceEntity ?? "",
    precision: row.config.precision === undefined ? "2" : String(row.config.precision),
    required: row.required,
    validationRegex: row.validationRegex ?? "",
    minLength: row.minLength === null ? "" : String(row.minLength),
    maxLength: row.maxLength === null ? "" : String(row.maxLength),
    minValue: row.minValue === null ? "" : String(row.minValue),
    maxValue: row.maxValue === null ? "" : String(row.maxValue),
  };
}

function intOrNull(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === "") {
    return null;
  }
  const parsed = Number(trimmed);
  return Number.isInteger(parsed) ? parsed : null;
}

function numberOrNull(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === "") {
    return null;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

/** The per-type config slice (SELECT/MULTISELECT/REFERENCE/NUMBER only). */
function configOf(draft: DefinitionDraft): Record<string, string | number> | undefined {
  switch (draft.dataType) {
    case "SELECT":
    case "MULTISELECT":
      return draft.picklistId === "" ? undefined : { picklistId: draft.picklistId };
    case "REFERENCE":
      return draft.referenceEntity === "" ? undefined : { referenceEntity: draft.referenceEntity };
    case "NUMBER": {
      const precision = intOrNull(draft.precision);
      return precision === null ? undefined : { precision };
    }
    default:
      return undefined;
  }
}

/** The validation-rule × data-type matrix slice (TEXT lengths/regex, NUMBER bounds). */
function validationOf(
  draft: DefinitionDraft,
): Record<string, number | string | null> {
  switch (draft.dataType) {
    case "TEXT":
      return {
        validationRegex: draft.validationRegex.trim() === "" ? null : draft.validationRegex.trim(),
        minLength: intOrNull(draft.minLength),
        maxLength: intOrNull(draft.maxLength),
      };
    case "NUMBER":
      return {
        minValue: numberOrNull(draft.minValue),
        maxValue: numberOrNull(draft.maxValue),
      };
    default:
      return {};
  }
}

function definitionDraftReady(draft: DefinitionDraft): boolean {
  if (draft.entityType === "" || !KEY_RE.test(draft.key.trim())) {
    return false;
  }
  if (draft.label.trim() === "" || draft.labelAr.trim() === "") {
    return false;
  }
  if (draft.dataType === "SELECT" || draft.dataType === "MULTISELECT") {
    return draft.picklistId !== "";
  }
  if (draft.dataType === "REFERENCE") {
    return draft.referenceEntity !== "";
  }
  return true;
}

export function CustomFieldsManager({
  locale,
  initialDefinitions,
  initialPicklists,
  entities,
  canManage,
  canManageLayouts,
}: {
  locale: Locale;
  initialDefinitions: readonly CustomFieldDefinitionRow[];
  initialPicklists: readonly CustomPicklistRow[];
  entities: readonly CustomFieldEntityInfo[];
  canManage: boolean;
  canManageLayouts: boolean;
}): JSX.Element {
  const d = getDictionary(locale);
  const router = useRouter();

  const [tab, setTab] = useState<ManagerTab>("definitions");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // -- definitions tab state --------------------------------------------------
  const [definitions, setDefinitions] = useState<readonly CustomFieldDefinitionRow[]>(
    initialDefinitions,
  );
  const [entityFilter, setEntityFilter] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [createDraft, setCreateDraft] = useState<DefinitionDraft>(() =>
    emptyDefinitionDraft(entities[0]?.entityType ?? ""),
  );
  const [editTarget, setEditTarget] = useState<CustomFieldDefinitionRow | null>(null);
  const [editDraft, setEditDraft] = useState<DefinitionDraft>(() =>
    emptyDefinitionDraft(entities[0]?.entityType ?? ""),
  );
  const [archiveId, setArchiveId] = useState<string | null>(null);

  // -- picklists tab state ----------------------------------------------------
  const [picklists, setPicklists] = useState<readonly CustomPicklistRow[]>(initialPicklists);
  const [picklistDraft, setPicklistDraft] = useState({ key: "", name: "", nameAr: "" });
  const [renameTarget, setRenameTarget] = useState<CustomPicklistRow | null>(null);
  const [renameDraft, setRenameDraft] = useState({ name: "", nameAr: "" });
  const [optionsTargetId, setOptionsTargetId] = useState<string | null>(null);
  const [optionsDetail, setOptionsDetail] = useState<PicklistDetail | null>(null);
  const [optionsBusy, setOptionsBusy] = useState(false);
  const [optionDraft, setOptionDraft] = useState({ label: "", labelAr: "" });
  const [optionEditTarget, setOptionEditTarget] = useState<CustomPicklistOptionRow | null>(null);
  const [optionEditDraft, setOptionEditDraft] = useState({ label: "", labelAr: "", sortOrder: "" });

  // -- layouts tab state --------------------------------------------------------
  const [layoutEntity, setLayoutEntity] = useState(entities[0]?.entityType ?? "");
  const [layouts, setLayouts] = useState<readonly FormLayoutRow[]>([]);
  const [layoutsLoading, setLayoutsLoading] = useState(false);
  const [layoutError, setLayoutError] = useState<string | null>(null);
  const [surfaceDefinitions, setSurfaceDefinitions] = useState<readonly CustomFieldDefinitionRow[]>(
    [],
  );
  const [editingRole, setEditingRole] = useState<string>("__default");
  const [newRole, setNewRole] = useState("");
  const [layoutName, setLayoutName] = useState("");
  const [sections, setSections] = useState<readonly SectionDraft[]>([]);
  const [addFieldChoice, setAddFieldChoice] = useState<Record<string, string>>({});

  const entityOptions = useMemo(
    () =>
      entities.map((entity) => ({
        value: entity.entityType,
        label: localizedName(entity.label, entity.labelAr, locale),
      })),
    [entities, locale],
  );

  function entityLabel(entityType: string): string {
    const entity = entities.find((row) => row.entityType === entityType);
    return entity === undefined ? entityType : localizedName(entity.label, entity.labelAr, locale);
  }

  const filteredDefinitions = useMemo(
    () =>
      entityFilter === ""
        ? definitions
        : definitions.filter((row) => row.entityType === entityFilter),
    [definitions, entityFilter],
  );

  const archiveTarget =
    archiveId === null ? null : (definitions.find((row) => row.id === archiveId) ?? null);

  const optionsTarget =
    optionsTargetId === null ? null : (picklists.find((row) => row.id === optionsTargetId) ?? null);

  // -- definitions actions ------------------------------------------------------

  function openCreate(): void {
    setCreateDraft(emptyDefinitionDraft(entities[0]?.entityType ?? ""));
    setCreateOpen(true);
  }

  async function createDefinition(): Promise<void> {
    if (!definitionDraftReady(createDraft)) {
      setError(d.errorsValidation);
      return;
    }
    setBusy("definition-create");
    setError(null);
    setNotice(null);
    const created = await bffFetch<CustomFieldDefinitionRow>(
      "configuration/custom-fields/definitions",
      {
        method: "POST",
        body: {
          entityType: createDraft.entityType,
          key: createDraft.key.trim(),
          label: createDraft.label.trim(),
          labelAr: createDraft.labelAr.trim(),
          dataType: createDraft.dataType,
          ...(configOf(createDraft) === undefined ? {} : { config: configOf(createDraft) }),
          required: createDraft.required,
          ...validationOf(createDraft),
        },
      },
    );
    setBusy(null);
    if (!created.ok) {
      setError(localizedCustomFieldsError(d, created.error, created.retryAfterSeconds));
      return;
    }
    setDefinitions((rows) => [...rows, created.data]);
    setCreateOpen(false);
    setNotice(d.customFieldsCreatedToast);
    router.refresh();
  }

  function openEdit(row: CustomFieldDefinitionRow): void {
    setEditTarget(row);
    setEditDraft(draftFromDefinition(row));
  }

  async function saveEdit(): Promise<void> {
    if (editTarget === null) {
      return;
    }
    const draft = editDraft;
    if (draft.label.trim() === "" || draft.labelAr.trim() === "") {
      setError(d.errorsValidation);
      return;
    }
    if ((draft.dataType === "SELECT" || draft.dataType === "MULTISELECT") && draft.picklistId === "") {
      setError(d.errorsValidation);
      return;
    }
    if (draft.dataType === "REFERENCE" && draft.referenceEntity === "") {
      setError(d.errorsValidation);
      return;
    }
    setBusy("definition-edit");
    setError(null);
    setNotice(null);
    const updated = await bffFetch<CustomFieldDefinitionRow>(
      `configuration/custom-fields/definitions/${editTarget.id}`,
      {
        method: "PATCH",
        body: {
          label: draft.label.trim(),
          labelAr: draft.labelAr.trim(),
          required: draft.required,
          ...(configOf(draft) === undefined ? {} : { config: configOf(draft) }),
          ...validationOf(draft),
        },
      },
    );
    setBusy(null);
    if (!updated.ok) {
      setError(localizedCustomFieldsError(d, updated.error, updated.retryAfterSeconds));
      return;
    }
    setDefinitions((rows) => rows.map((row) => (row.id === editTarget.id ? updated.data : row)));
    setEditTarget(null);
    setNotice(d.customFieldsSavedToast);
    router.refresh();
  }

  async function archiveDefinition(): Promise<void> {
    if (archiveId === null) {
      return;
    }
    setBusy(`definition-archive-${archiveId}`);
    setError(null);
    setNotice(null);
    const archived = await bffFetch<CustomFieldDefinitionRow>(
      `configuration/custom-fields/definitions/${archiveId}/archive`,
      { method: "POST", body: {} },
    );
    setBusy(null);
    if (!archived.ok) {
      setError(localizedCustomFieldsError(d, archived.error, archived.retryAfterSeconds));
      return;
    }
    setDefinitions((rows) => rows.map((row) => (row.id === archiveId ? archived.data : row)));
    setArchiveId(null);
    setNotice(d.customFieldsArchivedToast);
    router.refresh();
  }

  async function restoreDefinition(id: string): Promise<void> {
    setBusy(`definition-restore-${id}`);
    setError(null);
    setNotice(null);
    const restored = await bffFetch<CustomFieldDefinitionRow>(
      `configuration/custom-fields/definitions/${id}/restore`,
      { method: "POST", body: {} },
    );
    setBusy(null);
    if (!restored.ok) {
      setError(localizedCustomFieldsError(d, restored.error, restored.retryAfterSeconds));
      return;
    }
    setDefinitions((rows) => rows.map((row) => (row.id === id ? restored.data : row)));
    setNotice(d.customFieldsRestoredToast);
    router.refresh();
  }

  // -- picklists actions ----------------------------------------------------------

  async function refreshPicklists(): Promise<void> {
    const rows = await bffFetch<readonly CustomPicklistRow[]>("configuration/custom-fields/picklists");
    if (rows.ok) {
      setPicklists(rows.data);
    }
  }

  async function createPicklist(): Promise<void> {
    if (
      !KEY_RE.test(picklistDraft.key.trim()) ||
      picklistDraft.name.trim() === "" ||
      picklistDraft.nameAr.trim() === ""
    ) {
      setError(d.errorsValidation);
      return;
    }
    setBusy("picklist-create");
    setError(null);
    setNotice(null);
    const created = await bffFetch<CustomPicklistRow>("configuration/custom-fields/picklists", {
      method: "POST",
      body: {
        key: picklistDraft.key.trim(),
        name: picklistDraft.name.trim(),
        nameAr: picklistDraft.nameAr.trim(),
      },
    });
    setBusy(null);
    if (!created.ok) {
      setError(localizedCustomFieldsError(d, created.error, created.retryAfterSeconds));
      return;
    }
    setPicklists((rows) => [...rows, created.data]);
    setPicklistDraft({ key: "", name: "", nameAr: "" });
    setNotice(d.customFieldsPicklistCreatedToast);
    router.refresh();
  }

  async function savePicklistRename(): Promise<void> {
    if (
      renameTarget === null ||
      renameDraft.name.trim() === "" ||
      renameDraft.nameAr.trim() === ""
    ) {
      return;
    }
    setBusy("picklist-rename");
    setError(null);
    setNotice(null);
    const updated = await bffFetch<CustomPicklistRow>(
      `configuration/custom-fields/picklists/${renameTarget.id}`,
      {
        method: "PATCH",
        body: { name: renameDraft.name.trim(), nameAr: renameDraft.nameAr.trim() },
      },
    );
    setBusy(null);
    if (!updated.ok) {
      setError(localizedCustomFieldsError(d, updated.error, updated.retryAfterSeconds));
      return;
    }
    setPicklists((rows) => rows.map((row) => (row.id === updated.data.id ? updated.data : row)));
    setRenameTarget(null);
    setNotice(d.customFieldsPicklistSavedToast);
    router.refresh();
  }

  async function setPicklistStatus(id: string, next: "ACTIVE" | "ARCHIVED"): Promise<void> {
    setBusy(`picklist-${next.toLowerCase()}-${id}`);
    setError(null);
    setNotice(null);
    const result = await bffFetch<CustomPicklistRow>(
      `configuration/custom-fields/picklists/${id}/${next === "ARCHIVED" ? "archive" : "restore"}`,
      { method: "POST", body: {} },
    );
    setBusy(null);
    if (!result.ok) {
      setError(localizedCustomFieldsError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setPicklists((rows) => rows.map((row) => (row.id === id ? result.data : row)));
    setNotice(
      next === "ARCHIVED"
        ? d.customFieldsPicklistArchivedToast
        : d.customFieldsPicklistRestoredToast,
    );
    router.refresh();
  }

  async function loadOptions(id: string): Promise<void> {
    setOptionsBusy(true);
    const detail = await bffFetch<PicklistDetail>(`configuration/custom-fields/picklists/${id}`);
    setOptionsBusy(false);
    if (!detail.ok) {
      setError(localizedCustomFieldsError(d, detail.error, detail.retryAfterSeconds));
      return;
    }
    setOptionsDetail(detail.data);
  }

  function openOptions(row: CustomPicklistRow): void {
    setOptionsTargetId(row.id);
    setOptionsDetail(null);
    setOptionDraft({ label: "", labelAr: "" });
    void loadOptions(row.id);
  }

  async function addOption(): Promise<void> {
    if (optionsTargetId === null || optionDraft.label.trim() === "" || optionDraft.labelAr.trim() === "") {
      setError(d.errorsValidation);
      return;
    }
    setBusy("option-add");
    setError(null);
    setNotice(null);
    const added = await bffFetch<CustomPicklistOptionRow>(
      `configuration/custom-fields/picklists/${optionsTargetId}/options`,
      {
        method: "POST",
        body: { label: optionDraft.label.trim(), labelAr: optionDraft.labelAr.trim() },
      },
    );
    setBusy(null);
    if (!added.ok) {
      setError(localizedCustomFieldsError(d, added.error, added.retryAfterSeconds));
      return;
    }
    setOptionDraft({ label: "", labelAr: "" });
    setNotice(d.customFieldsOptionAddedToast);
    await Promise.all([loadOptions(optionsTargetId), refreshPicklists()]);
  }

  async function saveOptionEdit(): Promise<void> {
    if (optionEditTarget === null || optionEditDraft.label.trim() === "" || optionEditDraft.labelAr.trim() === "") {
      return;
    }
    const body: Record<string, unknown> = {
      label: optionEditDraft.label.trim(),
      labelAr: optionEditDraft.labelAr.trim(),
    };
    const sortOrder = intOrNull(optionEditDraft.sortOrder);
    if (sortOrder !== null) {
      body.sortOrder = sortOrder;
    }
    setBusy("option-edit");
    setError(null);
    setNotice(null);
    const updated = await bffFetch<CustomPicklistOptionRow>(
      `configuration/custom-fields/picklist-options/${optionEditTarget.id}`,
      { method: "PATCH", body },
    );
    setBusy(null);
    if (!updated.ok) {
      setError(localizedCustomFieldsError(d, updated.error, updated.retryAfterSeconds));
      return;
    }
    setOptionEditTarget(null);
    setNotice(d.customFieldsOptionSavedToast);
    if (optionsTargetId !== null) {
      await Promise.all([loadOptions(optionsTargetId), refreshPicklists()]);
    }
  }

  async function setOptionStatus(optionId: string, next: "ACTIVE" | "ARCHIVED"): Promise<void> {
    if (optionsTargetId === null) {
      return;
    }
    setBusy(`option-${next.toLowerCase()}-${optionId}`);
    setError(null);
    setNotice(null);
    const result = await bffFetch<CustomPicklistOptionRow>(
      `configuration/custom-fields/picklist-options/${optionId}/${next === "ARCHIVED" ? "archive" : "restore"}`,
      { method: "POST", body: {} },
    );
    setBusy(null);
    if (!result.ok) {
      setError(localizedCustomFieldsError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setNotice(
      next === "ARCHIVED" ? d.customFieldsOptionArchivedToast : d.customFieldsOptionRestoredToast,
    );
    await Promise.all([loadOptions(optionsTargetId), refreshPicklists()]);
  }

  /** Reorder = swap within the ACTIVE order, then POST the full id list. */
  async function moveOption(optionId: string, direction: -1 | 1): Promise<void> {
    if (optionsTargetId === null || optionsDetail === null) {
      return;
    }
    const activeIds = [...(optionsDetail.options ?? [])]
      .filter((option) => option.status === "ACTIVE")
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((option) => option.id);
    const index = activeIds.indexOf(optionId);
    const target = index + direction;
    if (index === -1 || target < 0 || target >= activeIds.length) {
      return;
    }
    const current = activeIds[index];
    const neighbor = activeIds[target];
    if (current === undefined || neighbor === undefined) {
      return;
    }
    activeIds[index] = neighbor;
    activeIds[target] = current;
    setBusy(`option-move-${optionId}`);
    setError(null);
    setNotice(null);
    const reordered = await bffFetch<unknown>(
      `configuration/custom-fields/picklists/${optionsTargetId}/options/reorder`,
      { method: "POST", body: { optionIds: activeIds } },
    );
    setBusy(null);
    if (!reordered.ok) {
      setError(localizedCustomFieldsError(d, reordered.error, reordered.retryAfterSeconds));
      return;
    }
    setNotice(d.customFieldsOptionsReorderedToast);
    await loadOptions(optionsTargetId);
  }

  // -- layouts tab actions -----------------------------------------------------------

  const entityInfo = useMemo(
    () => entities.find((entity) => entity.entityType === layoutEntity) ?? null,
    [entities, layoutEntity],
  );

  const nativeByKey = useMemo(() => {
    const map = new Map<string, { key: string; label: string; labelAr: string; mandatory: boolean }>();
    for (const field of entityInfo?.nativeFields ?? []) {
      map.set(field.key, field);
    }
    return map;
  }, [entityInfo]);

  function isMandatoryNative(field: { key: string; custom: boolean }): boolean {
    return !field.custom && (nativeByKey.get(field.key)?.mandatory ?? false);
  }

  function designerFieldLabel(field: { key: string; custom: boolean }): string {
    if (field.custom) {
      const definition = surfaceDefinitions.find((row) => row.key === field.key);
      return definition === undefined
        ? field.key
        : localizedName(definition.label, definition.labelAr, locale);
    }
    const native = nativeByKey.get(field.key);
    return native === undefined ? field.key : localizedName(native.label, native.labelAr, locale);
  }

  /** Seed = every native field (canonical order) + the ACTIVE custom fields. */
  function registrySeed(
    surface: readonly CustomFieldDefinitionRow[],
    info: CustomFieldEntityInfo | null,
  ): SectionDraft[] {
    const enD = getDictionary("en");
    const arD = getDictionary("ar");
    return [
      {
        key: "main",
        label: enD.customFieldsLayoutSectionNew,
        labelAr: arD.customFieldsLayoutSectionNew,
        collapsed: false,
        columns: 2,
        fields: [
          ...(info?.nativeFields ?? []).map((field) => ({ key: field.key, custom: false })),
          ...surface.map((definition) => ({ key: definition.key, custom: true })),
        ],
      },
    ];
  }

  function cloneSections(source: FormLayoutRow["sections"]): SectionDraft[] {
    return source.map((section) => ({
      key: section.key,
      label: section.label,
      labelAr: section.labelAr,
      collapsed: section.collapsed,
      columns: section.columns,
      fields: section.fields.map((field) => ({ key: field.key, custom: field.custom })),
    }));
  }

  async function loadLayouts(
    entityType: string,
  ): Promise<{ rows: readonly FormLayoutRow[]; surface: readonly CustomFieldDefinitionRow[] } | null> {
    if (entityType === "") {
      return null;
    }
    setLayoutsLoading(true);
    setLayoutError(null);
    const [layoutResult, surfaceResult] = await Promise.all([
      bffFetch<readonly FormLayoutRow[]>(
        `configuration/form-layouts?entityType=${encodeURIComponent(entityType)}`,
      ),
      bffFetch<readonly CustomFieldDefinitionRow[]>(
        `configuration/custom-fields/surface?entityType=${encodeURIComponent(entityType)}`,
      ),
    ]);
    setLayoutsLoading(false);
    if (!layoutResult.ok) {
      setLayoutError(
        localizedCustomFieldsError(d, layoutResult.error, layoutResult.retryAfterSeconds),
      );
      return null;
    }
    const surface = surfaceResult.ok ? surfaceResult.data : [];
    setLayouts(layoutResult.data);
    setSurfaceDefinitions(surface);
    selectLayoutEditor("__default", layoutResult.data, surface);
    return { rows: layoutResult.data, surface };
  }

  useEffect(() => {
    if (tab !== "layouts" || layoutEntity === "") {
      return;
    }
    void loadLayouts(layoutEntity);
  }, [tab, layoutEntity]);

  const defaultLayout = useMemo(
    () => layouts.find((row) => row.roleKey === null) ?? null,
    [layouts],
  );
  const overrideRoles = useMemo(
    () => layouts.filter((row) => row.roleKey !== null).map((row) => row.roleKey as string),
    [layouts],
  );
  const availableNewRoles = ROLE_KEYS.filter((role) => !overrideRoles.includes(role));

  function selectLayoutEditor(
    role: string,
    rows?: readonly FormLayoutRow[],
    surface?: readonly CustomFieldDefinitionRow[],
  ): void {
    const layoutRows = rows ?? layouts;
    const surfaceRows = surface ?? surfaceDefinitions;
    setEditingRole(role);
    setAddFieldChoice({});
    if (role === "__new") {
      setNewRole(availableNewRoles[0] ?? "");
      const fallback = layoutRows.find((row) => row.roleKey === null);
      setLayoutName(fallback?.name ?? "");
      setSections(
        fallback === undefined
          ? registrySeed(surfaceRows, entityInfo)
          : cloneSections(fallback.sections),
      );
      return;
    }
    if (role === "__default") {
      const fallback = layoutRows.find((row) => row.roleKey === null);
      if (fallback === undefined) {
        setLayoutName("");
        setSections(registrySeed(surfaceRows, entityInfo));
      } else {
        setLayoutName(fallback.name);
        setSections(cloneSections(fallback.sections));
      }
      return;
    }
    const target = layoutRows.find((row) => row.roleKey === role);
    if (target !== undefined) {
      setLayoutName(target.name);
      setSections(cloneSections(target.sections));
    } else {
      setLayoutName("");
      setSections(registrySeed(surfaceRows, entityInfo));
    }
  }

  // -- designer section/field mutations (pure state) -------------------------------

  function updateSection(index: number, patch: Partial<SectionDraft>): void {
    setSections((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  function addSection(): void {
    setSections((rows) => [
      ...rows,
      {
        key: `section_${Date.now().toString(36)}`,
        label: getDictionary("en").customFieldsLayoutSectionNew,
        labelAr: getDictionary("ar").customFieldsLayoutSectionNew,
        collapsed: false,
        columns: 2,
        fields: [],
      },
    ]);
  }

  function moveSection(index: number, direction: -1 | 1): void {
    setSections((rows) => {
      const next = [...rows];
      const target = index + direction;
      if (target < 0 || target >= next.length) {
        return rows;
      }
      const current = next[index];
      const neighbor = next[target];
      if (current === undefined || neighbor === undefined) {
        return rows;
      }
      next[index] = neighbor;
      next[target] = current;
      return next;
    });
  }

  function removeSection(index: number): void {
    setSections((rows) => rows.filter((_, i) => i !== index));
  }

  function addFieldToSection(sectionIndex: number, choice: string): void {
    if (choice === "") {
      return;
    }
    const custom = choice.startsWith("c:");
    const key = choice.slice(2);
    setSections((rows) =>
      rows.map((row, i) =>
        i === sectionIndex
          ? { ...row, fields: [...row.fields, { key, custom }] }
          : row,
      ),
    );
    setAddFieldChoice((current) => ({ ...current, [sections[sectionIndex]?.key ?? ""]: "" }));
  }

  function moveFieldInSection(sectionIndex: number, fieldIndex: number, direction: -1 | 1): void {
    setSections((rows) =>
      rows.map((row, i) => {
        if (i !== sectionIndex) {
          return row;
        }
        const fields = [...row.fields];
        const target = fieldIndex + direction;
        if (target < 0 || target >= fields.length) {
          return row;
        }
        const current = fields[fieldIndex];
        const neighbor = fields[target];
        if (current === undefined || neighbor === undefined) {
          return row;
        }
        fields[fieldIndex] = neighbor;
        fields[target] = current;
        return { ...row, fields };
      }),
    );
  }

  function removeFieldInSection(sectionIndex: number, fieldIndex: number): void {
    setSections((rows) =>
      rows.map((row, i) =>
        i === sectionIndex ? { ...row, fields: row.fields.filter((_, j) => j !== fieldIndex) } : row,
      ),
    );
  }

  async function saveLayout(): Promise<void> {
    const isOverride = editingRole !== "__default";
    const roleKey = editingRole === "__new" ? newRole : editingRole;
    if (
      layoutEntity === "" ||
      layoutName.trim() === "" ||
      sections.length === 0 ||
      (isOverride && roleKey === "")
    ) {
      setLayoutError(d.errorsValidation);
      return;
    }
    const body = {
      name: layoutName.trim(),
      sections: sections.map((section) => ({
        key: section.key,
        label: section.label.trim() === "" ? section.key : section.label.trim(),
        labelAr: section.labelAr.trim() === "" ? section.key : section.labelAr.trim(),
        collapsed: section.collapsed,
        columns: section.columns,
        fields: section.fields,
      })),
    };
    setBusy("layout-save");
    setLayoutError(null);
    setNotice(null);
    const path = isOverride
      ? `configuration/form-layouts/${layoutEntity}/roles/${roleKey}`
      : `configuration/form-layouts/${layoutEntity}`;
    const saved = await bffFetch<FormLayoutRow>(path, { method: "PUT", body });
    setBusy(null);
    if (!saved.ok) {
      setLayoutError(localizedCustomFieldsError(d, saved.error, saved.retryAfterSeconds));
      return;
    }
    setNotice(
      isOverride ? d.customFieldsLayoutOverrideSavedToast : d.customFieldsLayoutSavedToast,
    );
    const reloaded = await loadLayouts(layoutEntity);
    if (reloaded !== null && isOverride) {
      selectLayoutEditor(roleKey, reloaded.rows, reloaded.surface);
    }
    router.refresh();
  }

  async function deleteOverride(roleKey: string): Promise<void> {
    if (layoutEntity === "") {
      return;
    }
    setBusy(`layout-delete-${roleKey}`);
    setLayoutError(null);
    setNotice(null);
    const deleted = await bffFetch<unknown>(
      `configuration/form-layouts/${layoutEntity}/roles/${roleKey}`,
      { method: "DELETE" },
    );
    setBusy(null);
    if (!deleted.ok) {
      setLayoutError(localizedCustomFieldsError(d, deleted.error, deleted.retryAfterSeconds));
      return;
    }
    setNotice(d.customFieldsLayoutOverrideDeletedToast);
    await loadLayouts(layoutEntity);
    router.refresh();
  }

  // -- the add-field grouped options (not-yet-placed native + custom fields) --------

  function fieldChoicesForSection(section: SectionDraft):
    Array<{ group: string; options: Array<{ value: string; label: string }> }> {
    const placed = new Set(section.fields.map((field) => `${field.custom ? "c" : "n"}:${field.key}`));
    const nativeOptions = (entityInfo?.nativeFields ?? [])
      .filter((field) => !placed.has(`n:${field.key}`))
      .map((field) => ({
        value: `n:${field.key}`,
        label: `${localizedName(field.label, field.labelAr, locale)}${field.mandatory ? ` · ${d.customFieldsLayoutMandatoryBadge}` : ""}`,
      }));
    const customOptions = surfaceDefinitions
      .filter((definition) => !placed.has(`c:${definition.key}`))
      .map((definition) => ({
        value: `c:${definition.key}`,
        label: localizedName(definition.label, definition.labelAr, locale),
      }));
    const groups: Array<{ group: string; options: Array<{ value: string; label: string }> }> = [];
    if (nativeOptions.length > 0) {
      groups.push({ group: d.customFieldsNativeFieldsGroup, options: nativeOptions });
    }
    if (customOptions.length > 0) {
      groups.push({ group: d.customFieldsCustomFieldsGroup, options: customOptions });
    }
    return groups;
  }

  // -- render ---------------------------------------------------------------------------

  const definitionDialogBody = (draft: DefinitionDraft, setDraft: (next: DefinitionDraft) => void, isEdit: boolean): JSX.Element => (
    <div className="flex flex-col gap-4">
      {isEdit && (
        <DefList
          items={[
            {
              term: d.customFieldsEntityLabel,
              children: entityLabel(draft.entityType),
            },
            {
              term: d.customFieldsKeyLabel,
              children: (
                <span className="font-mono text-sm" dir="ltr">
                  {draft.key}
                </span>
              ),
            },
            {
              term: d.customFieldsDataTypeLabel,
              children: <Badge tone="primary">{localizedCustomFieldDataType(d, draft.dataType)}</Badge>,
            },
          ]}
        />
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        {!isEdit && (
          <Select
            label={d.customFieldsEntityLabel}
            value={draft.entityType}
            onValueChange={(value) => setDraft({ ...draft, entityType: value })}
            placeholder={d.customFieldsEntityPlaceholder}
            options={entityOptions}
            required
          />
        )}
        {!isEdit && (
          <Input
            label={d.customFieldsKeyLabel}
            hint={d.customFieldsKeyHint}
            value={draft.key}
            onValueChange={(value) => setDraft({ ...draft, key: value })}
            error={
              draft.key !== "" && !KEY_RE.test(draft.key.trim())
                ? formatMessage(d.customFieldsErrorKeyInvalid, { reason: d.customFieldsKeyHint })
                : undefined
            }
            mono
            bidiIsolate
            required
          />
        )}
        <Input
          label={d.customFieldsLabelEn}
          value={draft.label}
          onValueChange={(value) => setDraft({ ...draft, label: value })}
          required
        />
        <Input
          label={d.customFieldsLabelAr}
          value={draft.labelAr}
          onValueChange={(value) => setDraft({ ...draft, labelAr: value })}
          required
        />
        {!isEdit && (
          <Select
            label={d.customFieldsDataTypeLabel}
            value={draft.dataType}
            onValueChange={(value) =>
              setDraft({ ...draft, dataType: value as CustomFieldDataType })
            }
            options={DATA_TYPES.map((value) => ({
              value,
              label: localizedCustomFieldDataType(d, value),
            }))}
            required
          />
        )}
        {(draft.dataType === "SELECT" || draft.dataType === "MULTISELECT") && (
          <Select
            label={d.customFieldsPicklistLabel}
            value={draft.picklistId}
            onValueChange={(value) => setDraft({ ...draft, picklistId: value })}
            placeholder={d.customFieldsPicklistPlaceholder}
            options={picklists
              .filter((row) => row.status === "ACTIVE")
              .map((row) => ({
                value: row.id,
                label: localizedName(row.name, row.nameAr, locale),
              }))}
            required
          />
        )}
        {draft.dataType === "REFERENCE" && (
          <Select
            label={d.customFieldsReferenceEntityLabel}
            value={draft.referenceEntity}
            onValueChange={(value) => setDraft({ ...draft, referenceEntity: value })}
            placeholder={d.customFieldsEntityPlaceholder}
            options={entityOptions}
            required
          />
        )}
        {draft.dataType === "NUMBER" && (
          <NumberInput
            label={d.customFieldsPrecisionLabel}
            hint={d.customFieldsPrecisionHint}
            value={draft.precision}
            onValueChange={(value) => setDraft({ ...draft, precision: value })}
            min={0}
            max={6}
          />
        )}
      </div>
      <fieldset className="flex flex-col gap-3 rounded-md border border-subtle p-3">
        <legend className="px-1 text-sm font-semibold text-gray-900">
          {d.customFieldsValidationTitle}
        </legend>
        <Checkbox
          label={d.customFieldsRequiredLabel}
          checked={draft.required}
          onCheckedChange={(checked) => setDraft({ ...draft, required: checked === true })}
        />
        {draft.dataType === "TEXT" && (
          <>
            <p className="text-xs text-gray-600">{d.customFieldsValidationTextOnly}</p>
            <div className="grid gap-3 sm:grid-cols-3">
              <Input
                label={d.customFieldsRegexLabel}
                value={draft.validationRegex}
                onValueChange={(value) => setDraft({ ...draft, validationRegex: value })}
                mono
                bidiIsolate
              />
              <NumberInput
                label={d.customFieldsMinLengthLabel}
                value={draft.minLength}
                onValueChange={(value) => setDraft({ ...draft, minLength: value })}
                min={0}
              />
              <NumberInput
                label={d.customFieldsMaxLengthLabel}
                value={draft.maxLength}
                onValueChange={(value) => setDraft({ ...draft, maxLength: value })}
                min={0}
              />
            </div>
          </>
        )}
        {draft.dataType === "NUMBER" && (
          <>
            <p className="text-xs text-gray-600">{d.customFieldsValidationNumberOnly}</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <NumberInput
                label={d.customFieldsMinValueLabel}
                value={draft.minValue}
                onValueChange={(value) => setDraft({ ...draft, minValue: value })}
                allowNegative
              />
              <NumberInput
                label={d.customFieldsMaxValueLabel}
                value={draft.maxValue}
                onValueChange={(value) => setDraft({ ...draft, maxValue: value })}
                allowNegative
              />
            </div>
          </>
        )}
      </fieldset>
    </div>
  );

  const sortedOptions = useMemo(
    () => [...(optionsDetail?.options ?? [])].sort((a, b) => a.sortOrder - b.sortOrder),
    [optionsDetail],
  );
  const activeOptionIds = useMemo(
    () => sortedOptions.filter((option) => option.status === "ACTIVE").map((option) => option.id),
    [sortedOptions],
  );

  const editingRoleLabel =
    editingRole === "__default"
      ? d.customFieldsLayoutDefaultLabel
      : editingRole === "__new"
        ? d.customFieldsLayoutNewOverride
        : `${d.customFieldsLayoutOverrideBadge} · ${localizedCustomFieldRole(d, editingRole)}`;

  return (
    <div className="flex flex-col gap-4">
      {error !== null && <ErrorNotice>{error}</ErrorNotice>}
      {notice !== null && <SuccessNotice>{notice}</SuccessNotice>}

      <Tabs
        items={[
          { value: "definitions", label: d.customFieldsDefinitionsTab },
          { value: "picklists", label: d.customFieldsPicklistsTab },
          { value: "layouts", label: d.customFieldsLayoutsTab },
        ]}
        value={tab}
        onValueChange={(value) => setTab(value as ManagerTab)}
      >
        {tab === "definitions" && (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-end gap-3">
              <div className="w-56">
                <Select
                  label={d.customFieldsEntityFilter}
                  value={entityFilter}
                  onValueChange={setEntityFilter}
                  options={[
                    { value: "", label: d.customFieldsAllEntities },
                    ...entityOptions,
                  ]}
                />
              </div>
              {canManage && (
                <Button variant="primary" onClick={openCreate}>
                  {d.customFieldsAddField}
                </Button>
              )}
            </div>
            <Card
              title={d.customFieldsDefinitionsTab}
              description={d.customFieldsDefinitionsNote}
            >
              <DataTable
                columns={[
                  {
                    id: "entity",
                    header: activeLocaleHeader(d.customFieldsColEntity),
                    accessor: (row) => row.entityType,
                    sortable: true,
                    render: (row) => entityLabel(row.entityType),
                  },
                  {
                    id: "key",
                    header: activeLocaleHeader(d.customFieldsColKey),
                    accessor: (row) => row.key,
                    mono: true,
                    sortable: true,
                    render: (row) => (
                      <span className="font-mono text-sm" dir="ltr">
                        {row.key}
                      </span>
                    ),
                  },
                  {
                    id: "label",
                    header: activeLocaleHeader(d.customFieldsColLabel),
                    accessor: (row) => localizedName(row.label, row.labelAr, locale),
                    render: (row) => localizedName(row.label, row.labelAr, locale),
                  },
                  {
                    id: "dataType",
                    header: activeLocaleHeader(d.customFieldsColDataType),
                    accessor: (row) => row.dataType,
                    render: (row) => (
                      <Badge tone="primary">
                        {localizedCustomFieldDataType(d, row.dataType)}
                      </Badge>
                    ),
                  },
                  {
                    id: "required",
                    header: activeLocaleHeader(d.customFieldsColRequired),
                    accessor: (row) => (row.required ? "1" : "0"),
                    render: (row) =>
                      row.required ? (
                        <Badge tone="neutral">{d.customFieldsRequiredLabel}</Badge>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      ),
                  },
                  {
                    id: "version",
                    header: activeLocaleHeader(d.customFieldsColVersion),
                    accessor: (row) => String(row.version),
                    numeric: true,
                    sortable: true,
                    render: (row) => (
                      <span className="font-mono tabular-nums" dir="ltr">
                        {row.version}
                      </span>
                    ),
                  },
                  {
                    id: "status",
                    header: activeLocaleHeader(d.colStatus),
                    accessor: (row) => row.status,
                    render: (row) =>
                      row.status === "ACTIVE" ? (
                        <Badge tone="primary">{d.statusActive}</Badge>
                      ) : (
                        <Badge tone="neutral">{d.statusArchived}</Badge>
                      ),
                  },
                ]}
                rows={[...filteredDefinitions]}
                rowKey={(row) => row.id}
                rowActions={[
                  ...(canManage
                    ? [
                        {
                          id: "edit",
                          label: d.commonEdit,
                          onSelect: (row: CustomFieldDefinitionRow) => openEdit(row),
                        },
                        {
                          id: "archive",
                          label: d.customFieldsArchiveAction,
                          danger: true,
                          onSelect: (row: CustomFieldDefinitionRow) => {
                            if (row.status !== "ACTIVE") return;
                            setArchiveId(row.id);
                          },
                        },
                        {
                          id: "restore",
                          label: d.customFieldsRestoreAction,
                          onSelect: (row: CustomFieldDefinitionRow) => {
                            if (row.status === "ACTIVE") return;
                            void restoreDefinition(row.id);
                          },
                        },
                      ]
                    : []),
                ]}
                empty={{ title: d.customFieldsEmpty }}
              />
            </Card>
          </div>
        )}

        {tab === "picklists" && (
          <div className="flex flex-col gap-4">
            <Card
              title={d.customFieldsPicklistsTab}
              description={d.customFieldsPicklistsNote}
            >
              <DataTable
                columns={[
                  {
                    id: "key",
                    header: activeLocaleHeader(d.customFieldsColKey),
                    accessor: (row) => row.key,
                    mono: true,
                    sortable: true,
                    render: (row) => (
                      <span className="font-mono text-sm" dir="ltr">
                        {row.key}
                      </span>
                    ),
                  },
                  {
                    id: "name",
                    header: activeLocaleHeader(d.colName),
                    accessor: (row) => localizedName(row.name, row.nameAr, locale),
                    render: (row) => localizedName(row.name, row.nameAr, locale),
                  },
                  {
                    id: "optionCount",
                    header: activeLocaleHeader(d.customFieldsColOptions),
                    accessor: (row) => String(row.optionCount),
                    numeric: true,
                    sortable: true,
                    render: (row) => (
                      <span className="font-mono tabular-nums" dir="ltr">
                        {row.optionCount}
                      </span>
                    ),
                  },
                  {
                    id: "version",
                    header: activeLocaleHeader(d.customFieldsColVersion),
                    accessor: (row) => String(row.version),
                    numeric: true,
                    render: (row) => (
                      <span className="font-mono tabular-nums" dir="ltr">
                        {row.version}
                      </span>
                    ),
                  },
                  {
                    id: "status",
                    header: activeLocaleHeader(d.colStatus),
                    accessor: (row) => row.status,
                    render: (row) =>
                      row.status === "ACTIVE" ? (
                        <Badge tone="primary">{d.statusActive}</Badge>
                      ) : (
                        <Badge tone="neutral">{d.statusArchived}</Badge>
                      ),
                  },
                ]}
                rows={[...picklists]}
                rowKey={(row) => row.id}
                rowActions={[
                  {
                    id: "options",
                    label: d.customFieldsManageOptions,
                    onSelect: (row) => openOptions(row),
                  },
                  ...(canManage
                    ? [
                        {
                          id: "rename",
                          label: d.commonEdit,
                          onSelect: (row: CustomPicklistRow) => {
                            setRenameTarget(row);
                            setRenameDraft({ name: row.name, nameAr: row.nameAr });
                          },
                        },
                        {
                          id: "archive",
                          label: d.customFieldsArchiveAction,
                          danger: true,
                          onSelect: (row: CustomPicklistRow) => {
                            if (row.status !== "ACTIVE") return;
                            void setPicklistStatus(row.id, "ARCHIVED");
                          },
                        },
                        {
                          id: "restore",
                          label: d.customFieldsRestoreAction,
                          onSelect: (row: CustomPicklistRow) => {
                            if (row.status === "ACTIVE") return;
                            void setPicklistStatus(row.id, "ACTIVE");
                          },
                        },
                      ]
                    : []),
                ]}
                empty={{ title: d.customFieldsPicklistsEmpty }}
              />
            </Card>

            {canManage && (
              <Card title={d.customFieldsPicklistCreateTitle}>
                <div className="grid gap-3 sm:grid-cols-3">
                  <Input
                    label={d.customFieldsColKey}
                    hint={d.customFieldsPicklistKeyHint}
                    value={picklistDraft.key}
                    onValueChange={(value) => setPicklistDraft({ ...picklistDraft, key: value })}
                    mono
                    bidiIsolate
                    required
                  />
                  <Input
                    label={d.customFieldsPicklistNameEn}
                    value={picklistDraft.name}
                    onValueChange={(value) => setPicklistDraft({ ...picklistDraft, name: value })}
                    required
                  />
                  <Input
                    label={d.customFieldsPicklistNameAr}
                    value={picklistDraft.nameAr}
                    onValueChange={(value) => setPicklistDraft({ ...picklistDraft, nameAr: value })}
                    required
                  />
                </div>
                <Button
                  variant="primary"
                  className="mt-3 self-start"
                  loading={busy === "picklist-create"}
                  disabled={
                    !KEY_RE.test(picklistDraft.key.trim()) ||
                    picklistDraft.name.trim() === "" ||
                    picklistDraft.nameAr.trim() === ""
                  }
                  onClick={() => void createPicklist()}
                >
                  {d.commonCreate}
                </Button>
              </Card>
            )}

            {optionsTarget !== null && (
              <Card
                title={formatMessage(d.customFieldsPicklistOptionsForTitle, {
                  name: localizedName(optionsTarget.name, optionsTarget.nameAr, locale),
                })}
                actions={
                  <Button variant="ghost" onClick={() => setOptionsTargetId(null)}>
                    {d.commonCancel}
                  </Button>
                }
              >
                {optionsBusy && optionsDetail === null ? (
                  <p className="text-sm text-gray-600">{d.loading}</p>
                ) : (
                  <div className="flex flex-col gap-3">
                    {sortedOptions.length === 0 && (
                      <p className="text-sm text-gray-600">{d.customFieldsOptionsEmpty}</p>
                    )}
                    {sortedOptions.map((option) => {
                      const activeIndex = activeOptionIds.indexOf(option.id);
                      return (
                        <div
                          key={option.id}
                          className="flex flex-wrap items-center gap-2 rounded-md border border-subtle px-3 py-2"
                        >
                          <span className="min-w-0 flex-1">
                            <span lang="en" dir="ltr" className="block truncate text-sm">
                              {option.label}
                            </span>
                            <span lang="ar" dir="rtl" className="block truncate text-xs text-gray-600">
                              {option.labelAr}
                            </span>
                          </span>
                          <span className="font-mono tabular-nums text-xs" dir="ltr">
                            #{option.sortOrder}
                          </span>
                          {option.status === "ACTIVE" ? (
                            <Badge tone="primary">{d.statusActive}</Badge>
                          ) : (
                            <Badge tone="neutral">{d.statusArchived}</Badge>
                          )}
                          <IconButton
                            icon="chevron-up"
                            label={d.customFieldsOptionMoveUp}
                            size="sm"
                            disabled={
                              option.status !== "ACTIVE" || activeIndex <= 0 || busy !== null
                            }
                            onClick={() => void moveOption(option.id, -1)}
                          />
                          <IconButton
                            icon="chevron-down"
                            label={d.customFieldsOptionMoveDown}
                            size="sm"
                            disabled={
                              option.status !== "ACTIVE" ||
                              activeIndex === -1 ||
                              activeIndex >= activeOptionIds.length - 1 ||
                              busy !== null
                            }
                            onClick={() => void moveOption(option.id, 1)}
                          />
                          {canManage && (
                            <>
                              <IconButton
                                icon="pencil"
                                label={d.customFieldsOptionEdit}
                                size="sm"
                                disabled={busy !== null}
                                onClick={() => {
                                  setOptionEditTarget(option);
                                  setOptionEditDraft({
                                    label: option.label,
                                    labelAr: option.labelAr,
                                    sortOrder: String(option.sortOrder),
                                  });
                                }}
                              />
                              {option.status === "ACTIVE" ? (
                                <IconButton
                                  icon="trash"
                                  label={d.customFieldsArchiveAction}
                                  size="sm"
                                  disabled={busy !== null}
                                  onClick={() => void setOptionStatus(option.id, "ARCHIVED")}
                                />
                              ) : (
                                <IconButton
                                  icon="undo-2"
                                  label={d.customFieldsRestoreAction}
                                  size="sm"
                                  disabled={busy !== null}
                                  onClick={() => void setOptionStatus(option.id, "ACTIVE")}
                                />
                              )}
                            </>
                          )}
                        </div>
                      );
                    })}
                    {canManage && (
                      <div className="flex flex-wrap items-end gap-3 border-t border-subtle pt-3">
                        <div className="w-56">
                          <Input
                            label={d.customFieldsOptionLabelEn}
                            value={optionDraft.label}
                            onValueChange={(value) =>
                              setOptionDraft({ ...optionDraft, label: value })
                            }
                            required
                          />
                        </div>
                        <div className="w-56">
                          <Input
                            label={d.customFieldsOptionLabelAr}
                            value={optionDraft.labelAr}
                            onValueChange={(value) =>
                              setOptionDraft({ ...optionDraft, labelAr: value })
                            }
                            required
                          />
                        </div>
                        <Button
                          variant="secondary"
                          loading={busy === "option-add"}
                          disabled={
                            optionDraft.label.trim() === "" || optionDraft.labelAr.trim() === ""
                          }
                          onClick={() => void addOption()}
                        >
                          {d.customFieldsOptionAdd}
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </Card>
            )}
          </div>
        )}

        {tab === "layouts" && (
          <div className="flex flex-col gap-4">
            <Card
              title={d.customFieldsLayoutsTab}
              description={d.customFieldsLayoutsNote}
            >
              <div className="flex flex-col gap-3">
                <div className="flex flex-wrap items-end gap-3">
                  <div className="w-56">
                    <Select
                      label={d.customFieldsLayoutEntityLabel}
                      value={layoutEntity}
                      onValueChange={setLayoutEntity}
                      placeholder={d.customFieldsEntityPlaceholder}
                      options={entityOptions}
                    />
                  </div>
                  <div className="w-64">
                    <Select
                      label={d.customFieldsLayoutRoleLabel}
                      value={editingRole}
                      onValueChange={(value) => selectLayoutEditor(value)}
                      options={[
                        { value: "__default", label: d.customFieldsLayoutDefaultLabel },
                        ...overrideRoles.map((role) => ({
                          value: role,
                          label: `${d.customFieldsLayoutOverrideBadge} · ${localizedCustomFieldRole(d, role)}`,
                        })),
                        ...(canManageLayouts && availableNewRoles.length > 0
                          ? [{ value: "__new", label: d.customFieldsLayoutNewOverride }]
                          : []),
                      ]}
                    />
                  </div>
                  {editingRole === "__new" && (
                    <div className="w-56">
                      <Select
                        label={d.customFieldsLayoutRoleLabel}
                        value={newRole}
                        onValueChange={setNewRole}
                        options={availableNewRoles.map((role) => ({
                          value: role,
                          label: localizedCustomFieldRole(d, role),
                        }))}
                        required
                      />
                    </div>
                  )}
                  {canManageLayouts &&
                    editingRole !== "__default" &&
                    editingRole !== "__new" && (
                      <Button
                        variant="danger"
                        loading={busy === `layout-delete-${editingRole}`}
                        disabled={busy !== null}
                        onClick={() => void deleteOverride(editingRole)}
                      >
                        {d.customFieldsLayoutDeleteOverride}
                      </Button>
                    )}
                </div>

                {editingRole === "__default" ? (
                  <InfoNotice>{d.customFieldsLayoutDefaultNote}</InfoNotice>
                ) : (
                  <InfoNotice>{d.customFieldsLayoutOverrideNote}</InfoNotice>
                )}
                <InfoNotice>{d.customFieldsLayoutLockHint}</InfoNotice>

                {layoutsLoading && <p className="text-sm text-gray-600">{d.loading}</p>}
                {layoutError !== null && <ErrorNotice>{layoutError}</ErrorNotice>}
                {!layoutsLoading && defaultLayout === null && editingRole === "__default" && (
                  <p className="text-sm text-gray-600">{d.customFieldsLayoutsEmpty}</p>
                )}

                {!layoutsLoading && (
                  <div className="flex flex-col gap-4">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Input
                        label={d.customFieldsLayoutNameLabel}
                        value={layoutName}
                        onValueChange={setLayoutName}
                        required
                      />
                      <div className="flex items-end gap-2 text-sm text-gray-700">
                        <Badge tone="neutral">{editingRoleLabel}</Badge>
                        <span className="font-mono text-xs" dir="ltr">
                          {layoutEntity}
                        </span>
                      </div>
                    </div>

                    <div className="flex flex-col gap-3">
                      {sections.map((section, sectionIndex) => {
                        const sectionHasMandatory = section.fields.some((field) =>
                          isMandatoryNative(field),
                        );
                        const choices = fieldChoicesForSection(section);
                        return (
                          <div
                            key={section.key}
                            className="flex flex-col gap-3 rounded-md border border-subtle p-3"
                          >
                            <div className="grid gap-3 sm:grid-cols-2">
                              <Input
                                label={d.customFieldsLayoutSectionLabelEn}
                                value={section.label}
                                onValueChange={(value) =>
                                  updateSection(sectionIndex, { label: value })
                                }
                              />
                              <Input
                                label={d.customFieldsLayoutSectionLabelAr}
                                value={section.labelAr}
                                onValueChange={(value) =>
                                  updateSection(sectionIndex, { labelAr: value })
                                }
                              />
                              <Select
                                label={d.customFieldsLayoutColumnsLabel}
                                value={String(section.columns)}
                                onValueChange={(value) =>
                                  updateSection(sectionIndex, { columns: Number(value) })
                                }
                                options={[1, 2, 3].map((count) => ({
                                  value: String(count),
                                  label: String(count),
                                }))}
                              />
                              <Checkbox
                                label={d.customFieldsLayoutCollapsedLabel}
                                checked={section.collapsed}
                                onCheckedChange={(checked) =>
                                  updateSection(sectionIndex, { collapsed: checked === true })
                                }
                              />
                            </div>
                            <div className="flex flex-col gap-2">
                              {section.fields.map((field, fieldIndex) => {
                                const mandatory = isMandatoryNative(field);
                                return (
                                  <div
                                    key={`${field.key}-${fieldIndex}`}
                                    className="flex flex-wrap items-center gap-2 rounded-sm border border-subtle bg-surface-sunken px-2 py-1.5"
                                  >
                                    <Badge tone="neutral">
                                      {field.custom
                                        ? d.customFieldsLayoutFieldCustom
                                        : d.customFieldsLayoutFieldNative}
                                    </Badge>
                                    <span className="min-w-0 flex-1 truncate text-sm">
                                      {designerFieldLabel(field)}
                                    </span>
                                    <span className="font-mono text-xs text-gray-600" dir="ltr">
                                      {field.key}
                                    </span>
                                    {mandatory && (
                                      <Badge tone="primary">
                                        {d.customFieldsLayoutMandatoryBadge}
                                      </Badge>
                                    )}
                                    <IconButton
                                      icon="chevron-up"
                                      label={d.customFieldsLayoutFieldUp}
                                      size="sm"
                                      disabled={mandatory || fieldIndex === 0}
                                      onClick={() =>
                                        moveFieldInSection(sectionIndex, fieldIndex, -1)
                                      }
                                    />
                                    <IconButton
                                      icon="chevron-down"
                                      label={d.customFieldsLayoutFieldDown}
                                      size="sm"
                                      disabled={mandatory || fieldIndex === section.fields.length - 1}
                                      onClick={() =>
                                        moveFieldInSection(sectionIndex, fieldIndex, 1)
                                      }
                                    />
                                    {canManageLayouts && (
                                      <IconButton
                                        icon="x"
                                        label={d.customFieldsLayoutRemoveField}
                                        size="sm"
                                        disabled={mandatory}
                                        onClick={() =>
                                          removeFieldInSection(sectionIndex, fieldIndex)
                                        }
                                      />
                                    )}
                                  </div>
                                );
                              })}
                              {section.fields.length === 0 && (
                                <p className="text-xs text-gray-600">
                                  {d.customFieldsLayoutFieldsTitle}
                                </p>
                              )}
                            </div>
                            {canManageLayouts && (
                              <div className="flex flex-wrap items-end gap-3">
                                <div className="w-64">
                                  <Select
                                    label={d.customFieldsLayoutAddField}
                                    value={addFieldChoice[section.key] ?? ""}
                                    onValueChange={(value) =>
                                      setAddFieldChoice((current) => ({
                                        ...current,
                                        [section.key]: value,
                                      }))
                                    }
                                    placeholder={d.customFieldsLayoutFieldPlaceholder}
                                    options={choices}
                                  />
                                </div>
                                <Button
                                  variant="secondary"
                                  disabled={(addFieldChoice[section.key] ?? "") === ""}
                                  onClick={() =>
                                    addFieldToSection(
                                      sectionIndex,
                                      addFieldChoice[section.key] ?? "",
                                    )
                                  }
                                >
                                  {d.customFieldsAddField}
                                </Button>
                              </div>
                            )}
                            {canManageLayouts && (
                              <div className="flex flex-wrap items-center gap-2">
                                <IconButton
                                  icon="chevron-up"
                                  label={d.customFieldsLayoutSectionUp}
                                  size="sm"
                                  disabled={sectionIndex === 0}
                                  onClick={() => moveSection(sectionIndex, -1)}
                                />
                                <IconButton
                                  icon="chevron-down"
                                  label={d.customFieldsLayoutSectionDown}
                                  size="sm"
                                  disabled={sectionIndex === sections.length - 1}
                                  onClick={() => moveSection(sectionIndex, 1)}
                                />
                                <IconButton
                                  icon="trash"
                                  label={d.customFieldsLayoutRemoveSection}
                                  size="sm"
                                  disabled={sectionHasMandatory}
                                  onClick={() => removeSection(sectionIndex)}
                                />
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    {canManageLayouts && (
                      <div className="flex flex-wrap items-center gap-2">
                        <Button variant="secondary" onClick={addSection}>
                          {d.customFieldsLayoutAddSection}
                        </Button>
                        <Button
                          variant="primary"
                          loading={busy === "layout-save"}
                          disabled={layoutName.trim() === "" || sections.length === 0}
                          onClick={() => void saveLayout()}
                        >
                          {d.commonSave}
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </Card>
          </div>
        )}
      </Tabs>

      {/* -- definitions: create dialog ------------------------------------------ */}
      <Dialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        title={d.customFieldsCreateTitle}
        size="lg"
      >
        {definitionDialogBody(createDraft, setCreateDraft, false)}
        <p className="mt-3 text-xs text-gray-600">{d.customFieldsImmutableNote}</p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setCreateOpen(false)}>
            {d.commonCancel}
          </Button>
          <Button
            variant="primary"
            loading={busy === "definition-create"}
            disabled={!definitionDraftReady(createDraft)}
            onClick={() => void createDefinition()}
          >
            {d.commonCreate}
          </Button>
        </div>
      </Dialog>

      {/* -- definitions: edit dialog ---------------------------------------------- */}
      <Dialog
        open={editTarget !== null}
        onOpenChange={(open) => {
          if (!open) setEditTarget(null);
        }}
        title={d.customFieldsEditTitle}
        size="lg"
      >
        {definitionDialogBody(editDraft, setEditDraft, true)}
        <p className="mt-3 text-xs text-gray-600">{d.customFieldsImmutableNote}</p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setEditTarget(null)}>
            {d.commonCancel}
          </Button>
          <Button
            variant="primary"
            loading={busy === "definition-edit"}
            disabled={
              editDraft.label.trim() === "" ||
              editDraft.labelAr.trim() === "" ||
              ((editDraft.dataType === "SELECT" || editDraft.dataType === "MULTISELECT") &&
                editDraft.picklistId === "") ||
              (editDraft.dataType === "REFERENCE" && editDraft.referenceEntity === "")
            }
            onClick={() => void saveEdit()}
          >
            {d.commonSave}
          </Button>
        </div>
      </Dialog>

      {/* -- definitions: archive confirm ------------------------------------------ */}
      <Dialog
        open={archiveTarget !== null}
        onOpenChange={(open) => {
          if (!open) setArchiveId(null);
        }}
        title={d.customFieldsArchiveAction}
        description={d.customFieldsArchiveConfirm}
      >
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setArchiveId(null)}>
            {d.commonCancel}
          </Button>
          <Button
            variant="danger"
            loading={busy === `definition-archive-${archiveId ?? ""}`}
            onClick={() => void archiveDefinition()}
          >
            {d.customFieldsArchiveAction}
          </Button>
        </div>
      </Dialog>

      {/* -- picklists: rename dialog ------------------------------------------------ */}
      <Dialog
        open={renameTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRenameTarget(null);
        }}
        title={d.commonEdit}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label={d.customFieldsPicklistNameEn}
            value={renameDraft.name}
            onValueChange={(value) => setRenameDraft({ ...renameDraft, name: value })}
            required
          />
          <Input
            label={d.customFieldsPicklistNameAr}
            value={renameDraft.nameAr}
            onValueChange={(value) => setRenameDraft({ ...renameDraft, nameAr: value })}
            required
          />
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setRenameTarget(null)}>
            {d.commonCancel}
          </Button>
          <Button
            variant="primary"
            loading={busy === "picklist-rename"}
            disabled={renameDraft.name.trim() === "" || renameDraft.nameAr.trim() === ""}
            onClick={() => void savePicklistRename()}
          >
            {d.commonSave}
          </Button>
        </div>
      </Dialog>

      {/* -- picklists: option edit dialog -------------------------------------------- */}
      <Dialog
        open={optionEditTarget !== null}
        onOpenChange={(open) => {
          if (!open) setOptionEditTarget(null);
        }}
        title={d.customFieldsOptionEdit}
      >
        <div className="grid gap-3 sm:grid-cols-3">
          <Input
            label={d.customFieldsOptionLabelEn}
            value={optionEditDraft.label}
            onValueChange={(value) => setOptionEditDraft({ ...optionEditDraft, label: value })}
            required
          />
          <Input
            label={d.customFieldsOptionLabelAr}
            value={optionEditDraft.labelAr}
            onValueChange={(value) => setOptionEditDraft({ ...optionEditDraft, labelAr: value })}
            required
          />
          <NumberInput
            label={d.customFieldsColOrder}
            value={optionEditDraft.sortOrder}
            onValueChange={(value) => setOptionEditDraft({ ...optionEditDraft, sortOrder: value })}
            min={1}
            max={1000}
          />
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setOptionEditTarget(null)}>
            {d.commonCancel}
          </Button>
          <Button
            variant="primary"
            loading={busy === "option-edit"}
            disabled={
              optionEditDraft.label.trim() === "" || optionEditDraft.labelAr.trim() === ""
            }
            onClick={() => void saveOptionEdit()}
          >
            {d.commonSave}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
