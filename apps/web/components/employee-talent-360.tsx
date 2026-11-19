"use client";

/**
 * PHASE-047 (W-5, T-14) — the employee 360 extension (the phase doc
 * §2.8, D-13): the read-model composition over the module APIs — the
 * D-01 placement (position + grade + org path + reports_to + the
 * A-1 probation chip), the review TREND (the MANAGER outcomes per
 * cycle, BR-090's law — the 360 inputs never ride this surface), the
 * active goals, the training records, the certifications, the
 * document register with expiry chips (HR-10 — the numbers surface
 * only through the register's own permission plane; a degraded fetch
 * hides its panel honestly), and the hired-applicant source record.
 * Panels whose reference fetch resolved render; a 403 hides its panel
 * (the honest scope); ALL-talent-403 renders the one honest note.
 */
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { JSX } from "react";

import { Badge, Button, DatePicker, Dialog, Input, Select, Textarea, useToast } from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type {
  ApplicantRow,
  CertificationRow,
  EmployeeDocumentRow,
  EmployeePlacementView,
  EmployeeReviewTrendRow,
  GoalRow,
  TrainingEnrollmentRow,
  TrainingProgramRow,
  VacancyRow,
} from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import {
  formatMessage,
  localizedName,
  localizedTalentDocumentKind,
  localizedTalentError,
  localizedTalentGoalStatus,
  localizedTalentReviewStatus,
} from "../lib/messages";
import { Card } from "./card";
import { ErrorNotice } from "./notices";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DOC_KINDS = ["PASSPORT", "IQAMA", "VISA", "CONTRACT", "CERTIFICATE", "OTHER"] as const;
type DocKind = (typeof DOC_KINDS)[number];

/** The whole days between today and an ISO date (negative = expired) —
 * both anchors are midnight-UTC so the division is EXACT (never a
 * rounded float; the money rule's spirit, applied to day counts). */
function daysUntil(date: string): number {
  return (
    (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`)) /
    86_400_000
  );
}

export function EmployeeTalent360({
  locale,
  employeeId,
  placement,
  trend,
  goals,
  enrollments,
  programs,
  certifications,
  documents,
  documentsAllowed,
  sourceApplicant,
  vacancies,
}: {
  locale: Locale;
  employeeId: string;
  /** null = the placement read was refused (hr.org.view absent). */
  placement: EmployeePlacementView | null;
  trend: readonly EmployeeReviewTrendRow[] | null;
  goals: readonly GoalRow[] | null;
  enrollments: readonly TrainingEnrollmentRow[] | null;
  programs: readonly TrainingProgramRow[];
  certifications: readonly CertificationRow[] | null;
  /** null = the register read was refused (hr.documents.manage absent). */
  documents: readonly EmployeeDocumentRow[] | null;
  documentsAllowed: boolean;
  sourceApplicant: ApplicantRow | null;
  vacancies: readonly VacancyRow[];
}): JSX.Element {
  const d = getDictionary(locale);
  const router = useRouter();
  const { toast } = useToast();

  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [docRows, setDocRows] = useState<readonly EmployeeDocumentRow[] | null>(documents);
  const [docCreateOpen, setDocCreateOpen] = useState(false);
  const [oKind, setOKind] = useState<DocKind>("IQAMA");
  const [oNumber, setONumber] = useState("");
  const [oIssued, setOIssued] = useState("");
  const [oExpires, setOExpires] = useState("");
  const [oNotes, setONotes] = useState("");

  const anyTalentAccess =
    placement !== null ||
    trend !== null ||
    goals !== null ||
    enrollments !== null ||
    certifications !== null ||
    documentsAllowed;

  const activeGoals = useMemo(
    () => (goals ?? []).filter((goal) => goal.status === "ACTIVE" || goal.status === "AT_RISK"),
    [goals],
  );

  const programLabelFor = (id: string): string => {
    const found = programs.find((program) => program.id === id);
    return found === undefined ? "—" : localizedName(found.name, found.nameAr, locale);
  };

  const positionLabelFor = (id: string | null): string => {
    if (id === null) {
      return "—";
    }
    const found = placement?.position;
    return found !== undefined && found !== null && found.id === id
      ? localizedName(found.title, found.titleAr, locale)
      : id;
  };

  const vacancyLabelFor = (id: string): string => {
    const found = vacancies.find((vacancy) => vacancy.id === id);
    return found === undefined ? "—" : `${found.code} · ${localizedName(found.title, found.titleAr, locale)}`;
  };

  async function createDocument(): Promise<void> {
    setError(null);
    if (oIssued !== "" && !DATE_RE.test(oIssued)) {
      setError(d.budgetFormInvalid);
      return;
    }
    if (oExpires !== "" && !DATE_RE.test(oExpires)) {
      setError(d.budgetFormInvalid);
      return;
    }
    setBusy("doc-create");
    const result = await bffFetch<EmployeeDocumentRow>("hr/documents", {
      method: "POST",
      body: {
        employeeId,
        kind: oKind,
        number: oNumber.trim() === "" ? null : oNumber.trim(),
        issuedOn: oIssued === "" ? null : oIssued,
        expiresOn: oExpires === "" ? null : oExpires,
        notes: oNotes.trim() === "" ? null : oNotes.trim(),
      },
    });
    setBusy(null);
    if (!result.ok) {
      setError(localizedTalentError(d, result.error, result.retryAfterSeconds));
      return;
    }
    if (docRows !== null) {
      setDocRows([result.data, ...docRows]);
    }
    setDocCreateOpen(false);
    setOKind("IQAMA"); setONumber(""); setOIssued(""); setOExpires(""); setONotes("");
    toast({ tone: "success", title: d.talDocSavedToast });
    router.refresh();
  }

  if (!anyTalentAccess) {
    return (
      <Card title={d.tal360Title}>
        <p className="text-sm text-gray-600">{d.tal360NoAccess}</p>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {error !== null && <ErrorNotice>{error}</ErrorNotice>}

      <Card title={d.tal360Title}>
        {placement === null ? (
          <p className="text-sm text-gray-600">{d.tal360NoPlacement}</p>
        ) : (
          <div className="flex flex-col gap-3">
            {placement.position === null ? (
              <p className="text-sm text-gray-600">{d.tal360NoPlacement}</p>
            ) : (
              <div className="flex flex-wrap items-center gap-4 text-sm">
                <span>
                  {d.talPosition}:{" "}
                  <span className="font-medium">
                    {localizedName(placement.position.title, placement.position.titleAr, locale)}
                  </span>{" "}
                  <span className="font-mono text-xs text-gray-500" dir="ltr">
                    {placement.position.code}
                  </span>
                </span>
                {placement.position.grade !== null && (
                  <span>
                    {d.talLabelGrade}: <span className="font-medium">{placement.position.grade}</span>
                  </span>
                )}
                {placement.orgUnit !== null && (
                  <span>
                    {d.talTabOrgUnits}:{" "}
                    <span className="font-medium">
                      {localizedName(placement.orgUnit.name, placement.orgUnit.nameAr, locale)}
                    </span>{" "}
                    <span className="font-mono text-xs text-gray-500" dir="ltr">
                      {placement.orgUnit.path}
                    </span>
                  </span>
                )}
                <span>
                  {d.talReportsTo}:{" "}
                  <span className="font-medium">{positionLabelFor(placement.position.reportsTo)}</span>
                </span>
                {placement.probationEnd !== null && (
                  <span className="flex items-center gap-2">
                    <span className="font-mono text-sm" dir="ltr">
                      {d.tal360Probation}: {placement.probationEnd}
                    </span>
                    {daysUntil(placement.probationEnd) <= 30 && (
                      <Badge tone="primary">
                        {daysUntil(placement.probationEnd) < 0
                          ? d.talExpiredChip
                          : formatMessage(d.talDaysLeft, { days: String(daysUntil(placement.probationEnd)) })}
                      </Badge>
                    )}
                  </span>
                )}
              </div>
            )}
          </div>
        )}
      </Card>

      {trend !== null && (
        <Card title={d.tal360Trend} description={d.tal360TrendHint}>
          {trend.length === 0 ? (
            <p className="text-sm text-gray-600">{d.talEmptyRows}</p>
          ) : (
            <div className="flex flex-col gap-2">
              {trend.map((row) => (
                <div
                  key={row.id}
                  className="flex flex-wrap items-center gap-4 rounded-md border border-subtle px-3 py-2 text-sm"
                >
                  <span className="font-medium">
                    {locale === "ar" && row.cycleNameAr !== null ? row.cycleNameAr : row.cycleName}
                  </span>
                  <span className="font-mono text-xs text-gray-500" dir="ltr">
                    {row.cyclePeriodStart} → {row.cyclePeriodEnd}
                  </span>
                  <Badge tone={row.status === "DRAFT" ? "neutral" : "primary"}>
                    {localizedTalentReviewStatus(d, row.status)}
                  </Badge>
                  <span className="font-mono tabular-nums" dir="ltr">
                    {d.tal360Overall}: {row.overallScore ?? "—"}
                  </span>
                  <span className="font-mono tabular-nums" dir="ltr">
                    {d.talGoalRollup}: {row.goalRollup ?? "—"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {goals !== null && (
        <Card title={d.tal360Goals}>
          {activeGoals.length === 0 ? (
            <p className="text-sm text-gray-600">{d.talEmptyRows}</p>
          ) : (
            <div className="flex flex-col gap-2">
              {activeGoals.map((goal) => (
                <div
                  key={goal.id}
                  className="flex flex-wrap items-center gap-4 rounded-md border border-subtle px-3 py-2 text-sm"
                >
                  <span className="font-medium">
                    {locale === "ar" && goal.titleAr !== null ? goal.titleAr : goal.title}
                  </span>
                  <Badge tone="neutral">
                    <span dir="ltr">
                      {d.tal360Weight}: {goal.weight}%
                    </span>
                  </Badge>
                  <Badge tone={goal.status === "AT_RISK" ? "primary" : "neutral"}>
                    {localizedTalentGoalStatus(d, goal.status)}
                  </Badge>
                  {goal.progressPct !== null && (
                    <span className="font-mono tabular-nums" dir="ltr">
                      {d.talProgressPct}: {goal.progressPct}%
                    </span>
                  )}
                  {goal.dueDate !== null && (
                    <span className="font-mono text-xs text-gray-500" dir="ltr">
                      {d.talDueDate}: {goal.dueDate}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {enrollments !== null && (
        <Card title={d.tal360Training}>
          {enrollments.length === 0 ? (
            <p className="text-sm text-gray-600">{d.talEmptyRows}</p>
          ) : (
            <div className="flex flex-col gap-2">
              {enrollments.map((row) => (
                <div
                  key={row.id}
                  className="flex flex-wrap items-center gap-4 rounded-md border border-subtle px-3 py-2 text-sm"
                >
                  <span className="font-medium">{programLabelFor(row.programId)}</span>
                  <Badge tone={row.status === "COMPLETED" ? "primary" : "neutral"}>{row.status}</Badge>
                  {row.completionPct !== null && (
                    <span className="font-mono tabular-nums" dir="ltr">
                      {d.talCompletionPct}: {row.completionPct}%
                    </span>
                  )}
                  {row.result !== null && <span>{row.result}</span>}
                  {row.completedAt !== null && (
                    <span className="font-mono text-xs text-gray-500" dir="ltr">
                      {d.talCompletedAt}: {row.completedAt}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {certifications !== null && (
        <Card title={d.tal360Certifications}>
          {certifications.length === 0 ? (
            <p className="text-sm text-gray-600">{d.talEmptyRows}</p>
          ) : (
            <div className="flex flex-col gap-2">
              {certifications.map((row) => (
                <div
                  key={row.id}
                  className="flex flex-wrap items-center gap-4 rounded-md border border-subtle px-3 py-2 text-sm"
                >
                  <span className="font-medium">{localizedName(row.name, row.nameAr, locale)}</span>
                  <span>{row.issuer}</span>
                  <span className="font-mono text-xs text-gray-500" dir="ltr">
                    {row.issueDate}
                    {row.expiryDate === null ? "" : ` → ${row.expiryDate}`}
                  </span>
                  {row.expiryDate !== null && daysUntil(row.expiryDate) <= 30 && (
                    <Badge tone="primary">
                      {daysUntil(row.expiryDate) < 0
                        ? d.talExpiredChip
                        : formatMessage(d.talDaysLeft, { days: String(daysUntil(row.expiryDate)) })}
                    </Badge>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {documentsAllowed && (
        <Card
          title={d.tal360Documents}
          description={d.talDocPiiNote}
          actions={
            <Button variant="primary" onClick={() => setDocCreateOpen(true)}>
              {d.talDocNew}
            </Button>
          }
        >
          {(docRows ?? []).length === 0 ? (
            <p className="text-sm text-gray-600">{d.talEmptyRows}</p>
          ) : (
            <div className="flex flex-col gap-2">
              {(docRows ?? []).map((row) => (
                <div
                  key={row.id}
                  className="flex flex-wrap items-center gap-4 rounded-md border border-subtle px-3 py-2 text-sm"
                >
                  <Badge tone="neutral">{localizedTalentDocumentKind(d, row.kind)}</Badge>
                  <span className="font-mono" dir="ltr">
                    {row.number ?? "—"}
                  </span>
                  <span className="font-mono text-xs text-gray-500" dir="ltr">
                    {row.issuedOn ?? "—"}
                    {row.expiresOn === null ? "" : ` → ${row.expiresOn}`}
                  </span>
                  {row.expiresOn !== null && daysUntil(row.expiresOn) <= 30 && (
                    <Badge tone="primary">
                      {daysUntil(row.expiresOn) < 0
                        ? d.talExpiredChip
                        : formatMessage(d.talDaysLeft, { days: String(daysUntil(row.expiresOn)) })}
                    </Badge>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {sourceApplicant !== null && (
        <Card title={d.tal360Source}>
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <span className="font-medium">
              {locale === "ar" && sourceApplicant.fullNameAr !== null
                ? sourceApplicant.fullNameAr
                : sourceApplicant.fullName}
            </span>
            <Badge tone="primary">{sourceApplicant.stage}</Badge>
            <span>{vacancyLabelFor(sourceApplicant.vacancyId)}</span>
            {sourceApplicant.source !== null && (
              <span>
                {d.talSource}: {sourceApplicant.source}
              </span>
            )}
            <span className="font-mono text-xs text-gray-500" dir="ltr">
              {sourceApplicant.createdAt}
            </span>
          </div>
          {sourceApplicant.stageHistory.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2 text-xs text-gray-600">
              {sourceApplicant.stageHistory.map((entry, index) => (
                <span key={`${entry.at}-${index}`} className="font-mono" dir="ltr">
                  {entry.from} → {entry.to} ({entry.action})
                </span>
              ))}
            </div>
          )}
        </Card>
      )}

      <Dialog open={docCreateOpen} onOpenChange={setDocCreateOpen} title={d.talDocNew}>
        <div className="flex flex-col gap-3">
          <Select
            id="tal-360-doc-kind"
            label={d.talDocKind}
            value={oKind}
            onValueChange={(value) => {
              if ((DOC_KINDS as readonly string[]).includes(value)) {
                setOKind(value as DocKind);
              }
            }}
            options={DOC_KINDS.map((kind) => ({
              value: kind,
              label: localizedTalentDocumentKind(d, kind),
            }))}
            required
          />
          <Input
            id="tal-360-doc-number"
            label={d.talDocNumber}
            value={oNumber}
            onValueChange={setONumber}
            mono
            bidiIsolate
          />
          <DatePicker id="tal-360-doc-issued" locale={locale} label={d.talIssuedOn} value={oIssued} onSelect={setOIssued} />
          <DatePicker id="tal-360-doc-expires" locale={locale} label={d.talExpiresOn} value={oExpires} onSelect={setOExpires} />
          <Textarea id="tal-360-doc-notes" label={d.talLabelNotes} value={oNotes} onValueChange={setONotes} />
          <div className="flex justify-end">
            <Button variant="primary" onClick={() => void createDocument()} loading={busy === "doc-create"}>
              {d.talSaveBtn}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
