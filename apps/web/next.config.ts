import type { NextConfig } from "next";

/**
 * Workspace packages are consumed from TypeScript source (internal-packages
 * pattern); Next transpiles them. The design system joined in PHASE-005
 * (ADR-0016) — its CSS surface is imported from app/globals.css.
 *
 * Secure headers themselves are per-request (CSP nonce) in middleware.ts
 * (SECURITY_TEST_PLAN §8); this static layer covers non-document assets.
 *
 * PHASE-021 DR-P21-07 — the desktop shell export target (`ERP_TARGET=desktop`,
 * set only by `pnpm --filter @erp/web build:desktop` via
 * scripts/desktop-export-prebuild.mjs, which has already stashed the BFF
 * routes + middleware and reduced app/[locale] to the desktop.routes.json
 * subset): `output: "export"` with `distDir: "out-desktop"` (a custom distDir
 * IS the export destination in export mode — verified against Next 16.4.3
 * dist/export/utils.js hasCustomExportOutput), unoptimized images (no image
 * optimization server in the shell), and the "/" redirect omitted (redirects
 * are inert in export mode — Next only warns about them; the shell entry is
 * tauri.conf.json app.windows[0].url instead). The NORMAL build is
 * byte-identical to before this flag existed: same transpilePackages, same
 * redirect, no extra keys.
 */
const isDesktopExport = process.env.ERP_TARGET === "desktop";

const nextConfig: NextConfig = isDesktopExport
  ? {
      transpilePackages: ["@erp/domain-core", "@erp/contracts", "@erp/ui", "@erp/sync-core"],
      output: "export",
      images: { unoptimized: true },
      distDir: "out-desktop",
    }
  : {
      transpilePackages: ["@erp/domain-core", "@erp/contracts", "@erp/ui", "@erp/sync-core"],
      // Arabic-first entry: bare "/" redirects to the default locale segment
      // (the [locale] layout owns <html lang dir> — PHASE-003 §2.14).
      async redirects() {
        return [{ source: "/", destination: "/ar", permanent: false }];
      },
    };

export default nextConfig;
