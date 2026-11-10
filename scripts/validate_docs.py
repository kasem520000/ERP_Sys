#!/usr/bin/env python3
"""Documentation consistency validator for the Folder 3 canonical blueprint.

Runs deterministic, read-only checks over docs/:
  1. Relative markdown links resolve to existing files.
  2. Extracted industry manifests parse and carry `industry.*` ids (13 templates).
  3. Phase references are within the canonical PHASE-001..034 range and
     known-good for desktop (021) / android (022) / sync (020) / e-invoicing (023).
  4. Consolidation corrections are present (DEF-001/002/003/004/007/008 markers,
     no stale CASH_BANK purpose, no `treasury.receipts.*`/`treasury.payments.*`
     permission keys, blanket money regex gone).
  5. ADR set (0001..0019) is complete and indexed.
  6. Authoritative consolidated documents exist.
  7. Blueprint v2.0 expansion artifacts are present and internally consistent
     (EXPANSION_REGISTER ED-01..ED-19, six new modules in FEATURE_CATALOG, new
     entities in ENTITY_CATALOG, decision records + ADR-0018, PHASE-026..034
     documents with canonical headings, G-21..32 / INV-023..26 / BR-041..056
     registered) — see docs/EXPANSION_REGISTER.md §N.

Exit code 0 = all checks pass. Run from repository root:
    python3 scripts/validate_docs.py
"""
import json
import re
import sys
from pathlib import Path

DOCS = Path(__file__).resolve().parent.parent / "docs"
FAILURES: list[str] = []
CHECKS = 0


def check(name: str, ok: bool, detail: str = "") -> None:
    global CHECKS
    CHECKS += 1
    if ok:
        print(f"PASS  {name}")
    else:
        print(f"FAIL  {name}  {detail}")
        FAILURES.append(f"{name} {detail}")


def md_files() -> list[Path]:
    return sorted(DOCS.rglob("*.md"))


def link_check() -> None:
    broken = []
    files = md_files()
    for f in files:
        text = f.read_text(encoding="utf-8")
        for m in re.finditer(r"\]\(([^)#\s]+?)(?:#[^)\s]*)?\)", text):
            target = m.group(1)
            if target.startswith(("http://", "https://", "mailto:")):
                continue
            # resolve relative to the file's directory; tolerate ../ escapes from docs/
            base = f.parent
            cand = (base / target).resolve()
            if not cand.exists():
                broken.append(f"{f.relative_to(DOCS)} -> {target}")
    check("1a. all relative links resolve", not broken, f"{len(broken)} broken" + ("; first: " + broken[0] if broken else ""))


def manifest_check() -> None:
    mdir = DOCS / "industries" / "templates" / "manifests"
    expected = ["retail", "grocery", "restaurant", "automotive", "distribution",
                "food_manufacturing", "professional_services", "rental_logistics",
                "wholesale", "electronics", "healthcare", "education", "agriculture"]
    ok, details = True, []
    for fam in expected:
        p = mdir / f"manifest.{fam}.json"
        if not p.exists():
            ok = False; details.append(f"missing {p.name}"); continue
        try:
            data = json.loads(p.read_text(encoding="utf-8"))
            mid = data.get("id", "")
            if not mid.startswith("industry."):
                ok = False; details.append(f"{p.name}: bad id {mid!r}")
        except json.JSONDecodeError as e:
            ok = False; details.append(f"{p.name}: parse error {e}")
    check("1b. 13 extracted manifests parse with industry.* ids", ok, "; ".join(details))


def phase_ref_check() -> None:
    bad = []
    for f in md_files():
        text = f.read_text(encoding="utf-8")
        rel = f.relative_to(DOCS)
        for m in re.finditer(r"PHASE-(\d{3})", text):
            n = int(m.group(1))
            # Blueprint v3.0 (2026-11-10): range widened 001-034 -> 001-065
            # (stages 12-15, PHASE-035..065) per COMPLETENESS_REGISTER.md CR-37.
            if not (1 <= n <= 65):
                bad.append(f"{rel}: out-of-range PHASE-{m.group(1)}")
        # targeted label check: lines that *declare* a client app's phase label
        # (e.g. mermaid nodes / ADR titles), not prose about phase eligibility order
        for line in text.splitlines():
            # skip eligibility-order prose: a line that already states the correct
            # desktop canon (PHASE-021) is listing *other* phases parenthetically
            if re.search(r"PHASE-021[^\n]{0,40}desktop|desktop[^\n]{0,40}PHASE-021", line, re.I):
                continue
            if re.search(r"android.{0,40}\(PHASE-(\d{3})\)", line, re.I):
                n = re.search(r"android.{0,40}\(PHASE-(\d{3})\)", line, re.I).group(1)
                if n != "022":
                    bad.append(f"{rel}: android label says PHASE-{n}, canon is 022")
            if re.search(r"desktop.{0,40}\(PHASE-(\d{3})\)", line, re.I):
                n = re.search(r"desktop.{0,40}\(PHASE-(\d{3})\)", line, re.I).group(1)
                if n != "021":
                    bad.append(f"{rel}: desktop label says PHASE-{n}, canon is 021")
    check("2. phase refs within 001-065 (v3.0) and canon client labels (desktop=021/android=022)",
          not bad, "; ".join(sorted(set(bad))[:6]))


def consolidation_marker_check() -> None:
    def has(path: str, needle: str) -> bool:
        return needle in (DOCS / path).read_text(encoding="utf-8")

    check("3a. DEF-001 per-type money patterns present (API_CONVENTIONS §7)",
          has("api/API_CONVENTIONS.md", r"(\.\d{1,4})?$") and has("api/API_CONVENTIONS.md", r"(\.\d{1,6})?$") and has("api/API_CONVENTIONS.md", r"(\.\d{1,8})?"))
    check("3b. DEF-001 ADR-0009 corrected (blanket 1,8 regex gone from money line)",
          not has("architecture/ADR/ADR-0009-money-precision.md", "for money inputs"))
    check("3c. DEF-004 enums registered (VAT_PLANNED_EINVOICING + FAILED)",
          has("database/DATA_DICTIONARY.md", "VAT_PLANNED_EINVOICING") and has("database/DATA_DICTIONARY.md", "REPORTED, FAILED"))
    check("3d. DEF-007 permission keys follow ownership (sales.receipts / purchasing.payments in matrix)",
          has("security/AUTHORIZATION_MATRIX.md", "`sales.receipts.view`") and has("security/AUTHORIZATION_MATRIX.md", "`purchasing.payments.view`"))
    check("3e. DEF-007 no residual treasury.receipts./treasury.payments. permission keys",
          not any(re.search(r"`treasury\.(receipts|payments)\.(view|create|approve|post)`", f.read_text(encoding="utf-8")) for f in md_files()))
    check("3f. DEF-006 no residual CASH_BANK purpose key (outside the defect-log descriptions)",
          not any("`CASH_BANK`" in f.read_text(encoding="utf-8")
                  for f in md_files()
                  if f.name not in ("CONSOLIDATION_VALIDATION_REPORT.md", "CONSOLIDATION_REGISTER.md")))
    check("3g. DEF-006 OPENING_EQUITY purpose registered",
          has("accounting/CHART_OF_ACCOUNTS.md", "`OPENING_EQUITY`"))
    check("3h. DEF-008 canonical machine ids in template index",
          has("industries/templates/README.md", "`industry.restaurant`") and has("industries/templates/README.md", "`industry.retail`"))
    check("3i. DEF-009 validation-report count corrected",
          has("handoff/VALIDATION_REPORT.md", "202 total markdown files"))
    check("3j. DEF-010 deferred balance trigger present",
          has("database/CONSTRAINTS_AND_INDEXES.md", "DEFERRABLE INITIALLY DEFERRED"))
    check("3k. CD-05 marketing rule present",
          has("localization/compliance-matrix/README.md", "no\nmarketing, onboarding, in-app, or documentation copy may claim") or
          has("localization/compliance-matrix/README.md", "marketing, onboarding, in-app, or documentation copy may claim"))
    check("3l. CD-04 login idempotency exclusion present",
          has("api/IDEMPOTENCY.md", "Explicitly NOT idempotent"))
    check("3m. CD-10 status badge binding present",
          has("ui/DESIGN_TOKENS.md", "Document-status badge binding"))
    check("3n. CD-03 tafqit present",
          has("reporting/PRINTING_AND_EXPORT.md", "tafqit"))
    check("3o. CD-01 effect-matrix gate present",
          has("accounting/POSTING_ENGINE.md", "Extension gate (adopted from Folder 1)"))
    check("3p. CD-11 costing-picking decoupling present",
          has("accounting/INVENTORY_ACCOUNTING.md", "Costing–picking decoupling"))
    check("3q. AD-17 ADR-0017 present and indexed",
          has("architecture/ADR/ADR-0017-no-event-sourcing.md", "No Event Sourcing") and
          has("architecture/ARCHITECTURE_DECISIONS.md", "ADR-0017"))


def structure_check() -> None:
    required = [
        "CONSOLIDATION_REGISTER.md", "ARCHITECTURE_DECISION_REGISTER.md",
        "ARCHITECTURE_BASELINE.md", "ARCHITECTURE_RISKS_AND_OPEN_QUESTIONS.md",
        "database/DATABASE_ARCHITECTURE.md",
        "accounting/ACCOUNTING_ENGINE_SPECIFICATION.md",
        "security/SECURITY_AND_TENANT_ISOLATION.md",
        "localization/REGIONAL_TAX_AND_COMPLIANCE_ARCHITECTURE.md",
        "industries/INDUSTRY_MODULE_ARCHITECTURE.md",
        "ui/UNIFIED_UI_DESIGN_SYSTEM.md",
        "reporting/REPORTING_AND_DOCUMENT_ENGINE.md",
        "offline/OFFLINE_AND_SYNC_ARCHITECTURE.md",
        "planning/IMPLEMENTATION_ROADMAP.md",
    ]
    missing = [r for r in required if not (DOCS / r).exists()]
    check("4a. authoritative consolidated documents exist", not missing, f"missing: {missing}")
    adr_dir = DOCS / "architecture" / "ADR"
    adrs = sorted(p.name for p in adr_dir.glob("ADR-*.md"))
    have = {int(re.search(r"ADR-(\d{4})", a).group(1)) for a in adrs}
    check("4b. ADR set 0001..0019 complete", have == set(range(1, 20)), f"have={sorted(have)}")
    phases = sorted(p.name for p in (DOCS / "implementation" / "phases").glob("PHASE-*.md"))
    # Blueprint v3.0 (2026-11-10): 34 -> 65 phase documents (stages 12-15 added
    # PHASE-035..065 per COMPLETENESS_REGISTER.md; check 8b verifies their headings).
    check("4c. 65 phase documents present (34 baseline + 31 v3.0)", len(phases) == 65, f"count={len(phases)}")
    n = len(md_files())
    print(f"INFO  total markdown files under docs/: {n}")


def expansion_check() -> None:
    """Blueprint v2.0 structural checks (EXPANSION_REGISTER §N)."""
    def has(path: str, needle: str) -> bool:
        return needle in (DOCS / path).read_text(encoding="utf-8")

    reg = DOCS / "EXPANSION_REGISTER.md"
    ok_reg = reg.exists() and all(f"ED-{i:02d}" in reg.read_text(encoding="utf-8") for i in range(1, 20))
    check("4d. EXPANSION_REGISTER present with ED-01..ED-19", ok_reg)

    fc = "product/FEATURE_CATALOG.md"
    ok_fc = all(has(fc, f"Module: {m}") for m in
                ("fixed_assets", "notes", "installments", "budgeting", "payroll", "consolidation"))
    check("4e. six v2.0 modules present in FEATURE_CATALOG", ok_fc)

    ec = "database/ENTITY_CATALOG.md"
    ok_ec = all(has(ec, f"`{e}`") for e in
                ("asset_categories", "assets", "notes", "note_events", "installment_plans",
                 "budgets", "budget_lines", "employees", "salary_structures", "payroll_runs",
                 "employee_loans", "consolidation_groups", "group_entities"))
    check("4f. v2.0 entities present in ENTITY_CATALOG", ok_ec)

    ok_dr = all((DOCS / f).exists() for f in (
        "decisions/product/DR-003-platform-expansion-v2.md",
        "decisions/accounting/DR-002-fixed-assets.md",
        "decisions/accounting/DR-003-notes-and-installments.md",
        "decisions/accounting/DR-004-budgeting.md",
        "decisions/accounting/DR-005-payroll-scope.md",
        "decisions/accounting/DR-006-consolidation.md",
        "architecture/ADR/ADR-0018-multi-entity-consolidation.md"))
    ok_dr = ok_dr and has("architecture/ARCHITECTURE_DECISIONS.md", "ADR-0018")
    check("4g. v2.0 decision records + ADR-0018 present and indexed", ok_dr)

    bad_ph = []
    for n in range(26, 35):
        p = DOCS / "implementation" / "phases" / f"PHASE-{n:03d}.md"
        if not p.exists():
            bad_ph.append(f"PHASE-{n:03d} missing"); continue
        t = p.read_text(encoding="utf-8")
        for s in range(1, 9):
            if f"## {s}. " not in t:
                bad_ph.append(f"PHASE-{n:03d}: no '## {s}. ' heading")
    check("4h. PHASE-026..034 present with 8 canonical headings", not bad_ph, "; ".join(bad_ph[:5]))

    ok_refs = (has("accounting/JOURNAL_RULES.md", "G-32") and
               has("accounting/ACCOUNTING_INVARIANTS.md", "INV-026") and
               has("product/BUSINESS_RULES.md", "BR-056") and
               has("reporting/REPORT_CATALOG.md", "consolidation.eliminations-log") and
               has("security/AUTHORIZATION_MATRIX.md", "payroll.runs.approve") and
               has("ui/NAVIGATION_MODEL.md", "الموظفون والرواتب"))
    check("4i. v2.0 cross-references registered (G-21..32, INV-023..26, BR-041..056, reports, perms, nav)", ok_refs)


def completeness_check() -> None:
    """Check 8 — Blueprint v3.0 completeness-program artifacts (2026-11-10):
    the register, the roadmap, and the 31 phase documents (035..065) with the
    8 canonical headings. Governed by docs/planning/COMPLETENESS_REGISTER.md."""
    def has(path: str, needle: str) -> bool:
        return needle in (DOCS / path).read_text(encoding="utf-8")

    ok_reg = (DOCS / "planning" / "COMPLETENESS_REGISTER.md").exists()
    ok_road = (DOCS / "planning" / "COMPLETENESS_ROADMAP.md").exists()
    ok_reg = ok_reg and has("planning/COMPLETENESS_REGISTER.md", "CR-01") and \
        has("planning/COMPLETENESS_REGISTER.md", "CR-40")
    ok_road = ok_road and has("planning/COMPLETENESS_ROADMAP.md", "PHASE-035") and \
        has("planning/COMPLETENESS_ROADMAP.md", "PHASE-065")
    check("8a. v3.0 register + roadmap present (CR-01..CR-40, phases 035..065)",
          ok_reg and ok_road)

    bad_ph = []
    for n in range(35, 66):
        p = DOCS / "implementation" / "phases" / f"PHASE-{n:03d}.md"
        if not p.exists():
            bad_ph.append(f"PHASE-{n:03d} missing"); continue
        t = p.read_text(encoding="utf-8")
        for s in range(1, 9):
            if f"## {s}. " not in t:
                bad_ph.append(f"PHASE-{n:03d}: no '## {s}. ' heading")
        if "NOT_STARTED" not in t:
            bad_ph.append(f"PHASE-{n:03d}: no NOT_STARTED status marker")
    check("8b. PHASE-035..065 present with 8 canonical headings + planned status",
          not bad_ph, "; ".join(bad_ph[:5]))

    ok_gap = (DOCS / "planning" / "gap-analysis").is_dir() and all(
        (DOCS / "planning" / "gap-analysis" / name).exists() for name in (
            "PROJECT_EVALUATION_2026-11-10.md",
            "ERP_COMPLETENESS_GAP_REPORT.md",
            "ERP_FULL_GAP_ANALYSIS.md"))
    check("8c. the three audit evidence reports preserved under planning/gap-analysis/", ok_gap)


def main() -> int:
    if not DOCS.exists():
        print("docs/ not found"); return 1
    link_check()
    manifest_check()
    phase_ref_check()
    consolidation_marker_check()
    structure_check()
    expansion_check()
    completeness_check()
    print(f"\n{CHECKS - len(FAILURES)}/{CHECKS} checks passed.")
    if FAILURES:
        print("FAILURES:")
        for f in FAILURES:
            print(" -", f)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
