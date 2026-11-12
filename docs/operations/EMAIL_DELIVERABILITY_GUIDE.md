# Email Deliverability Guide (DKIM / SPF / DMARC)

> **Status:** STABLE · **Owner:** Platform Operations + the communications hub · **Updated:** 2026-11-12 (PHASE-041 T-12 · N-08's verified-provider leg)

Operational guide for landing the platform's outbound email in the inbox, not
the spam folder — the per-provider DNS records (DKIM/SPF/DMARC), the
per-environment verification checklist, and the credential discipline in
`/settings/communication` (the secret-store law: sealed at rest, never
logged, never returned for display). Scope: the EMAIL channel of the
communications hub (BR-067) across its four providers — SMTP, SendGrid, SES,
Mailgun. Related: [SECRETS_ROTATION_RUNBOOK.md](SECRETS_ROTATION_RUNBOOK.md)
(§5 covers the provider API keys), [ENVIRONMENT_CONFIGURATION.md](ENVIRONMENT_CONFIGURATION.md),
[../security/SECRETS_MANAGEMENT.md](../security/SECRETS_MANAGEMENT.md),
[MONITORING.md](MONITORING.md) (the delivery-log report is the verification
surface).

The three DNS records, in one line each:

- **SPF** (TXT on the sending domain) — the authoritative list of servers
  allowed to send as the domain; a hard-fail policy (`-all`) once verified.
- **DKIM** (TXT CNAMEs/keys per selector) — the cryptographic signature
  proving the message body/headers were not altered in transit; the private
  key lives with the provider, the public key in DNS.
- **DMARC** (TXT on `_dmarc.<domain>`) — the policy tying SPF/DKIM results to
  alignment (the visible From: domain must match the authenticated domain)
  plus reporting (`rua=`) — start `p=none` with reports, tighten to
  `quarantine`, then `reject`.

## 0. The iron rules (before any DNS)

1. **One sending domain per environment** — dev/staging NEVER send from the
   production domain (the dev shape is mailpit over SMTP, zero external
   calls; the SANDBOX default provider makes nothing leave the box until a
   real provider is selected AND credentialed — BR-067).
2. **Never send from a naked `localhost`, IP-literal, or a domain you do not
   control** — DMARC alignment is impossible and receivers bulk everything.
3. **The From: address is the tenant's per-market `emailFromAddress`** (or
   the provider default) — it MUST be on the verified sending domain.
4. **Test before you tighten** — every DMARC policy move (`none` →
   `quarantine` → `reject`) waits for ≥ 1 week of clean aggregate reports.
5. **The delivery log is the truth** — `communication.outbound_delivery_log`
   (REPORT_CATALOG §7) shows status/provider/cost per send; a spike in
   FAILED after a DNS change is the rollback signal.

## 1. Per-provider DNS setup

### 1.1 SMTP (self-hosted / relays like Mailcow, Postmark via SMTP)

| Record | Value (example for `mail.example.com` sending as `example.com`) |
|--------|------------------------------------------------------------------|
| SPF TXT `example.com.` | `v=spf1 ip4:203.0.113.10 -all` (the relay's egress IP; `~all` for the first week) |
| DKIM TXT `default._domainkey.example.com.` | `v=DKIM1; k=rsa; p=<base64 public key>` (generated on the relay; 2048-bit) |
| DMARC TXT `_dmarc.example.com.` | `v=DMARC1; p=none; rua=mailto:dmarc-reports@example.com; pct=100; adkim=s; aspf=s` |

- Set the reverse DNS (PTR) of the egress IP to the sending hostname
  (`mail.example.com`) — most receivers reject relays without it.
- The API credentials ride `SMTP_HOST/PORT/USER/PASS` env (PHASE-003) for
  the platform default, or the tenant's `smtp` provider credentials in
  `/settings/communication` (sealed).

### 1.2 SendGrid

| Record | Value |
|--------|-------|
| SPF TXT | `v=spf1 include:sendgrid.net -all` |
| DKIM CNAMEs (three, per the SendGrid console) | `.<selector>._domainkey.example.com. CNAME <selector>._domainkey.<subdomain>.sendgrid.net.` (automatic security ON — SendGrid rotates the keys) |
| DMARC TXT | as §0's shape (`p=none` first) |

- Sender Authentication → "Authenticate your domain" — copy the CNAMEs
  verbatim; verify in the console (usually < 1 hour).
- The tenant provider credentials in settings: `apiKey` (sealed; full-access
  not needed — "Mail Send" scope is enough).
- Per-market `emailFromAddress` must be on the authenticated domain.

### 1.3 Amazon SES

| Record | Value |
|--------|-------|
| SPF TXT | `v=spf1 include:amazonses.com -all` |
| DKIM CNAMEs (three) | `<selector>._domainkey.example.com. CNAME <selector>.dkim.amazonses.com.` (Easy DKIM; SES rotates automatically at 1024→2048) |
| DMARC TXT | as §0's shape |

- Verify the domain in SES (a TXT verification record or DKIM-only
  verification), then request production access out of the sandbox (the SES
  **sandbox** limits senders to verified addresses — unrelated to our
  SANDBOX provider, but the same word; note it in the checklist).
- Credentials in settings: `accessKeyId` + `secretAccessKey` (an IAM user
  with `ses:SendEmail`/`ses:SendRawEmail` ONLY — SigV4 signing is in the
  adapter, keys never logged).
- If the account is in `us-east-1`+ etc., the adapter defaults to
  `email.<region>.amazonaws.com` — the region rides the credentials map
  (`region` field) when non-default.

### 1.4 Mailgun

| Record | Value |
|--------|-------|
| SPF TXT | `v=spf1 include:mailgun.org -all` |
| DKIM TXT (or CNAME with delegated DNS) | `krs._domainkey.example.com. TXT "k=rsa; p=<key>"` (Mailgun rotates under the `krs` selector when delegated) |
| DMARC TXT | as §0's shape |

- Add the domain in the Mailgun console → copy the records → verify.
- Credentials in settings: `apiKey` (the `key-…`/`api:` private key, sealed)
  + `domain` (the verified sending domain) + optional `region` (`eu` for
  the EU infrastructure).
- The per-market senders must be subdomains of the verified domain (or
  verified themselves).

## 2. Per-environment verification checklist

Run top-to-bottom before flipping a channel live (record the run in the
phase/ops log; the API surfaces the resolution in
`GET /communication/providers` — `live: true` only when selection +
credentials are complete):

- [ ] **DNS propagated** — `dig TXT example.com`, `dig CNAME
      <selector>._domainkey.example.com`, `dig TXT _dmarc.example.com`
      resolve from a public resolver (not the authoritative server's cache).
- [ ] **Provider console shows verified** (domain authenticated / DKIM
      active / sandbox lifted on SES).
- [ ] **Credentials saved in `/settings/communication`** — every required
      field shows `configured`; secret values are NOT re-displayed (the
      masked state IS the contract — a field left blank keeps the stored
      value).
- [ ] **Selection + entitlement** — the channel's provider selected
      (requires the `communication.email_providers` tier-4 entitlement on
      the plan; a starter tenant cannot even save the selection).
- [ ] **The resolution badge flips live** — the settings screen shows
      `Live` for EMAIL (not `Sandbox`, not `Blocked on credentials`).
- [ ] **A canary send** — one manual EMAIL through a template preview-real
      send; the delivery log row lands `SENT`/`DELIVERED` with the provider
      ref and cost.
- [ ] **Header check on the canary** — `Authentication-Results:` shows
      `spf=pass` and `dkim=pass` (a Gmail/outlook.com "show original"
      inspect); DMARC aggregate reports start arriving at the `rua=` address.
- [ ] **PTR** set (SMTP only) and the bounce address is monitored.
- [ ] **DMARC policy staged** — `p=none` with reporting for ≥ 1 week, then
      tighten per §0 rule 4; never start at `reject`.

## 3. Credentials & rotation (the secret-store discipline)

- Provider credentials (API keys, SMTP passwords, OAuth tokens) are stored
  SEALED (the `v1:` envelope) in `tenant_settings` under the
  `communication.providers` key — the same law as every platform secret:
  never logged, never included in audit events (the provider-config audit
  records the SELECTION change against the masked catalog shape), never
  returned by any read API (only field-level `configured` booleans).
- **Rotation cadence** — provider API keys rotate per the provider's policy
  (SendGrid/Mailgun/SES IAM: 90 days is the house default); the procedure is
  [SECRETS_ROTATION_RUNBOOK.md](SECRETS_ROTATION_RUNBOOK.md) §5 (generate →
  dual-state → canary → cut over → revoke old → audit trail). Re-entering a
  key in `/settings/communication` overwrites the sealed value in place —
  blank fields keep the stored value, so rotating ONE field never disturbs
  the others.
- **Leak response** — revoke-first (runbook §0): withdraw the provider key
  at the provider console BEFORE investigating, then rotate in settings, then
  pull the delivery log + audit trail for the key's lifetime.
- The OAuth tokens of the calendar integration (IN-17) follow the same
  sealed storage (`communication.calendar` settings key) — refresh-token
  rotation by the provider is transparent to the sealed store (the connect
  flow re-seals on every exchange).

## 4. Deliverability hygiene (ongoing)

- **Bounces/complaints** — watch the FAILED rows in the delivery-log report;
  a receiver-side feedback loop (SendGrid/Mailgun webhooks are a future
  surface) is not yet wired — the manual weekly review is the 041 contract.
- **Volume ramp** — new sender domains ramp (tens/day → hundreds → the
  tenant's steady state); the daily hard cap (`sendCap.dailyHardCap` in
  settings) doubles as the ramp brake.
- **List hygiene** — dunning recipients come from the partner's contact
  email (verified structure); a bouncing recipient's contact should be
  corrected in the partner directory, never suppressed per-send.
- **WhatsApp/SMS senders** — the per-market map (`markets`) pins the
  WhatsApp phone-number-id (approved template messages only — the provider's
  template approval is the REQUIRES_VERIFICATION flag) and the SMS sender
  name (pre-registered with the provider per market regulator); the same
  checklist applies with the provider's own console steps.
