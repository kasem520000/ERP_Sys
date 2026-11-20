/**
 * /{locale}/projects — the projects WBS board (PHASE-048 W-12 T-14,
 * matrix §3.26; archetype list-search): the project selector + the WBS
 * tree (dependencies + the BR-095 leaf-recomputed %-complete rollup —
 * the engine's own figures), the Gantt-ish timeline, and the EVM tab
 * (the W-10 engine's snapshot — PV/EV/AC, the four AC legs, CPI/SPI,
 * ETC/EAC, the disclosures). Every figure is an ENGINE OUTPUT rendered
 * verbatim (zero parallel computation; display-only rounding). The
 * EVM tab rides its own key (projects.evm.view) and degrades to the
 * honest no-permission notice; typed refusals render with their full
 * payloads — never a generic error. The first project loads
 * server-side (the mrp-page rule); switching re-fetches through the
 * BFF.
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../components/client-ui";

import { AppShell } from "../../../components/app-shell";
import { ProjectsWbsBoard } from "../../../components/projects-wbs-board";
import { getDictionary, isLocale, type Locale } from "../../../i18n/dictionaries";
import type {
  EvmSnapshot,
  ProjectPoolRow,
  WbsTreeNode,
} from "../../../lib/api-types";
import { localizedApiError } from "../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../lib/server-api";

export default async function ProjectsBoardPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<JSX.Element> {
  const { locale } = await params;
  if (!isLocale(locale)) {
    notFound();
  }
  const localeValue = locale as Locale;
  const d = getDictionary(localeValue);

  await requireSessionToken(localeValue);

  const projects = await fetchApi<readonly ProjectPoolRow[]>("projects");
  if (!projects.ok && projects.status === 401) {
    redirect(`/${locale}/login`);
  }

  let content: JSX.Element;
  if (!projects.ok) {
    const forbidden = projects.status === 403 || projects.error.code === "FORBIDDEN";
    content = (
      <ErrorState
        title={forbidden ? d.errorsForbidden : localizedApiError(d, projects.error)}
      />
    );
  } else {
    // The first project's tree + EVM load server-side (the mrp-page
    // rule); the EVM read degrades to its honest notice on 403 (its own
    // key) and to the typed-refusal panel on a typed engine refusal.
    const first = projects.data[0] ?? null;
    const [tree, evm] = await Promise.all([
      first === null
        ? Promise.resolve({ ok: true as const, data: [] as WbsTreeNode[] })
        : fetchApi<WbsTreeNode[]>(`projects/${first.id}/wbs`),
      first === null
        ? Promise.resolve({ ok: true as const, data: null as unknown as EvmSnapshot })
        : fetchApi<EvmSnapshot>(`projects/${first.id}/evm`),
    ]);
    content = (
      <ProjectsWbsBoard
        locale={localeValue}
        initialProjects={projects.data}
        initialProjectId={first?.id ?? null}
        initialTree={tree.ok ? tree.data : null}
        initialTreeError={tree.ok ? null : tree.error}
        initialEvm={evm.ok ? evm.data : null}
        initialEvmError={evm.ok ? null : evm.error}
      />
    );
  }

  return (
    <AppShell locale={localeValue} pagePath="projects" title={d.projectsBoardTitle}>
      {content}
    </AppShell>
  );
}
