# PHASE-014 gate evidence — FINAL release run (2026-11-01)

All 17 local-gate steps (scripts/ci/local-gate.sh) re-run end-to-end AFTER the last file
change (incl. k6/mvp-candidate.ts + scripts/restore-drill.ts) — 17/17 exit 0.
Companion measurements: the NFR-006 harness run + the backup-restore drill record
(both below).

## 1. The 17-step gate transcript

```
=== PHASE-014 local gate — FINAL release run (all files incl. k6/mvp-candidate.ts + scripts/restore-drill.ts) ===

=== typecheck ===

> erp-platform@0.1.0 typecheck /home/z/my-project/extracted_phase013
> turbo run typecheck


   • turbo 2.11.10
   • Packages in scope: @erp/api, @erp/config, @erp/contracts, @erp/domain-core, @erp/ui, @erp/web
   • Running typecheck in 6 packages
   • Remote caching disabled

@erp/api:typecheck: cache miss, executing 3b44433c0e0f974d
@erp/domain-core:typecheck: cache hit, replaying logs 9196b67e80bd4067
@erp/contracts:typecheck: cache hit, replaying logs 1d801c0f28f05f21
@erp/domain-core:typecheck: 
@erp/domain-core:typecheck: > @erp/domain-core@0.1.0 typecheck /home/z/my-project/extracted_phase013/packages/domain-core
@erp/domain-core:typecheck: > tsc --noEmit -p tsconfig.json
@erp/domain-core:typecheck: 
@erp/ui:typecheck: cache miss, executing bbf81ba40a83e142
@erp/contracts:typecheck: 
@erp/contracts:typecheck: > @erp/contracts@0.1.0 typecheck /home/z/my-project/extracted_phase013/packages/contracts
@erp/contracts:typecheck: > tsc --noEmit -p tsconfig.json
@erp/contracts:typecheck: 
@erp/web:typecheck: cache miss, executing 41a6f47c2df6b166
@erp/web:typecheck: 
@erp/web:typecheck: > @erp/web@0.1.0 typecheck /home/z/my-project/extracted_phase013/apps/web
@erp/web:typecheck: > tsc --noEmit -p tsconfig.json
@erp/web:typecheck: 
@erp/api:typecheck: 
@erp/api:typecheck: > @erp/api@0.1.0 typecheck /home/z/my-project/extracted_phase013/apps/api
@erp/api:typecheck: > tsc --noEmit -p tsconfig.json
@erp/api:typecheck: 
@erp/ui:typecheck: 
@erp/ui:typecheck: > @erp/ui@1.0.0 typecheck /home/z/my-project/extracted_phase013/packages/ui
@erp/ui:typecheck: > tsc --noEmit -p tsconfig.json
@erp/ui:typecheck: 

 Tasks:    5 successful, 5 total
Cached:    2 cached, 5 total
  Time:    22.977s 

STEP 1 EXIT 0

=== lint (incl. module boundaries) ===

> erp-platform@0.1.0 lint /home/z/my-project/extracted_phase013
> turbo run lint


   • turbo 2.11.10
   • Packages in scope: @erp/api, @erp/config, @erp/contracts, @erp/domain-core, @erp/ui, @erp/web
   • Running lint in 6 packages
   • Remote caching disabled

@erp/ui:lint: cache miss, executing 91df8d7c9ff9f12b
@erp/web:lint: cache miss, executing 72c888a051d4f6f7
@erp/api:lint: cache miss, executing 8579e383ab888abf
@erp/contracts:lint: cache hit, replaying logs f17cc9d8d6167700
@erp/contracts:lint: 
@erp/contracts:lint: > @erp/contracts@0.1.0 lint /home/z/my-project/extracted_phase013/packages/contracts
@erp/contracts:lint: > eslint .
@erp/contracts:lint: 
@erp/domain-core:lint: cache hit, replaying logs 062796cca035fa58
@erp/domain-core:lint: 
@erp/domain-core:lint: > @erp/domain-core@0.1.0 lint /home/z/my-project/extracted_phase013/packages/domain-core
@erp/domain-core:lint: > eslint .
@erp/domain-core:lint: 
@erp/api:lint: 
@erp/api:lint: > @erp/api@0.1.0 lint /home/z/my-project/extracted_phase013/apps/api
@erp/api:lint: > eslint .
@erp/api:lint: 
@erp/ui:lint: 
@erp/ui:lint: > @erp/ui@1.0.0 lint /home/z/my-project/extracted_phase013/packages/ui
@erp/ui:lint: > eslint .
@erp/ui:lint: 
@erp/web:lint: 
@erp/web:lint: > @erp/web@0.1.0 lint /home/z/my-project/extracted_phase013/apps/web
@erp/web:lint: > eslint .
@erp/web:lint: 

 Tasks:    5 successful, 5 total
Cached:    2 cached, 5 total
  Time:    14.299s 

STEP 2 EXIT 0

=== lint:depcruise (dependency graph rules) ===

> erp-platform@0.1.0 lint:depcruise /home/z/my-project/extracted_phase013
> dependency-cruiser apps packages --config .dependency-cruiser.cjs


✔ no dependency violations found (1370 modules, 5066 dependencies cruised)

STEP 3 EXIT 0

=== permissions docs-drift (seed == AUTHORIZATION_MATRIX) ===

> erp-platform@0.1.0 check:permissions-drift /home/z/my-project/extracted_phase013
> tsx scripts/check-permissions-drift.ts

[permissions-drift] OK — matrix 224 keys, seed 224 keys
STEP 4 EXIT 0

=== unit + property tests ===

> erp-platform@0.1.0 test /home/z/my-project/extracted_phase013
> turbo run test


   • turbo 2.11.10
   • Packages in scope: @erp/api, @erp/config, @erp/contracts, @erp/domain-core, @erp/ui, @erp/web
   • Running test in 6 packages
   • Remote caching disabled

@erp/ui:test: cache miss, executing b9656d3ee4f3cbf5
@erp/contracts:test: cache hit, replaying logs 4a90d330e9dfa727
@erp/contracts:test: 
@erp/contracts:test: > @erp/contracts@0.1.0 test /home/z/my-project/extracted_phase013/packages/contracts
@erp/contracts:test: > vitest run
@erp/contracts:test: 
@erp/contracts:test: 
@erp/contracts:test:  RUN  v3.2.7 /home/z/my-project/extracted_phase013/packages/contracts
@erp/contracts:test: 
@erp/contracts:test:  ✓ src/__tests__/contracts.test.ts (11 tests) 25ms
@erp/contracts:test: 
@erp/contracts:test:  Test Files  1 passed (1)
@erp/contracts:test:       Tests  11 passed (11)
@erp/contracts:test:    Start at  21:57:30
@erp/contracts:test:    Duration  1.77s (transform 343ms, setup 0ms, collect 721ms, tests 25ms, environment 0ms, prepare 342ms)
@erp/contracts:test: 
@erp/api:test: cache miss, executing 3308d8d3dde9acb6
@erp/domain-core:test: cache hit, replaying logs 84c578c3aaf9f8ff
@erp/domain-core:test: 
@erp/domain-core:test: > @erp/domain-core@0.1.0 test /home/z/my-project/extracted_phase013/packages/domain-core
@erp/domain-core:test: > vitest run
@erp/domain-core:test: 
@erp/domain-core:test: 
@erp/domain-core:test:  RUN  v3.2.7 /home/z/my-project/extracted_phase013/packages/domain-core
@erp/domain-core:test: 
@erp/domain-core:test:  ✓ src/__tests__/money.test.ts (11 tests) 20ms
@erp/domain-core:test:  ✓ src/__tests__/property.test.ts (6 tests) 292ms
@erp/domain-core:test:  ✓ src/__tests__/quantity-rate.test.ts (7 tests) 7ms
@erp/domain-core:test:  ✓ src/__tests__/calendar-date.test.ts (6 tests) 80ms
@erp/domain-core:test:  ✓ src/__tests__/uuidv7.test.ts (4 tests) 38ms
@erp/domain-core:test:  ✓ src/__tests__/result-errors.test.ts (4 tests) 8ms
@erp/domain-core:test: 
@erp/domain-core:test:  Test Files  6 passed (6)
@erp/domain-core:test:       Tests  38 passed (38)
@erp/domain-core:test:    Start at  21:57:30
@erp/domain-core:test:    Duration  5.03s (transform 369ms, setup 0ms, collect 1.38s, tests 445ms, environment 4ms, prepare 965ms)
@erp/domain-core:test: 
@erp/ui:test: 
@erp/ui:test: > @erp/ui@1.0.0 test /home/z/my-project/extracted_phase013/packages/ui
@erp/ui:test: > vitest run
@erp/ui:test: 
@erp/api:test: 
@erp/api:test: > @erp/api@0.1.0 test /home/z/my-project/extracted_phase013/apps/api
@erp/api:test: > vitest run
@erp/api:test: 
@erp/api:test: 
@erp/api:test:  RUN  v3.2.7 /home/z/my-project/extracted_phase013/apps/api
@erp/api:test: 
@erp/ui:test: 
@erp/ui:test:  RUN  v3.2.7 /home/z/my-project/extracted_phase013/packages/ui
@erp/ui:test: 
@erp/api:test:  ✓ src/modules/inventory/domain/valuation/valuation.spec.ts (12 tests) 136ms
@erp/ui:test:  ✓ src/utils/__tests__/components.test.tsx (17 tests) 636ms
@erp/api:test:  ✓ src/modules/reporting/__tests__/reporting-unit.spec.ts (42 tests) 120ms
@erp/ui:test:  ✓ src/utils/__tests__/behavior.test.ts (21 tests) 20ms
@erp/api:test:  ✓ src/modules/accounting/domain/property.spec.ts (5 tests) 184ms
@erp/ui:test:  ✓ src/tokens/__tests__/tokens.test.ts (4 tests) 6ms
@erp/ui:test: 
@erp/ui:test:  Test Files  3 passed (3)
@erp/ui:test:       Tests  42 passed (42)
@erp/ui:test:    Start at  23:08:49
@erp/ui:test:    Duration  5.57s (transform 474ms, setup 0ms, collect 1.86s, tests 662ms, environment 2.06s, prepare 307ms)
@erp/ui:test: 
@erp/api:test: {"level":30,"time":1793574535012,"service":"erp-api","module":"http","correlation_id":"01a1995f-7f63-7000-81db-24371886670f","action":"request","method":"GET","path":"/health/live","status":200,"duration_ms":1,"msg":"request completed"}
@erp/api:test: {"level":30,"time":1793574535014,"service":"erp-api","module":"http","correlation_id":"aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee","action":"request","method":"GET","path":"/health/live","status":200,"duration_ms":0,"msg":"request completed"}
@erp/api:test: {"level":30,"time":1793574535015,"service":"erp-api","module":"http","correlation_id":"01a1995f-7f66-7000-b0df-6de8e9cec5fe","action":"request","method":"GET","path":"/health/live","status":200,"duration_ms":1,"msg":"request completed"}
@erp/api:test:  ✓ src/infra/observability/request-id.middleware.spec.ts (3 tests) 6ms
@erp/api:test:  ✓ src/modules/identity/infrastructure/permissions-drift.spec.ts (5 tests) 14ms
@erp/api:test:  ✓ src/modules/reporting/__tests__/print-templates.spec.ts (8 tests) 11ms
@erp/api:test:  ✓ src/infra/db/migrations.spec.ts (4 tests) 23ms
@erp/api:test:  ✓ src/modules/accounting/domain/posting-engine/posting-engine.spec.ts (17 tests) 10ms
@erp/api:test:  ✓ src/health/health.controller.spec.ts (4 tests) 10ms
@erp/api:test:  ✓ src/modules/identity/domain/identity-unit.spec.ts (9 tests) 7ms
@erp/api:test:  ✓ src/modules/tenancy/__tests__/billing-unit.spec.ts (11 tests) 6ms
@erp/api:test:  ✓ src/modules/files/application/files.service.spec.ts (5 tests) 6ms
@erp/api:test:  ✓ src/modules/notifications/application/templates.spec.ts (8 tests) 4ms
@erp/api:test:  ✓ src/config/env.spec.ts (3 tests) 5ms
@erp/api:test:  ✓ src/modules/identity/domain/totp.spec.ts (7 tests) 5ms
@erp/api:test:  ✓ src/modules/audit/application/audit.service.spec.ts (4 tests) 5ms
@erp/api:test:  ✓ src/infra/observability/request-context.spec.ts (3 tests) 7ms
@erp/api:test:  ✓ src/infra/db/tenant-context.spec.ts (3 tests) 5ms
@erp/api:test: 
@erp/api:test:  Test Files  18 passed (18)
@erp/api:test:       Tests  153 passed (153)
@erp/api:test:    Start at  23:08:49
@erp/api:test:    Duration  10.87s (transform 1.10s, setup 0ms, collect 6.57s, tests 561ms, environment 3ms, prepare 1.17s)
@erp/api:test: 

 Tasks:    4 successful, 4 total
Cached:    2 cached, 4 total
  Time:    12.127s 

STEP 5 EXIT 0

=== db suite (embedded PostgreSQL 16) ===

> erp-platform@0.1.0 test:db /home/z/my-project/extracted_phase013
> turbo run test:db


   • turbo 2.11.10
   • Packages in scope: @erp/api, @erp/config, @erp/contracts, @erp/domain-core, @erp/ui, @erp/web
   • Running test:db in 6 packages
   • Remote caching disabled

@erp/api:test:db: cache bypass, force executing 549dc09bfb401abd
@erp/api:test:db: 
@erp/api:test:db: > @erp/api@0.1.0 test:db /home/z/my-project/extracted_phase013/apps/api
@erp/api:test:db: > vitest run --config vitest.db.config.ts
@erp/api:test:db: 
@erp/api:test:db: 
@erp/api:test:db:  RUN  v3.2.7 /home/z/my-project/extracted_phase013/apps/api
@erp/api:test:db: 
@erp/api:test:db: The files belonging to this database system will be owned by user "z".
@erp/api:test:db: This user must also own the server process.
@erp/api:test:db: 
@erp/api:test:db: 
@erp/api:test:db: The database cluster will be initialized with locale "C".
@erp/api:test:db: The default database encoding has accordingly been set to "SQL_ASCII".
@erp/api:test:db: The default text search configuration will be set to "english".
@erp/api:test:db: 
@erp/api:test:db: Data page checksums are disabled.
@erp/api:test:db: 
@erp/api:test:db: creating directory /tmp/erp-api-testdb ... ok
@erp/api:test:db: creating subdirectories ... 
@erp/api:test:db: ok
@erp/api:test:db: selecting dynamic shared memory implementation ... posix
@erp/api:test:db: selecting default max_connections ... 
@erp/api:test:db: 100
@erp/api:test:db: selecting default shared_buffers ... 
@erp/api:test:db: 128MB
@erp/api:test:db: selecting default time zone ... 
@erp/api:test:db: Etc/UTC
@erp/api:test:db: creating configuration files ... 
@erp/api:test:db: ok
@erp/api:test:db: running bootstrap script ... 
@erp/api:test:db: ok
@erp/api:test:db: 
@erp/api:test:db: performing post-bootstrap initialization ... 
@erp/api:test:db: ok
@erp/api:test:db: syncing data to disk ... 
@erp/api:test:db: ok
@erp/api:test:db: 
@erp/api:test:db: Success. You can now start the database server using:
@erp/api:test:db: 
@erp/api:test:db:     '/home/z/my-project/extracted_phase013/node_modules/.pnpm/@embedded-postgres+linux-x64@16.14.0-beta.17/node_modules/@embedded-postgres/linux-x64/native/bin/pg_ctl' -D /tmp/erp-api-testdb -l logfile start
@erp/api:test:db: 
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:02.416 UTC [2078] LOG:  starting PostgreSQL 16.14 on x86_64-pc-linux-gnu, compiled by gcc (Ubuntu 7.5.0-3ubuntu1~18.04) 7.5.0, 64-bit
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:02.416 UTC [2078] LOG:  listening on IPv6 address "::1", port 37531
@erp/api:test:db: 2026-11-01 23:09:02.416 UTC [2078] LOG:  listening on IPv4 address "127.0.0.1", port 37531
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:02.417 UTC [2078] LOG:  listening on Unix socket "/tmp/.s.PGSQL.37531"
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:02.418 UTC [2081] LOG:  database system was shut down at 2026-11-01 23:09:02 UTC
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:02.419 UTC [2078] LOG:  database system is ready to accept connections
@erp/api:test:db: 
@erp/api:test:db: {"level":30,"time":1793574545363,"service":"erp-api","module":"jobs","action":"boss-started","msg":"pg-boss queue client started"}
@erp/api:test:db: {"level":30,"time":1793574547374,"service":"erp-api","module":"notifications","template":"invitation","msg":"email delivered"}
@erp/api:test:db: {"level":30,"time":1793574549372,"service":"erp-api","module":"notifications","template":"password_reset","msg":"email delivered"}
@erp/api:test:db: {"level":30,"time":1793574551372,"service":"erp-api","module":"notifications","template":"login_notification","msg":"email delivered"}
@erp/api:test:db: {"level":30,"time":1793574552229,"service":"erp-api","module":"jobs","action":"boss-stopped","msg":"pg-boss queue client stopped"}
@erp/api:test:db:  ✓ src/__db__/notifications-email.db.spec.ts (5 tests) 6900ms
@erp/api:test:db:    ✓ email adapter (real SMTP session + pg-boss idempotency) > renders + delivers the AR invitation with the accept link through the queue  2027ms
@erp/api:test:db:    ✓ email adapter (real SMTP session + pg-boss idempotency) > delivers the EN password reset (30-minute wording + link)  2008ms
@erp/api:test:db:    ✓ email adapter (real SMTP session + pg-boss idempotency) > duplicate enqueue of the same logical email sends exactly once (idempotent handler)  2812ms
@erp/api:test:db:  ✓ src/__db__/inventory/operations.spec.ts (6 tests) 5074ms
@erp/api:test:db:    ✓ CC-04 — the stock-issue race on the last units > two concurrent issues of the last units: one wins, one fails INSUFFICIENT_STOCK  334ms
@erp/api:test:db:    ✓ T-01 — movement ledger + stock queries perf smoke (seeded 100k moves) > indexed queries stay within the local smoke budget at 100k rows  4462ms
@erp/api:test:db: 2026-11-01 23:09:18.069 UTC [2181] ERROR:  new row violates row-level security policy for table "audit_events"
@erp/api:test:db: 2026-11-01 23:09:18.069 UTC [2181] STATEMENT:  INSERT INTO audit_events (id, tenant_id, action, entity_type, entity_id)
@erp/api:test:db: 	     VALUES ('eeeeeeee-3000-4000-8000-000000000003', $1, 'iso.attack', 'iso_fixture', $1)
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:18.076 UTC [2182] ERROR:  permission denied for table audit_events
@erp/api:test:db: 2026-11-01 23:09:18.076 UTC [2182] STATEMENT:  UPDATE audit_events SET action = action WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:18.083 UTC [2183] ERROR:  permission denied for table audit_events
@erp/api:test:db: 2026-11-01 23:09:18.083 UTC [2183] STATEMENT:  DELETE FROM audit_events WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:18.109 UTC [2187] ERROR:  new row violates row-level security policy for table "memberships"
@erp/api:test:db: 2026-11-01 23:09:18.109 UTC [2187] STATEMENT:  INSERT INTO memberships (id, tenant_id, user_id, role_id)
@erp/api:test:db: 	     VALUES ('ffffffff-3000-4000-8000-000000000003', $1,
@erp/api:test:db: 	             'eeeeeeee-0000-4000-8000-000000000002', 'dddddddd-0000-4000-8000-000000000002')
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:18.121 UTC [2189] ERROR:  permission denied for table memberships
@erp/api:test:db: 2026-11-01 23:09:18.121 UTC [2189] STATEMENT:  DELETE FROM memberships WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:18.146 UTC [2193] ERROR:  new row violates row-level security policy for table "invitations"
@erp/api:test:db: 2026-11-01 23:09:18.146 UTC [2193] STATEMENT:  INSERT INTO invitations (id, tenant_id, email, role_id, token_hash, expires_at, invited_by)
@erp/api:test:db: 	     VALUES ('eeeeeeee-4000-4000-8000-000000000003', $1, 'iso-attack@test',
@erp/api:test:db: 	             'dddddddd-0000-4000-8000-000000000002', 'iso-attack-token', now() + interval '72 hours',
@erp/api:test:db: 	             'eeeeeeee-0000-4000-8000-000000000002')
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:18.158 UTC [2195] ERROR:  permission denied for table invitations
@erp/api:test:db: 2026-11-01 23:09:18.158 UTC [2195] STATEMENT:  DELETE FROM invitations WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:18.185 UTC [2199] ERROR:  new row violates row-level security policy for table "roles"
@erp/api:test:db: 2026-11-01 23:09:18.185 UTC [2199] STATEMENT:  INSERT INTO roles (id, tenant_id, key, name)
@erp/api:test:db: 	     VALUES ('dddddddd-3000-4000-8000-000000000003', $1, 'attack_role', 'Attack Role')
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:18.262 UTC [2205] ERROR:  new row violates row-level security policy for table "role_permissions"
@erp/api:test:db: 2026-11-01 23:09:18.262 UTC [2205] STATEMENT:  INSERT INTO role_permissions (role_id, tenant_id, permission_id)
@erp/api:test:db: 	     VALUES ('dddddddd-0000-4000-8000-000000000002', $1, 'partners.view')
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:18.269 UTC [2206] ERROR:  permission denied for table role_permissions
@erp/api:test:db: 2026-11-01 23:09:18.269 UTC [2206] STATEMENT:  UPDATE role_permissions SET granted_at = granted_at WHERE role_id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:18.300 UTC [2211] ERROR:  new row violates row-level security policy for table "branches"
@erp/api:test:db: 2026-11-01 23:09:18.300 UTC [2211] STATEMENT:  INSERT INTO branches (id, tenant_id, code, name)
@erp/api:test:db: 	     VALUES ('abababab-3000-4000-8000-000000000003', $1, 'ATK', 'Attack Branch')
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:18.319 UTC [2213] ERROR:  permission denied for table branches
@erp/api:test:db: 2026-11-01 23:09:18.319 UTC [2213] STATEMENT:  DELETE FROM branches WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:18.345 UTC [2217] ERROR:  new row violates row-level security policy for table "tenant_settings"
@erp/api:test:db: 2026-11-01 23:09:18.345 UTC [2217] STATEMENT:  INSERT INTO tenant_settings (id, tenant_id, key, value)
@erp/api:test:db: 	     VALUES ('acacacac-3000-4000-8000-000000000003', $1, 'sales.credit_limit_action', '"warn"'::jsonb)
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:18.358 UTC [2219] ERROR:  permission denied for table tenant_settings
@erp/api:test:db: 2026-11-01 23:09:18.358 UTC [2219] STATEMENT:  DELETE FROM tenant_settings WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:18.383 UTC [2223] ERROR:  new row violates row-level security policy for table "subscriptions"
@erp/api:test:db: 2026-11-01 23:09:18.383 UTC [2223] STATEMENT:  INSERT INTO subscriptions (id, tenant_id, plan_id, period_start, period_end)
@erp/api:test:db: 	     VALUES ('adadadad-3000-4000-8000-000000000003', $1,
@erp/api:test:db: 	             '30000000-0000-4000-8000-000000000002', '2026-01-01', '2026-12-31')
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:18.397 UTC [2225] ERROR:  permission denied for table subscriptions
@erp/api:test:db: 2026-11-01 23:09:18.397 UTC [2225] STATEMENT:  DELETE FROM subscriptions WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:18.422 UTC [2229] ERROR:  new row violates row-level security policy for table "entitlements"
@erp/api:test:db: 2026-11-01 23:09:18.422 UTC [2229] STATEMENT:  INSERT INTO entitlements (id, tenant_id, feature_key, source)
@erp/api:test:db: 	     VALUES ('aeaeaeae-3000-4000-8000-000000000003', $1, 'pos.sales', 'MANUAL')
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:18.461 UTC [2235] ERROR:  new row violates row-level security policy for table "support_sessions"
@erp/api:test:db: 2026-11-01 23:09:18.461 UTC [2235] STATEMENT:  INSERT INTO support_sessions (id, tenant_id, platform_user_id, opt_in, ticket_ref, reason, expires_at)
@erp/api:test:db: 	     VALUES ('afafafaf-3000-4000-8000-000000000003', $1,
@erp/api:test:db: 	             'eeeeeeee-0000-4000-8000-000000000001', false, 'ISO-ATK', 'attack fixture',
@erp/api:test:db: 	             now() + interval '4 hours')
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:18.473 UTC [2237] ERROR:  permission denied for table support_sessions
@erp/api:test:db: 2026-11-01 23:09:18.473 UTC [2237] STATEMENT:  DELETE FROM support_sessions WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:18.499 UTC [2241] ERROR:  new row violates row-level security policy for table "accounts"
@erp/api:test:db: 2026-11-01 23:09:18.499 UTC [2241] STATEMENT:  INSERT INTO accounts (id, tenant_id, code, name, name_ar, type, is_postable)
@erp/api:test:db: 	     VALUES ('b0b0b0b0-3000-4000-8000-000000000003', $1, '2000', 'Attack Account', 'حساب هجوم', 'ASSET', false)
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:18.511 UTC [2243] ERROR:  permission denied for table accounts
@erp/api:test:db: 2026-11-01 23:09:18.511 UTC [2243] STATEMENT:  DELETE FROM accounts WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:18.537 UTC [2247] ERROR:  new row violates row-level security policy for table "account_purposes"
@erp/api:test:db: 2026-11-01 23:09:18.537 UTC [2247] STATEMENT:  INSERT INTO account_purposes (id, tenant_id, purpose_key, account_id, active_from)
@erp/api:test:db: 	     VALUES ('b1b1b1b1-3000-4000-8000-000000000003', $1, 'AP_CONTROL',
@erp/api:test:db: 	             'b0b0b0b0-0000-4000-8000-000000000002', '2026-01-01')
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:18.551 UTC [2249] ERROR:  permission denied for table account_purposes
@erp/api:test:db: 2026-11-01 23:09:18.551 UTC [2249] STATEMENT:  DELETE FROM account_purposes WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:18.575 UTC [2253] ERROR:  new row violates row-level security policy for table "credit_terms"
@erp/api:test:db: 2026-11-01 23:09:18.575 UTC [2253] STATEMENT:  INSERT INTO credit_terms (id, tenant_id, code, name, days)
@erp/api:test:db: 	     VALUES ('b3b3b3b3-3000-4000-8000-000000000003', $1, 'ATK-NET', 'Attack Terms', 90)
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:18.588 UTC [2255] ERROR:  permission denied for table credit_terms
@erp/api:test:db: 2026-11-01 23:09:18.588 UTC [2255] STATEMENT:  DELETE FROM credit_terms WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:18.624 UTC [2259] ERROR:  new row violates row-level security policy for table "price_lists"
@erp/api:test:db: 2026-11-01 23:09:18.624 UTC [2259] STATEMENT:  INSERT INTO price_lists (id, tenant_id, name, kind, currency_code)
@erp/api:test:db: 	     VALUES ('b4b4b4b4-3000-4000-8000-000000000003', $1, 'Attack List', 'SALE', 'SAR')
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:18.638 UTC [2261] ERROR:  permission denied for table price_lists
@erp/api:test:db: 2026-11-01 23:09:18.638 UTC [2261] STATEMENT:  DELETE FROM price_lists WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:18.667 UTC [2265] ERROR:  new row violates row-level security policy for table "partners"
@erp/api:test:db: 2026-11-01 23:09:18.667 UTC [2265] STATEMENT:  INSERT INTO partners (id, tenant_id, kind, code, name)
@erp/api:test:db: 	     VALUES ('b5b5b5b5-3000-4000-8000-000000000003', $1, 'CUSTOMER', 'ATK-P', 'Attack Partner')
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:18.682 UTC [2267] ERROR:  permission denied for table partners
@erp/api:test:db: 2026-11-01 23:09:18.682 UTC [2267] STATEMENT:  DELETE FROM partners WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:18.709 UTC [2271] ERROR:  new row violates row-level security policy for table "partner_contacts"
@erp/api:test:db: 2026-11-01 23:09:18.709 UTC [2271] STATEMENT:  INSERT INTO partner_contacts (id, tenant_id, partner_id, name)
@erp/api:test:db: 	     VALUES ('b6b6b6b6-3000-4000-8000-000000000003', $1,
@erp/api:test:db: 	             'b5b5b5b5-0000-4000-8000-000000000002', 'Attack Contact')
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:18.721 UTC [2273] ERROR:  permission denied for table partner_contacts
@erp/api:test:db: 2026-11-01 23:09:18.721 UTC [2273] STATEMENT:  DELETE FROM partner_contacts WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:18.749 UTC [2277] ERROR:  new row violates row-level security policy for table "partner_addresses"
@erp/api:test:db: 2026-11-01 23:09:18.749 UTC [2277] STATEMENT:  INSERT INTO partner_addresses (id, tenant_id, partner_id, type, line1)
@erp/api:test:db: 	     VALUES ('b7b7b7b7-3000-4000-8000-000000000003', $1,
@erp/api:test:db: 	             'b5b5b5b5-0000-4000-8000-000000000002', 'SHIPPING', 'Attack Line')
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:18.763 UTC [2279] ERROR:  permission denied for table partner_addresses
@erp/api:test:db: 2026-11-01 23:09:18.763 UTC [2279] STATEMENT:  DELETE FROM partner_addresses WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:18.791 UTC [2283] ERROR:  new row violates row-level security policy for table "item_categories"
@erp/api:test:db: 2026-11-01 23:09:18.791 UTC [2283] STATEMENT:  INSERT INTO item_categories (id, tenant_id, code, name)
@erp/api:test:db: 	     VALUES ('b8b8b8b8-3000-4000-8000-000000000003', $1, 'ATK-CAT', 'Attack Category')
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:18.807 UTC [2285] ERROR:  permission denied for table item_categories
@erp/api:test:db: 2026-11-01 23:09:18.807 UTC [2285] STATEMENT:  DELETE FROM item_categories WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:18.834 UTC [2289] ERROR:  new row violates row-level security policy for table "uoms"
@erp/api:test:db: 2026-11-01 23:09:18.834 UTC [2289] STATEMENT:  INSERT INTO uoms (id, tenant_id, code, name)
@erp/api:test:db: 	     VALUES ('b2b2b2b2-3000-4000-8000-000000000003', $1, 'ATK-U', 'Attack Unit')
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:18.846 UTC [2291] ERROR:  permission denied for table uoms
@erp/api:test:db: 2026-11-01 23:09:18.846 UTC [2291] STATEMENT:  DELETE FROM uoms WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:18.871 UTC [2295] ERROR:  new row violates row-level security policy for table "uom_conversions"
@erp/api:test:db: 2026-11-01 23:09:18.871 UTC [2295] STATEMENT:  INSERT INTO uom_conversions (id, tenant_id, from_uom_id, to_uom_id, factor)
@erp/api:test:db: 	     VALUES ('b9b9b9b9-3000-4000-8000-000000000003', $1,
@erp/api:test:db: 	             'b2b2b2b2-0000-4000-8000-000000000002', 'b2b2b2b2-1000-4000-8000-000000000002', 999)
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:18.883 UTC [2297] ERROR:  permission denied for table uom_conversions
@erp/api:test:db: 2026-11-01 23:09:18.883 UTC [2297] STATEMENT:  DELETE FROM uom_conversions WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:18.907 UTC [2301] ERROR:  new row violates row-level security policy for table "items"
@erp/api:test:db: 2026-11-01 23:09:18.907 UTC [2301] STATEMENT:  INSERT INTO items (id, tenant_id, sku, name, kind, uom_id)
@erp/api:test:db: 	     VALUES ('babababa-3000-4000-8000-000000000003', $1, 'ATK-ITEM', 'Attack Item', 'STOCK',
@erp/api:test:db: 	             'b2b2b2b2-0000-4000-8000-000000000002')
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:18.920 UTC [2303] ERROR:  permission denied for table items
@erp/api:test:db: 2026-11-01 23:09:18.920 UTC [2303] STATEMENT:  DELETE FROM items WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:18.944 UTC [2307] ERROR:  new row violates row-level security policy for table "barcodes"
@erp/api:test:db: 2026-11-01 23:09:18.944 UTC [2307] STATEMENT:  INSERT INTO barcodes (id, tenant_id, item_id, uom_id, code)
@erp/api:test:db: 	     VALUES ('bbbbbbbb-3000-4000-8000-000000000003', $1,
@erp/api:test:db: 	             'babababa-0000-4000-8000-000000000002', 'b2b2b2b2-0000-4000-8000-000000000002', '9999999999999')
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:18.957 UTC [2309] ERROR:  permission denied for table barcodes
@erp/api:test:db: 2026-11-01 23:09:18.957 UTC [2309] STATEMENT:  DELETE FROM barcodes WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:18.982 UTC [2313] ERROR:  new row violates row-level security policy for table "price_list_items"
@erp/api:test:db: 2026-11-01 23:09:18.982 UTC [2313] STATEMENT:  INSERT INTO price_list_items (id, tenant_id, price_list_id, item_id, uom_id, unit_price, min_qty)
@erp/api:test:db: 	     VALUES ('bcbcbcbc-3000-4000-8000-000000000003', $1,
@erp/api:test:db: 	             'b4b4b4b4-0000-4000-8000-000000000002', 'babababa-0000-4000-8000-000000000002',
@erp/api:test:db: 	             'b2b2b2b2-0000-4000-8000-000000000002', 42, 99)
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:18.995 UTC [2315] ERROR:  permission denied for table price_list_items
@erp/api:test:db: 2026-11-01 23:09:18.995 UTC [2315] STATEMENT:  DELETE FROM price_list_items WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:19.019 UTC [2319] ERROR:  new row violates row-level security policy for table "partner_balances"
@erp/api:test:db: 2026-11-01 23:09:19.019 UTC [2319] STATEMENT:  INSERT INTO partner_balances (id, tenant_id, partner_id, draft_balance)
@erp/api:test:db: 	     VALUES ('bdbdbdbd-3000-4000-8000-000000000003', $1,
@erp/api:test:db: 	             'b5b5b5b5-0000-4000-8000-000000000002', 777)
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:19.031 UTC [2321] ERROR:  permission denied for table partner_balances
@erp/api:test:db: 2026-11-01 23:09:19.031 UTC [2321] STATEMENT:  DELETE FROM partner_balances WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:19.055 UTC [2325] ERROR:  new row violates row-level security policy for table "opening_balance_docs"
@erp/api:test:db: 2026-11-01 23:09:19.055 UTC [2325] STATEMENT:  INSERT INTO opening_balance_docs (id, tenant_id, kind, account_id, amount, currency_code)
@erp/api:test:db: 	     VALUES ('bebebebe-3000-4000-8000-000000000003', $1, 'ACCOUNT',
@erp/api:test:db: 	             'b0b0b0b0-0000-4000-8000-000000000002', 100, 'SAR')
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:19.067 UTC [2327] ERROR:  permission denied for table opening_balance_docs
@erp/api:test:db: 2026-11-01 23:09:19.067 UTC [2327] STATEMENT:  DELETE FROM opening_balance_docs WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:19.090 UTC [2331] ERROR:  new row violates row-level security policy for table "file_objects"
@erp/api:test:db: 2026-11-01 23:09:19.090 UTC [2331] STATEMENT:  INSERT INTO file_objects (id, tenant_id, owner_type, owner_id, storage_key, name, size_bytes, content_type)
@erp/api:test:db: 	     VALUES ('bfbfbfbf-3000-4000-8000-000000000003', $1, 'PARTNER',
@erp/api:test:db: 	             'b5b5b5b5-0000-4000-8000-000000000002', 'iso/attack.pdf', 'attack.pdf', 10, 'application/pdf')
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:19.102 UTC [2333] ERROR:  permission denied for table file_objects
@erp/api:test:db: 2026-11-01 23:09:19.102 UTC [2333] STATEMENT:  DELETE FROM file_objects WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:19.126 UTC [2337] ERROR:  new row violates row-level security policy for table "import_jobs"
@erp/api:test:db: 2026-11-01 23:09:19.126 UTC [2337] STATEMENT:  INSERT INTO import_jobs (id, tenant_id, kind, format, upload_token, file_key)
@erp/api:test:db: 	     VALUES ('c0c0c0c0-3000-4000-8000-000000000003', $1, 'ITEMS', 'CSV', 'iso-attack-token',
@erp/api:test:db: 	             'iso/attack.csv')
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:19.138 UTC [2339] ERROR:  permission denied for table import_jobs
@erp/api:test:db: 2026-11-01 23:09:19.138 UTC [2339] STATEMENT:  DELETE FROM import_jobs WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:19.162 UTC [2343] ERROR:  new row violates row-level security policy for table "fiscal_years"
@erp/api:test:db: 2026-11-01 23:09:19.162 UTC [2343] STATEMENT:  INSERT INTO fiscal_years (id, tenant_id, name, start_date, end_date)
@erp/api:test:db: 	     VALUES ('c1c1c1c1-3000-4000-8000-000000000003', $1, 'ATK', '2027-01-01', '2027-12-31')
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:19.174 UTC [2345] ERROR:  permission denied for table fiscal_years
@erp/api:test:db: 2026-11-01 23:09:19.174 UTC [2345] STATEMENT:  DELETE FROM fiscal_years WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:19.198 UTC [2349] ERROR:  new row violates row-level security policy for table "fiscal_periods"
@erp/api:test:db: 2026-11-01 23:09:19.198 UTC [2349] STATEMENT:  INSERT INTO fiscal_periods (id, tenant_id, fiscal_year_id, name, kind, start_date, end_date)
@erp/api:test:db: 	     VALUES ('c2c2c2c2-3000-4000-8000-000000000003', $1, 'c1c1c1c1-0000-4000-8000-000000000002',
@erp/api:test:db: 	             '2027-01', 'REGULAR', '2027-01-01', '2027-01-31')
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:19.212 UTC [2351] ERROR:  permission denied for table fiscal_periods
@erp/api:test:db: 2026-11-01 23:09:19.212 UTC [2351] STATEMENT:  DELETE FROM fiscal_periods WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:19.237 UTC [2355] ERROR:  new row violates row-level security policy for table "exchange_rates"
@erp/api:test:db: 2026-11-01 23:09:19.237 UTC [2355] STATEMENT:  INSERT INTO exchange_rates (id, tenant_id, currency_code, rate_date, rate)
@erp/api:test:db: 	     VALUES ('c3c3c3c3-3000-4000-8000-000000000003', $1, 'EUR', '2026-02-01', 4.05)
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:19.250 UTC [2357] ERROR:  permission denied for table exchange_rates
@erp/api:test:db: 2026-11-01 23:09:19.250 UTC [2357] STATEMENT:  DELETE FROM exchange_rates WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:19.275 UTC [2361] ERROR:  new row violates row-level security policy for table "cost_centers"
@erp/api:test:db: 2026-11-01 23:09:19.275 UTC [2361] STATEMENT:  INSERT INTO cost_centers (id, tenant_id, code, name)
@erp/api:test:db: 	     VALUES ('c4c4c4c4-3000-4000-8000-000000000003', $1, 'ATK', 'Attack Center')
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:19.288 UTC [2363] ERROR:  permission denied for table cost_centers
@erp/api:test:db: 2026-11-01 23:09:19.288 UTC [2363] STATEMENT:  DELETE FROM cost_centers WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:19.312 UTC [2367] ERROR:  new row violates row-level security policy for table "recurring_journals"
@erp/api:test:db: 2026-11-01 23:09:19.312 UTC [2367] STATEMENT:  INSERT INTO recurring_journals (id, tenant_id, name, template, schedule, start_date, next_run_date)
@erp/api:test:db: 	     VALUES ('c5c5c5c5-3000-4000-8000-000000000003', $1, 'ATK', '{"lines": []}'::jsonb,
@erp/api:test:db: 	             'MONTHLY', '2026-02-01', '2026-03-01')
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:19.325 UTC [2369] ERROR:  permission denied for table recurring_journals
@erp/api:test:db: 2026-11-01 23:09:19.325 UTC [2369] STATEMENT:  DELETE FROM recurring_journals WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:19.353 UTC [2373] ERROR:  new row violates row-level security policy for table "approval_policies"
@erp/api:test:db: 2026-11-01 23:09:19.353 UTC [2373] STATEMENT:  INSERT INTO approval_policies (id, tenant_id, doc_type, policy, applies_from)
@erp/api:test:db: 	     VALUES ('c6c6c6c6-3000-4000-8000-000000000003', $1, 'journal_entry',
@erp/api:test:db: 	             '{"mode": "none"}'::jsonb, '2026-02-01')
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:19.365 UTC [2375] ERROR:  permission denied for table approval_policies
@erp/api:test:db: 2026-11-01 23:09:19.365 UTC [2375] STATEMENT:  DELETE FROM approval_policies WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:19.389 UTC [2379] ERROR:  new row violates row-level security policy for table "numbering_sequences"
@erp/api:test:db: 2026-11-01 23:09:19.389 UTC [2379] STATEMENT:  INSERT INTO numbering_sequences (id, tenant_id, doc_type, period_key, next_value)
@erp/api:test:db: 	     VALUES ('c7c7c7c7-3000-4000-8000-000000000003', $1, 'journal_entry', '2027', 1)
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:19.400 UTC [2381] ERROR:  permission denied for table numbering_sequences
@erp/api:test:db: 2026-11-01 23:09:19.400 UTC [2381] STATEMENT:  DELETE FROM numbering_sequences WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:19.424 UTC [2385] ERROR:  new row violates row-level security policy for table "number_assignments"
@erp/api:test:db: 2026-11-01 23:09:19.424 UTC [2385] STATEMENT:  INSERT INTO number_assignments (id, tenant_id, doc_type, period_key, number, value)
@erp/api:test:db: 	     VALUES ('c8c8c8c8-3000-4000-8000-000000000003', $1, 'journal_entry', '2027', 'JE-2027-000001', 1)
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:19.436 UTC [2387] ERROR:  permission denied for table number_assignments
@erp/api:test:db: 2026-11-01 23:09:19.436 UTC [2387] STATEMENT:  DELETE FROM number_assignments WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:19.461 UTC [2391] ERROR:  new row violates row-level security policy for table "manual_journals"
@erp/api:test:db: 2026-11-01 23:09:19.461 UTC [2391] STATEMENT:  INSERT INTO manual_journals (id, tenant_id, status, entry_date, currency_code)
@erp/api:test:db: 	     VALUES ('c9c9c9c9-3000-4000-8000-000000000003', $1, 'DRAFT', '2026-02-05', 'SAR')
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:19.497 UTC [2397] ERROR:  new row violates row-level security policy for table "manual_journal_lines"
@erp/api:test:db: 2026-11-01 23:09:19.497 UTC [2397] STATEMENT:  INSERT INTO manual_journal_lines (id, tenant_id, manual_journal_id, line_no, account_id, direction, amount)
@erp/api:test:db: 	     VALUES ('cacacaca-3000-4000-8000-000000000003', $1, 'c9c9c9c9-0000-4000-8000-000000000002',
@erp/api:test:db: 	             1, 'b0b0b0b0-0000-4000-8000-000000000002', 'DEBIT', 10)
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:19.533 UTC [2403] ERROR:  new row violates row-level security policy for table "journal_templates"
@erp/api:test:db: 2026-11-01 23:09:19.533 UTC [2403] STATEMENT:  INSERT INTO journal_templates (id, tenant_id, name, lines)
@erp/api:test:db: 	     VALUES ('cbcbcbcb-3000-4000-8000-000000000003', $1, 'ATK template', '[{"direction": "DEBIT"}]'::jsonb)
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:19.545 UTC [2405] ERROR:  permission denied for table journal_templates
@erp/api:test:db: 2026-11-01 23:09:19.545 UTC [2405] STATEMENT:  DELETE FROM journal_templates WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:19.569 UTC [2409] ERROR:  new row violates row-level security policy for table "journal_entries"
@erp/api:test:db: 2026-11-01 23:09:19.569 UTC [2409] STATEMENT:  INSERT INTO journal_entries (id, tenant_id, entry_date, fiscal_period_id, currency_code, source_type, operation)
@erp/api:test:db: 	     VALUES ('cccccccc-3000-4000-8000-000000000003', $1, '2026-02-05',
@erp/api:test:db: 	             'c2c2c2c2-0000-4000-8000-000000000002', 'SAR', 'iso_attack', 'post')
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:19.582 UTC [2411] ERROR:  permission denied for table journal_entries
@erp/api:test:db: 2026-11-01 23:09:19.582 UTC [2411] STATEMENT:  DELETE FROM journal_entries WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:19.606 UTC [2415] ERROR:  new row violates row-level security policy for table "journal_lines"
@erp/api:test:db: 2026-11-01 23:09:19.606 UTC [2415] STATEMENT:  INSERT INTO journal_lines (id, tenant_id, journal_entry_id, line_no, account_id, direction, amount, base_amount)
@erp/api:test:db: 	     VALUES ('cdcdcdcd-3000-4000-8000-000000000003', $1, 'cccccccc-0000-4000-8000-000000000002',
@erp/api:test:db: 	             3, 'b0b0b0b0-0000-4000-8000-000000000002', 'DEBIT', 10, 10)
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:19.613 UTC [2416] ERROR:  permission denied for table journal_lines
@erp/api:test:db: 2026-11-01 23:09:19.613 UTC [2416] STATEMENT:  UPDATE journal_lines SET updated_at = updated_at WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:19.620 UTC [2417] ERROR:  permission denied for table journal_lines
@erp/api:test:db: 2026-11-01 23:09:19.620 UTC [2417] STATEMENT:  DELETE FROM journal_lines WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:19.645 UTC [2421] ERROR:  new row violates row-level security policy for table "partner_subledger_entries"
@erp/api:test:db: 2026-11-01 23:09:19.645 UTC [2421] STATEMENT:  INSERT INTO partner_subledger_entries (id, tenant_id, partner_id, journal_entry_id,
@erp/api:test:db: 	                                            journal_line_id, entry_date, direction, amount, base_amount, currency_code, source_type)
@erp/api:test:db: 	     VALUES ('cececece-3000-4000-8000-000000000003', $1, 'b5b5b5b5-0000-4000-8000-000000000002',
@erp/api:test:db: 	             'cccccccc-0000-4000-8000-000000000002', 'cdcdcdcd-0000-4000-8000-000000000002',
@erp/api:test:db: 	             '2026-01-20', 'DEBIT', 10, 10, 'SAR', 'iso_attack')
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:19.651 UTC [2422] ERROR:  permission denied for table partner_subledger_entries
@erp/api:test:db: 2026-11-01 23:09:19.651 UTC [2422] STATEMENT:  UPDATE partner_subledger_entries SET updated_at = updated_at WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:19.657 UTC [2423] ERROR:  permission denied for table partner_subledger_entries
@erp/api:test:db: 2026-11-01 23:09:19.657 UTC [2423] STATEMENT:  DELETE FROM partner_subledger_entries WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:19.681 UTC [2427] ERROR:  new row violates row-level security policy for table "reconciliation_runs"
@erp/api:test:db: 2026-11-01 23:09:19.681 UTC [2427] STATEMENT:  INSERT INTO reconciliation_runs (id, tenant_id, kind, as_of, status, control_balance, subledger_balance)
@erp/api:test:db: 	     VALUES ('cfcfcfcf-3000-4000-8000-000000000003', $1, 'AP', '2026-02-28', 'OK', 0, 0)
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:19.692 UTC [2429] ERROR:  permission denied for table reconciliation_runs
@erp/api:test:db: 2026-11-01 23:09:19.692 UTC [2429] STATEMENT:  DELETE FROM reconciliation_runs WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:19.716 UTC [2433] ERROR:  new row violates row-level security policy for table "cash_accounts"
@erp/api:test:db: 2026-11-01 23:09:19.716 UTC [2433] STATEMENT:  INSERT INTO cash_accounts (id, tenant_id, name, type, account_id, currency_code)
@erp/api:test:db: 	     VALUES ('d0d0d0d0-3000-4000-8000-000000000003', $1, 'Attack Cash', 'CASH',
@erp/api:test:db: 	             'b0b0b0b0-0000-4000-8000-000000000002', 'SAR')
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:19.728 UTC [2435] ERROR:  permission denied for table cash_accounts
@erp/api:test:db: 2026-11-01 23:09:19.728 UTC [2435] STATEMENT:  DELETE FROM cash_accounts WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:19.752 UTC [2439] ERROR:  new row violates row-level security policy for table "cash_movements"
@erp/api:test:db: 2026-11-01 23:09:19.752 UTC [2439] STATEMENT:  INSERT INTO cash_movements (id, tenant_id, cash_account_id, direction, amount, currency_code, exchange_rate, base_amount, source_type, source_id, value_date)
@erp/api:test:db: 	     VALUES ('d2d2d2d2-3000-4000-8000-000000000003', $1, 'd0d0d0d0-0000-4000-8000-000000000002', 'OUT',
@erp/api:test:db: 	             10, 'SAR', 1, 10, 'expense', 'd0d0d0d0-0000-4000-8000-000000000002', '2027-02-01')
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:19.759 UTC [2440] ERROR:  permission denied for table cash_movements
@erp/api:test:db: 2026-11-01 23:09:19.759 UTC [2440] STATEMENT:  UPDATE cash_movements SET memo = memo WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:19.764 UTC [2441] ERROR:  permission denied for table cash_movements
@erp/api:test:db: 2026-11-01 23:09:19.764 UTC [2441] STATEMENT:  DELETE FROM cash_movements WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:19.788 UTC [2445] ERROR:  new row violates row-level security policy for table "receipts"
@erp/api:test:db: 2026-11-01 23:09:19.788 UTC [2445] STATEMENT:  INSERT INTO receipts (id, tenant_id, status, cash_account_id, partner_id, method, currency_code, amount, value_date)
@erp/api:test:db: 	     VALUES ('d3d3d3d3-3000-4000-8000-000000000003', $1, 'DRAFT', 'd0d0d0d0-0000-4000-8000-000000000002',
@erp/api:test:db: 	             'b5b5b5b5-0000-4000-8000-000000000002', 'CASH', 'SAR', 10, '2027-02-01')
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:19.799 UTC [2447] ERROR:  permission denied for table receipts
@erp/api:test:db: 2026-11-01 23:09:19.799 UTC [2447] STATEMENT:  DELETE FROM receipts WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:19.823 UTC [2451] ERROR:  new row violates row-level security policy for table "payments"
@erp/api:test:db: 2026-11-01 23:09:19.823 UTC [2451] STATEMENT:  INSERT INTO payments (id, tenant_id, status, cash_account_id, partner_id, method, currency_code, amount, value_date)
@erp/api:test:db: 	     VALUES ('d4d4d4d4-3000-4000-8000-000000000003', $1, 'DRAFT', 'd0d0d0d0-0000-4000-8000-000000000002',
@erp/api:test:db: 	             'b5b5b5b5-0000-4000-8000-000000000002', 'CASH', 'SAR', 10, '2027-02-01')
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:19.835 UTC [2453] ERROR:  permission denied for table payments
@erp/api:test:db: 2026-11-01 23:09:19.835 UTC [2453] STATEMENT:  DELETE FROM payments WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:19.861 UTC [2457] ERROR:  new row violates row-level security policy for table "treasury_allocations"
@erp/api:test:db: 2026-11-01 23:09:19.861 UTC [2457] STATEMENT:  INSERT INTO treasury_allocations (id, tenant_id, receipt_id, open_item_id, amount)
@erp/api:test:db: 	     VALUES ('d5d5d5d5-3000-4000-8000-000000000003', $1, 'd3d3d3d3-0000-4000-8000-000000000002',
@erp/api:test:db: 	             'cececece-0000-4000-8000-000000000002', 5)
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:19.868 UTC [2458] ERROR:  permission denied for table treasury_allocations
@erp/api:test:db: 2026-11-01 23:09:19.868 UTC [2458] STATEMENT:  UPDATE treasury_allocations SET amount = amount WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:19.898 UTC [2463] ERROR:  new row violates row-level security policy for table "expense_categories"
@erp/api:test:db: 2026-11-01 23:09:19.898 UTC [2463] STATEMENT:  INSERT INTO expense_categories (id, tenant_id, code, name, name_ar, account_id)
@erp/api:test:db: 	     VALUES ('d6d6d6d6-3000-4000-8000-000000000003', $1, 'ATK', 'Attack', 'هجوم',
@erp/api:test:db: 	             'b0b0b0b0-0000-4000-8000-000000000002')
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:19.910 UTC [2465] ERROR:  permission denied for table expense_categories
@erp/api:test:db: 2026-11-01 23:09:19.910 UTC [2465] STATEMENT:  DELETE FROM expense_categories WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:19.933 UTC [2469] ERROR:  new row violates row-level security policy for table "expenses"
@erp/api:test:db: 2026-11-01 23:09:19.933 UTC [2469] STATEMENT:  INSERT INTO expenses (id, tenant_id, status, category_id, cash_account_id, payee_name, currency_code, amount, value_date)
@erp/api:test:db: 	     VALUES ('d7d7d7d7-3000-4000-8000-000000000003', $1, 'DRAFT', 'd6d6d6d6-0000-4000-8000-000000000002',
@erp/api:test:db: 	             'd0d0d0d0-0000-4000-8000-000000000002', 'Attack Payee', 'SAR', 10, '2027-02-01')
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:19.945 UTC [2471] ERROR:  permission denied for table expenses
@erp/api:test:db: 2026-11-01 23:09:19.945 UTC [2471] STATEMENT:  DELETE FROM expenses WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:19.968 UTC [2475] ERROR:  new row violates row-level security policy for table "cash_transfers"
@erp/api:test:db: 2026-11-01 23:09:19.968 UTC [2475] STATEMENT:  INSERT INTO cash_transfers (id, tenant_id, status, from_account_id, to_account_id, currency_code, amount, fee_amount, value_date)
@erp/api:test:db: 	     VALUES ('d8d8d8d8-3000-4000-8000-000000000003', $1, 'DRAFT', 'd0d0d0d0-0000-4000-8000-000000000002',
@erp/api:test:db: 	             'd1d1d1d1-0000-4000-8000-000000000002', 'SAR', 10, 0, '2027-02-01')
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:19.980 UTC [2477] ERROR:  permission denied for table cash_transfers
@erp/api:test:db: 2026-11-01 23:09:19.980 UTC [2477] STATEMENT:  DELETE FROM cash_transfers WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:20.004 UTC [2481] ERROR:  new row violates row-level security policy for table "cashier_shifts"
@erp/api:test:db: 2026-11-01 23:09:20.004 UTC [2481] STATEMENT:  INSERT INTO cashier_shifts (id, tenant_id, status, cash_account_id, currency_code, opening_amount)
@erp/api:test:db: 	     VALUES ('d9d9d9d9-3000-4000-8000-000000000003', $1, 'OPEN', 'd0d0d0d0-0000-4000-8000-000000000002',
@erp/api:test:db: 	             'SAR', 10)
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:20.016 UTC [2483] ERROR:  permission denied for table cashier_shifts
@erp/api:test:db: 2026-11-01 23:09:20.016 UTC [2483] STATEMENT:  DELETE FROM cashier_shifts WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:20.039 UTC [2487] ERROR:  new row violates row-level security policy for table "bank_statements"
@erp/api:test:db: 2026-11-01 23:09:20.039 UTC [2487] STATEMENT:  INSERT INTO bank_statements (id, tenant_id, status, cash_account_id, period_start, period_end, file_name, file_hash, adapter_id)
@erp/api:test:db: 	     VALUES ('dadadada-3000-4000-8000-000000000003', $1, 'IMPORTED', 'd1d1d1d1-0000-4000-8000-000000000002',
@erp/api:test:db: 	             '2027-02-01', '2027-02-28', 'attack.csv', repeat('c', 64), 'generic-csv')
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:20.051 UTC [2489] ERROR:  permission denied for table bank_statements
@erp/api:test:db: 2026-11-01 23:09:20.051 UTC [2489] STATEMENT:  DELETE FROM bank_statements WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:20.074 UTC [2493] ERROR:  new row violates row-level security policy for table "bank_statement_lines"
@erp/api:test:db: 2026-11-01 23:09:20.074 UTC [2493] STATEMENT:  INSERT INTO bank_statement_lines (id, tenant_id, bank_statement_id, line_no, line_date, amount)
@erp/api:test:db: 	     VALUES ('dbdbdbdb-3000-4000-8000-000000000003', $1, 'dadadada-0000-4000-8000-000000000002',
@erp/api:test:db: 	             2, '2027-02-05', 25)
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:20.086 UTC [2495] ERROR:  permission denied for table bank_statement_lines
@erp/api:test:db: 2026-11-01 23:09:20.086 UTC [2495] STATEMENT:  DELETE FROM bank_statement_lines WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:20.109 UTC [2499] ERROR:  new row violates row-level security policy for table "tax_codes"
@erp/api:test:db: 2026-11-01 23:09:20.109 UTC [2499] STATEMENT:  INSERT INTO tax_codes (id, tenant_id, code, name, country_code, default_treatment)
@erp/api:test:db: 	     VALUES ('e0e0e0e0-3000-4000-8000-000000000003', $1, 'ATK-INS', 'Attack Insert', 'SA', 'STANDARD_RATED')
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:20.122 UTC [2501] ERROR:  permission denied for table tax_codes
@erp/api:test:db: 2026-11-01 23:09:20.122 UTC [2501] STATEMENT:  DELETE FROM tax_codes WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:20.149 UTC [2505] ERROR:  new row violates row-level security policy for table "tax_registrations"
@erp/api:test:db: 2026-11-01 23:09:20.149 UTC [2505] STATEMENT:  INSERT INTO tax_registrations (id, tenant_id, country_code, status, registration_number, effective_from)
@erp/api:test:db: 	     VALUES ('e1e1e1e1-3000-4000-8000-000000000003', $1, 'SA', 'REGISTERED', '300000000000009', '2026-01-01')
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:20.162 UTC [2507] ERROR:  permission denied for table tax_registrations
@erp/api:test:db: 2026-11-01 23:09:20.162 UTC [2507] STATEMENT:  DELETE FROM tax_registrations WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:20.185 UTC [2511] ERROR:  new row violates row-level security policy for table "tax_pack_bindings"
@erp/api:test:db: 2026-11-01 23:09:20.185 UTC [2511] STATEMENT:  INSERT INTO tax_pack_bindings (id, tenant_id, country_code, pack_version)
@erp/api:test:db: 	     VALUES ('e2e2e2e2-3000-4000-8000-000000000003', $1, 'SA', '1.0.0-baseline')
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:20.197 UTC [2513] ERROR:  permission denied for table tax_pack_bindings
@erp/api:test:db: 2026-11-01 23:09:20.197 UTC [2513] STATEMENT:  DELETE FROM tax_pack_bindings WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:20.222 UTC [2517] ERROR:  new row violates row-level security policy for table "tax_document_summaries"
@erp/api:test:db: 2026-11-01 23:09:20.222 UTC [2517] STATEMENT:  INSERT INTO tax_document_summaries (id, tenant_id, source_type, source_id, document_date,
@erp/api:test:db: 	        country_code, direction, treatment, rate, taxable_base, tax_amount, snapshot, tax_code_id)
@erp/api:test:db: 	     VALUES ('e3e3e3e3-3000-4000-8000-000000000003', $1, 'iso_fixture', $1, '2027-02-01', 'SA',
@erp/api:test:db: 	        'INPUT', 'STANDARD_RATED', 15.0000, 100, 15, '{"treatment":"STANDARD_RATED"}'::jsonb,
@erp/api:test:db: 	        'e0e0e0e0-0000-4000-8000-000000000002')
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:20.228 UTC [2518] ERROR:  permission denied for table tax_document_summaries
@erp/api:test:db: 2026-11-01 23:09:20.228 UTC [2518] STATEMENT:  UPDATE tax_document_summaries SET taxable_base = taxable_base WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:20.234 UTC [2519] ERROR:  permission denied for table tax_document_summaries
@erp/api:test:db: 2026-11-01 23:09:20.234 UTC [2519] STATEMENT:  DELETE FROM tax_document_summaries WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:20.259 UTC [2523] ERROR:  new row violates row-level security policy for table "vat_returns"
@erp/api:test:db: 2026-11-01 23:09:20.259 UTC [2523] STATEMENT:  INSERT INTO vat_returns (id, tenant_id, country_code, period_start, period_end, summary, cross_check)
@erp/api:test:db: 	     VALUES ('e4e4e4e4-3000-4000-8000-000000000003', $1, 'SA', '2027-02-01', '2027-02-28', '{}'::jsonb, '{}'::jsonb)
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:20.272 UTC [2525] ERROR:  permission denied for table vat_returns
@erp/api:test:db: 2026-11-01 23:09:20.272 UTC [2525] STATEMENT:  DELETE FROM vat_returns WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:20.296 UTC [2529] ERROR:  new row violates row-level security policy for table "e_invoicing_submissions"
@erp/api:test:db: 2026-11-01 23:09:20.296 UTC [2529] STATEMENT:  INSERT INTO e_invoicing_submissions (id, tenant_id, country_code, adapter_id, source_type, source_id, status)
@erp/api:test:db: 	     VALUES ('e5e5e5e5-3000-4000-8000-000000000003', $1, 'SA', 'fake', 'iso_fixture', $1, 'PENDING')
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:20.308 UTC [2531] ERROR:  permission denied for table e_invoicing_submissions
@erp/api:test:db: 2026-11-01 23:09:20.308 UTC [2531] STATEMENT:  DELETE FROM e_invoicing_submissions WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:20.332 UTC [2535] ERROR:  new row violates row-level security policy for table "warehouses"
@erp/api:test:db: 2026-11-01 23:09:20.332 UTC [2535] STATEMENT:  INSERT INTO warehouses (id, tenant_id, branch_id, code, name)
@erp/api:test:db: 	     VALUES ('f0f0f0f0-3000-4000-8000-000000000003', $1,
@erp/api:test:db: 	             'abababab-0000-4000-8000-000000000002', 'ATK', 'Attack WH')
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:20.344 UTC [2537] ERROR:  permission denied for table warehouses
@erp/api:test:db: 2026-11-01 23:09:20.344 UTC [2537] STATEMENT:  DELETE FROM warehouses WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:20.368 UTC [2541] ERROR:  new row violates row-level security policy for table "item_warehouse_settings"
@erp/api:test:db: 2026-11-01 23:09:20.368 UTC [2541] STATEMENT:  INSERT INTO item_warehouse_settings (id, tenant_id, item_id, warehouse_id, reorder_level, min_qty)
@erp/api:test:db: 	     VALUES ('f1f1f1f1-3000-4000-8000-000000000003', $1, 'babababa-0000-4000-8000-000000000002',
@erp/api:test:db: 	             'f0f0f0f0-2000-4000-8000-000000000002', 5, 2)
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:20.380 UTC [2543] ERROR:  permission denied for table item_warehouse_settings
@erp/api:test:db: 2026-11-01 23:09:20.380 UTC [2543] STATEMENT:  DELETE FROM item_warehouse_settings WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:20.406 UTC [2547] ERROR:  new row violates row-level security policy for table "stock_moves"
@erp/api:test:db: 2026-11-01 23:09:20.406 UTC [2547] STATEMENT:  INSERT INTO stock_moves (id, tenant_id, item_id, warehouse_id, direction, move_kind, qty, unit_cost, value_amount, source_type, source_id, moved_at)
@erp/api:test:db: 	     VALUES ('f4f4f4f4-3000-4000-8000-000000000003', $1, 'babababa-0000-4000-8000-000000000002',
@erp/api:test:db: 	             'f0f0f0f0-2000-4000-8000-000000000002', 'IN', 'receipt', 10, 2.5, 25,
@erp/api:test:db: 	             'manual_receipt', 'f4f4f4f4-3000-4000-8000-000000000003', '2027-01-05')
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:20.412 UTC [2548] ERROR:  permission denied for table stock_moves
@erp/api:test:db: 2026-11-01 23:09:20.412 UTC [2548] STATEMENT:  UPDATE stock_moves SET memo = memo WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:20.419 UTC [2549] ERROR:  permission denied for table stock_moves
@erp/api:test:db: 2026-11-01 23:09:20.419 UTC [2549] STATEMENT:  DELETE FROM stock_moves WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:20.444 UTC [2553] ERROR:  new row violates row-level security policy for table "stock_layers"
@erp/api:test:db: 2026-11-01 23:09:20.444 UTC [2553] STATEMENT:  INSERT INTO stock_layers (id, tenant_id, item_id, warehouse_id, remaining_qty, unit_cost, source_move_id, received_at)
@erp/api:test:db: 	     VALUES ('f5f5f5f5-3000-4000-8000-000000000003', $1, 'babababa-0000-4000-8000-000000000002',
@erp/api:test:db: 	             'f0f0f0f0-2000-4000-8000-000000000002', 10, 2.5,
@erp/api:test:db: 	             'f4f4f4f4-3000-4000-8000-000000000003', '2027-01-05')
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:20.457 UTC [2555] ERROR:  permission denied for table stock_layers
@erp/api:test:db: 2026-11-01 23:09:20.457 UTC [2555] STATEMENT:  DELETE FROM stock_layers WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:20.480 UTC [2559] ERROR:  new row violates row-level security policy for table "item_stock"
@erp/api:test:db: 2026-11-01 23:09:20.480 UTC [2559] STATEMENT:  INSERT INTO item_stock (id, tenant_id, item_id, warehouse_id, qty, avg_cost)
@erp/api:test:db: 	     VALUES ('f6f6f6f6-3000-4000-8000-000000000003', $1, 'babababa-0000-4000-8000-000000000002',
@erp/api:test:db: 	             'f0f0f0f0-2000-4000-8000-000000000002', 10, 2.5)
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:20.492 UTC [2561] ERROR:  permission denied for table item_stock
@erp/api:test:db: 2026-11-01 23:09:20.492 UTC [2561] STATEMENT:  DELETE FROM item_stock WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:20.515 UTC [2565] ERROR:  new row violates row-level security policy for table "stock_transfers"
@erp/api:test:db: 2026-11-01 23:09:20.515 UTC [2565] STATEMENT:  INSERT INTO stock_transfers (id, tenant_id, from_warehouse_id, to_warehouse_id, status)
@erp/api:test:db: 	     VALUES ('f7f7f7f7-3000-4000-8000-000000000003', $1, 'f0f0f0f0-1000-4000-8000-000000000002',
@erp/api:test:db: 	             'f0f0f0f0-2000-4000-8000-000000000002', 'DRAFT')
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:20.527 UTC [2567] ERROR:  permission denied for table stock_transfers
@erp/api:test:db: 2026-11-01 23:09:20.527 UTC [2567] STATEMENT:  DELETE FROM stock_transfers WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:20.551 UTC [2571] ERROR:  new row violates row-level security policy for table "stock_transfer_lines"
@erp/api:test:db: 2026-11-01 23:09:20.551 UTC [2571] STATEMENT:  INSERT INTO stock_transfer_lines (id, tenant_id, transfer_id, line_no, item_id, qty)
@erp/api:test:db: 	     VALUES ('f8f8f8f8-3000-4000-8000-000000000003', $1, 'f7f7f7f7-0000-4000-8000-000000000002', 2,
@erp/api:test:db: 	             'babababa-0000-4000-8000-000000000002', 4)
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:20.563 UTC [2573] ERROR:  permission denied for table stock_transfer_lines
@erp/api:test:db: 2026-11-01 23:09:20.563 UTC [2573] STATEMENT:  DELETE FROM stock_transfer_lines WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:20.586 UTC [2577] ERROR:  new row violates row-level security policy for table "stock_adjustments"
@erp/api:test:db: 2026-11-01 23:09:20.586 UTC [2577] STATEMENT:  INSERT INTO stock_adjustments (id, tenant_id, warehouse_id, item_id, reason, delta_qty)
@erp/api:test:db: 	     VALUES ('f9f9f9f9-3000-4000-8000-000000000003', $1, 'f0f0f0f0-2000-4000-8000-000000000002',
@erp/api:test:db: 	             'babababa-0000-4000-8000-000000000002', 'DAMAGE', -1)
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:20.598 UTC [2579] ERROR:  permission denied for table stock_adjustments
@erp/api:test:db: 2026-11-01 23:09:20.598 UTC [2579] STATEMENT:  DELETE FROM stock_adjustments WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:20.622 UTC [2583] ERROR:  new row violates row-level security policy for table "stock_reservations"
@erp/api:test:db: 2026-11-01 23:09:20.622 UTC [2583] STATEMENT:  INSERT INTO stock_reservations (id, tenant_id, item_id, warehouse_id, qty, holder_type)
@erp/api:test:db: 	     VALUES ('fafafafa-3000-4000-8000-000000000003', $1, 'babababa-0000-4000-8000-000000000002',
@erp/api:test:db: 	             'f0f0f0f0-2000-4000-8000-000000000002', 2, 'MANUAL')
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:20.634 UTC [2585] ERROR:  permission denied for table stock_reservations
@erp/api:test:db: 2026-11-01 23:09:20.634 UTC [2585] STATEMENT:  DELETE FROM stock_reservations WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:20.658 UTC [2589] ERROR:  new row violates row-level security policy for table "item_batches"
@erp/api:test:db: 2026-11-01 23:09:20.658 UTC [2589] STATEMENT:  INSERT INTO item_batches (id, tenant_id, item_id, batch_no)
@erp/api:test:db: 	     VALUES ('f2f2f2f2-3000-4000-8000-000000000003', $1, 'babababa-0000-4000-8000-000000000002', 'ATK-B')
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:20.670 UTC [2591] ERROR:  permission denied for table item_batches
@erp/api:test:db: 2026-11-01 23:09:20.670 UTC [2591] STATEMENT:  DELETE FROM item_batches WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:20.694 UTC [2595] ERROR:  new row violates row-level security policy for table "item_serials"
@erp/api:test:db: 2026-11-01 23:09:20.694 UTC [2595] STATEMENT:  INSERT INTO item_serials (id, tenant_id, item_id, serial_no)
@erp/api:test:db: 	     VALUES ('f3f3f3f3-3000-4000-8000-000000000003', $1, 'babababa-0000-4000-8000-000000000002', 'ATK-SN')
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:20.707 UTC [2597] ERROR:  permission denied for table item_serials
@erp/api:test:db: 2026-11-01 23:09:20.707 UTC [2597] STATEMENT:  DELETE FROM item_serials WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:20.731 UTC [2601] ERROR:  new row violates row-level security policy for table "stock_counts"
@erp/api:test:db: 2026-11-01 23:09:20.731 UTC [2601] STATEMENT:  INSERT INTO stock_counts (id, tenant_id, warehouse_id, status, snapshot_at)
@erp/api:test:db: 	     VALUES ('fbfbfbfb-3000-4000-8000-000000000003', $1, 'f0f0f0f0-2000-4000-8000-000000000002',
@erp/api:test:db: 	             'DRAFT', '2027-01-10T09:00:00Z')
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:20.743 UTC [2603] ERROR:  permission denied for table stock_counts
@erp/api:test:db: 2026-11-01 23:09:20.743 UTC [2603] STATEMENT:  DELETE FROM stock_counts WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:20.771 UTC [2607] ERROR:  new row violates row-level security policy for table "stock_count_lines"
@erp/api:test:db: 2026-11-01 23:09:20.771 UTC [2607] STATEMENT:  INSERT INTO stock_count_lines (id, tenant_id, stock_count_id, line_no, item_id, batch_id, system_qty)
@erp/api:test:db: 	     VALUES ('fcfcfcfc-3000-4000-8000-000000000003', $1, 'fbfbfbfb-0000-4000-8000-000000000002', 2,
@erp/api:test:db: 	             'babababa-0000-4000-8000-000000000002', 'f2f2f2f2-0000-4000-8000-000000000002', 10)
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:20.783 UTC [2609] ERROR:  permission denied for table stock_count_lines
@erp/api:test:db: 2026-11-01 23:09:20.783 UTC [2609] STATEMENT:  DELETE FROM stock_count_lines WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:20.806 UTC [2613] ERROR:  new row violates row-level security policy for table "purchase_requests"
@erp/api:test:db: 2026-11-01 23:09:20.806 UTC [2613] STATEMENT:  INSERT INTO purchase_requests (id, tenant_id, branch_id, status)
@erp/api:test:db: 	     VALUES ('5a5a5a5a-3000-4000-8000-000000000003', $1, 'abababab-0000-4000-8000-000000000002', 'DRAFT')
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:20.818 UTC [2615] ERROR:  permission denied for table purchase_requests
@erp/api:test:db: 2026-11-01 23:09:20.818 UTC [2615] STATEMENT:  DELETE FROM purchase_requests WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:20.841 UTC [2619] ERROR:  new row violates row-level security policy for table "purchase_request_lines"
@erp/api:test:db: 2026-11-01 23:09:20.841 UTC [2619] STATEMENT:  INSERT INTO purchase_request_lines (id, tenant_id, request_id, line_no, item_id, qty)
@erp/api:test:db: 	     VALUES ('5b5b5b5b-3000-4000-8000-000000000003', $1, '5a5a5a5a-0000-4000-8000-000000000002', 2,
@erp/api:test:db: 	             'babababa-0000-4000-8000-000000000002', 5)
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:20.853 UTC [2621] ERROR:  permission denied for table purchase_request_lines
@erp/api:test:db: 2026-11-01 23:09:20.853 UTC [2621] STATEMENT:  DELETE FROM purchase_request_lines WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:20.876 UTC [2625] ERROR:  new row violates row-level security policy for table "purchase_orders"
@erp/api:test:db: 2026-11-01 23:09:20.876 UTC [2625] STATEMENT:  INSERT INTO purchase_orders (id, tenant_id, branch_id, supplier_id, order_date, currency_code, status)
@erp/api:test:db: 	     VALUES ('5c5c5c5c-3000-4000-8000-000000000003', $1, 'abababab-0000-4000-8000-000000000002',
@erp/api:test:db: 	             'b5b5b5b5-0000-4000-8000-000000000002', '2027-02-01', 'SAR', 'DRAFT')
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:20.888 UTC [2627] ERROR:  permission denied for table purchase_orders
@erp/api:test:db: 2026-11-01 23:09:20.888 UTC [2627] STATEMENT:  DELETE FROM purchase_orders WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:20.914 UTC [2631] ERROR:  new row violates row-level security policy for table "purchase_order_lines"
@erp/api:test:db: 2026-11-01 23:09:20.914 UTC [2631] STATEMENT:  INSERT INTO purchase_order_lines (id, tenant_id, order_id, line_no, item_id, qty, unit_price, net_amount)
@erp/api:test:db: 	     VALUES ('5d5d5d5d-3000-4000-8000-000000000003', $1, '5c5c5c5c-0000-4000-8000-000000000002', 2,
@erp/api:test:db: 	             'babababa-0000-4000-8000-000000000002', 5, 2.5, 12.5)
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:20.925 UTC [2633] ERROR:  permission denied for table purchase_order_lines
@erp/api:test:db: 2026-11-01 23:09:20.925 UTC [2633] STATEMENT:  DELETE FROM purchase_order_lines WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:20.949 UTC [2637] ERROR:  new row violates row-level security policy for table "goods_receipts"
@erp/api:test:db: 2026-11-01 23:09:20.949 UTC [2637] STATEMENT:  INSERT INTO goods_receipts (id, tenant_id, branch_id, supplier_id, po_id, warehouse_id, receipt_date, status)
@erp/api:test:db: 	     VALUES ('5e5e5e5e-3000-4000-8000-000000000003', $1, 'abababab-0000-4000-8000-000000000002',
@erp/api:test:db: 	             'b5b5b5b5-0000-4000-8000-000000000002', '5c5c5c5c-0000-4000-8000-000000000002',
@erp/api:test:db: 	             'f0f0f0f0-2000-4000-8000-000000000002', '2027-02-05', 'DRAFT')
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:20.961 UTC [2639] ERROR:  permission denied for table goods_receipts
@erp/api:test:db: 2026-11-01 23:09:20.961 UTC [2639] STATEMENT:  DELETE FROM goods_receipts WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:20.984 UTC [2643] ERROR:  new row violates row-level security policy for table "goods_receipt_lines"
@erp/api:test:db: 2026-11-01 23:09:20.984 UTC [2643] STATEMENT:  INSERT INTO goods_receipt_lines (id, tenant_id, receipt_id, line_no, item_id, qty, unit_cost, value_amount)
@erp/api:test:db: 	     VALUES ('5f5f5f5f-3000-4000-8000-000000000003', $1, '5e5e5e5e-0000-4000-8000-000000000002', 2,
@erp/api:test:db: 	             'babababa-0000-4000-8000-000000000002', 5, 2.5, 12.5)
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:20.996 UTC [2645] ERROR:  permission denied for table goods_receipt_lines
@erp/api:test:db: 2026-11-01 23:09:20.996 UTC [2645] STATEMENT:  DELETE FROM goods_receipt_lines WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:21.019 UTC [2649] ERROR:  new row violates row-level security policy for table "supplier_invoices"
@erp/api:test:db: 2026-11-01 23:09:21.019 UTC [2649] STATEMENT:  INSERT INTO supplier_invoices (id, tenant_id, branch_id, supplier_id, invoice_no, invoice_date, due_date, currency_code, status)
@erp/api:test:db: 	     VALUES ('60606060-3000-4000-8000-000000000003', $1, 'abababab-0000-4000-8000-000000000002',
@erp/api:test:db: 	             'b5b5b5b5-0000-4000-8000-000000000002', 'ATK-001', '2027-02-10', '2027-03-12', 'SAR', 'DRAFT')
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:21.032 UTC [2651] ERROR:  permission denied for table supplier_invoices
@erp/api:test:db: 2026-11-01 23:09:21.032 UTC [2651] STATEMENT:  DELETE FROM supplier_invoices WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:21.056 UTC [2655] ERROR:  new row violates row-level security policy for table "supplier_invoice_lines"
@erp/api:test:db: 2026-11-01 23:09:21.056 UTC [2655] STATEMENT:  INSERT INTO supplier_invoice_lines (id, tenant_id, invoice_id, line_no, item_id, qty, unit_price, net_amount)
@erp/api:test:db: 	     VALUES ('61616161-3000-4000-8000-000000000003', $1, '60606060-0000-4000-8000-000000000002', 2,
@erp/api:test:db: 	             'babababa-0000-4000-8000-000000000002', 5, 2.5, 12.5)
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:21.068 UTC [2657] ERROR:  permission denied for table supplier_invoice_lines
@erp/api:test:db: 2026-11-01 23:09:21.068 UTC [2657] STATEMENT:  DELETE FROM supplier_invoice_lines WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:21.091 UTC [2661] ERROR:  new row violates row-level security policy for table "debit_notes"
@erp/api:test:db: 2026-11-01 23:09:21.091 UTC [2661] STATEMENT:  INSERT INTO debit_notes (id, tenant_id, branch_id, supplier_id, ref_invoice_id, note_date, currency_code, status)
@erp/api:test:db: 	     VALUES ('62626262-3000-4000-8000-000000000003', $1, 'abababab-0000-4000-8000-000000000002',
@erp/api:test:db: 	             'b5b5b5b5-0000-4000-8000-000000000002', '60606060-0000-4000-8000-000000000002', '2027-02-15', 'SAR', 'DRAFT')
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:21.103 UTC [2663] ERROR:  permission denied for table debit_notes
@erp/api:test:db: 2026-11-01 23:09:21.103 UTC [2663] STATEMENT:  DELETE FROM debit_notes WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:21.128 UTC [2667] ERROR:  new row violates row-level security policy for table "debit_note_lines"
@erp/api:test:db: 2026-11-01 23:09:21.128 UTC [2667] STATEMENT:  INSERT INTO debit_note_lines (id, tenant_id, note_id, line_no, item_id, qty, unit_price, net_amount)
@erp/api:test:db: 	     VALUES ('63636363-3000-4000-8000-000000000003', $1, '62626262-0000-4000-8000-000000000002', 2,
@erp/api:test:db: 	             'babababa-0000-4000-8000-000000000002', 1, 1, 1)
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:21.140 UTC [2669] ERROR:  permission denied for table debit_note_lines
@erp/api:test:db: 2026-11-01 23:09:21.140 UTC [2669] STATEMENT:  DELETE FROM debit_note_lines WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:21.169 UTC [2673] ERROR:  new row violates row-level security policy for table "landed_costs"
@erp/api:test:db: 2026-11-01 23:09:21.169 UTC [2673] STATEMENT:  INSERT INTO landed_costs (id, tenant_id, grn_id, cost_type, amount, allocation_method, charge_account_id, status)
@erp/api:test:db: 	     VALUES ('64646464-3000-4000-8000-000000000003', $1, '5e5e5e5e-0000-4000-8000-000000000002',
@erp/api:test:db: 	             'freight', 2, 'VALUE', 'b0b0b0b0-0000-4000-8000-000000000002', 'DRAFT')
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:21.181 UTC [2675] ERROR:  permission denied for table landed_costs
@erp/api:test:db: 2026-11-01 23:09:21.181 UTC [2675] STATEMENT:  DELETE FROM landed_costs WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:21.205 UTC [2679] ERROR:  new row violates row-level security policy for table "landed_cost_allocations"
@erp/api:test:db: 2026-11-01 23:09:21.205 UTC [2679] STATEMENT:  INSERT INTO landed_cost_allocations (id, tenant_id, landed_cost_id, grn_line_id, item_id, warehouse_id, qty_at_allocation, remaining_qty, allocated_amount)
@erp/api:test:db: 	     VALUES ('65656565-3000-4000-8000-000000000003', $1, '64646464-0000-4000-8000-000000000002',
@erp/api:test:db: 	             '5f5f5f5f-0000-4000-8000-000000000002', 'babababa-0000-4000-8000-000000000002',
@erp/api:test:db: 	             'f0f0f0f0-2000-4000-8000-000000000002', 5, 5, 2)
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:21.217 UTC [2681] ERROR:  permission denied for table landed_cost_allocations
@erp/api:test:db: 2026-11-01 23:09:21.217 UTC [2681] STATEMENT:  DELETE FROM landed_cost_allocations WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:21.242 UTC [2685] ERROR:  new row violates row-level security policy for table "purchase_reallocations"
@erp/api:test:db: 2026-11-01 23:09:21.242 UTC [2685] STATEMENT:  INSERT INTO purchase_reallocations (id, tenant_id, doc_no, payment_id, supplier_id, reason, total_amount)
@erp/api:test:db: 	     VALUES ('66666666-3000-4000-8000-000000000003', $1, 'RAL-ATK-1', 'd4d4d4d4-0000-4000-8000-000000000002',
@erp/api:test:db: 	             'b5b5b5b5-0000-4000-8000-000000000002', 'attack re-allocation', 1)
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:21.248 UTC [2686] ERROR:  permission denied for table purchase_reallocations
@erp/api:test:db: 2026-11-01 23:09:21.248 UTC [2686] STATEMENT:  UPDATE purchase_reallocations SET reason = reason WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:21.254 UTC [2687] ERROR:  permission denied for table purchase_reallocations
@erp/api:test:db: 2026-11-01 23:09:21.254 UTC [2687] STATEMENT:  DELETE FROM purchase_reallocations WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:21.278 UTC [2691] ERROR:  new row violates row-level security policy for table "purchase_reallocation_lines"
@erp/api:test:db: 2026-11-01 23:09:21.278 UTC [2691] STATEMENT:  INSERT INTO purchase_reallocation_lines (id, tenant_id, reallocation_id, line_no, to_open_item_id, amount)
@erp/api:test:db: 	     VALUES ('67676767-3000-4000-8000-000000000003', $1, '66666666-0000-4000-8000-000000000002', 2,
@erp/api:test:db: 	             'cececece-0000-4000-8000-000000000002', 1)
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:21.284 UTC [2692] ERROR:  permission denied for table purchase_reallocation_lines
@erp/api:test:db: 2026-11-01 23:09:21.284 UTC [2692] STATEMENT:  UPDATE purchase_reallocation_lines SET amount = amount WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:21.290 UTC [2693] ERROR:  permission denied for table purchase_reallocation_lines
@erp/api:test:db: 2026-11-01 23:09:21.290 UTC [2693] STATEMENT:  DELETE FROM purchase_reallocation_lines WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:21.313 UTC [2697] ERROR:  new row violates row-level security policy for table "sales_reps"
@erp/api:test:db: 2026-11-01 23:09:21.313 UTC [2697] STATEMENT:  INSERT INTO sales_reps (id, tenant_id, code, name, status)
@erp/api:test:db: 	     VALUES ('70707070-3000-4000-8000-000000000003', $1, 'ATK-REP', 'Attack Rep', 'ACTIVE')
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:21.325 UTC [2699] ERROR:  permission denied for table sales_reps
@erp/api:test:db: 2026-11-01 23:09:21.325 UTC [2699] STATEMENT:  DELETE FROM sales_reps WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:21.349 UTC [2703] ERROR:  new row violates row-level security policy for table "quotations"
@erp/api:test:db: 2026-11-01 23:09:21.349 UTC [2703] STATEMENT:  INSERT INTO quotations (id, tenant_id, branch_id, customer_id, quote_date, valid_until, currency_code, status)
@erp/api:test:db: 	     VALUES ('71717171-3000-4000-8000-000000000003', $1, 'abababab-0000-4000-8000-000000000002',
@erp/api:test:db: 	             'b5b5b5b5-0000-4000-8000-000000000002', '2027-02-01', '2027-03-03', 'SAR', 'DRAFT')
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:21.361 UTC [2705] ERROR:  permission denied for table quotations
@erp/api:test:db: 2026-11-01 23:09:21.361 UTC [2705] STATEMENT:  DELETE FROM quotations WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:21.385 UTC [2709] ERROR:  new row violates row-level security policy for table "quotation_lines"
@erp/api:test:db: 2026-11-01 23:09:21.385 UTC [2709] STATEMENT:  INSERT INTO quotation_lines (id, tenant_id, quotation_id, line_no, item_id, qty, unit_price, net_amount)
@erp/api:test:db: 	     VALUES ('72727272-3000-4000-8000-000000000003', $1, '71717171-0000-4000-8000-000000000002', 2,
@erp/api:test:db: 	             'babababa-0000-4000-8000-000000000002', 5, 2.5, 12.5)
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:21.397 UTC [2711] ERROR:  permission denied for table quotation_lines
@erp/api:test:db: 2026-11-01 23:09:21.397 UTC [2711] STATEMENT:  DELETE FROM quotation_lines WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:21.421 UTC [2715] ERROR:  new row violates row-level security policy for table "sales_orders"
@erp/api:test:db: 2026-11-01 23:09:21.421 UTC [2715] STATEMENT:  INSERT INTO sales_orders (id, tenant_id, branch_id, customer_id, warehouse_id, order_date, currency_code, status)
@erp/api:test:db: 	     VALUES ('73737373-3000-4000-8000-000000000003', $1, 'abababab-0000-4000-8000-000000000002',
@erp/api:test:db: 	             'b5b5b5b5-0000-4000-8000-000000000002', 'f0f0f0f0-1000-4000-8000-000000000002',
@erp/api:test:db: 	             '2027-02-02', 'SAR', 'DRAFT')
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:21.433 UTC [2717] ERROR:  permission denied for table sales_orders
@erp/api:test:db: 2026-11-01 23:09:21.433 UTC [2717] STATEMENT:  DELETE FROM sales_orders WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:21.456 UTC [2721] ERROR:  new row violates row-level security policy for table "sales_order_lines"
@erp/api:test:db: 2026-11-01 23:09:21.456 UTC [2721] STATEMENT:  INSERT INTO sales_order_lines (id, tenant_id, order_id, line_no, item_id, qty, unit_price, net_amount)
@erp/api:test:db: 	     VALUES ('74747474-3000-4000-8000-000000000003', $1, '73737373-0000-4000-8000-000000000002', 2,
@erp/api:test:db: 	             'babababa-0000-4000-8000-000000000002', 5, 2.5, 12.5)
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:21.468 UTC [2723] ERROR:  permission denied for table sales_order_lines
@erp/api:test:db: 2026-11-01 23:09:21.468 UTC [2723] STATEMENT:  DELETE FROM sales_order_lines WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:21.491 UTC [2727] ERROR:  new row violates row-level security policy for table "delivery_notes"
@erp/api:test:db: 2026-11-01 23:09:21.491 UTC [2727] STATEMENT:  INSERT INTO delivery_notes (id, tenant_id, branch_id, customer_id, warehouse_id, delivery_date, currency_code, status)
@erp/api:test:db: 	     VALUES ('75757575-3000-4000-8000-000000000003', $1, 'abababab-0000-4000-8000-000000000002',
@erp/api:test:db: 	             'b5b5b5b5-0000-4000-8000-000000000002', 'f0f0f0f0-1000-4000-8000-000000000002',
@erp/api:test:db: 	             '2027-02-05', 'SAR', 'DRAFT')
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:21.502 UTC [2729] ERROR:  permission denied for table delivery_notes
@erp/api:test:db: 2026-11-01 23:09:21.502 UTC [2729] STATEMENT:  DELETE FROM delivery_notes WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:21.528 UTC [2733] ERROR:  new row violates row-level security policy for table "delivery_note_lines"
@erp/api:test:db: 2026-11-01 23:09:21.528 UTC [2733] STATEMENT:  INSERT INTO delivery_note_lines (id, tenant_id, delivery_id, line_no, item_id, qty, unit_price, net_amount)
@erp/api:test:db: 	     VALUES ('76767676-3000-4000-8000-000000000003', $1, '75757575-0000-4000-8000-000000000002', 2,
@erp/api:test:db: 	             'babababa-0000-4000-8000-000000000002', 5, 2.5, 12.5)
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:21.540 UTC [2735] ERROR:  permission denied for table delivery_note_lines
@erp/api:test:db: 2026-11-01 23:09:21.540 UTC [2735] STATEMENT:  DELETE FROM delivery_note_lines WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:21.564 UTC [2739] ERROR:  new row violates row-level security policy for table "sales_invoices"
@erp/api:test:db: 2026-11-01 23:09:21.564 UTC [2739] STATEMENT:  INSERT INTO sales_invoices (id, tenant_id, branch_id, customer_id, kind, invoice_date, due_date, currency_code, status)
@erp/api:test:db: 	     VALUES ('77777777-3000-4000-8000-000000000003', $1, 'abababab-0000-4000-8000-000000000002',
@erp/api:test:db: 	             'b5b5b5b5-0000-4000-8000-000000000002', 'CREDIT', '2027-02-10', '2027-03-12', 'SAR', 'DRAFT')
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:21.576 UTC [2741] ERROR:  permission denied for table sales_invoices
@erp/api:test:db: 2026-11-01 23:09:21.576 UTC [2741] STATEMENT:  DELETE FROM sales_invoices WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:21.599 UTC [2745] ERROR:  new row violates row-level security policy for table "sales_invoice_lines"
@erp/api:test:db: 2026-11-01 23:09:21.599 UTC [2745] STATEMENT:  INSERT INTO sales_invoice_lines (id, tenant_id, invoice_id, line_no, item_id, qty, unit_price, net_amount)
@erp/api:test:db: 	     VALUES ('78787878-3000-4000-8000-000000000003', $1, '77777777-0000-4000-8000-000000000002', 2,
@erp/api:test:db: 	             'babababa-0000-4000-8000-000000000002', 5, 2.5, 12.5)
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:21.610 UTC [2747] ERROR:  permission denied for table sales_invoice_lines
@erp/api:test:db: 2026-11-01 23:09:21.610 UTC [2747] STATEMENT:  DELETE FROM sales_invoice_lines WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:21.634 UTC [2751] ERROR:  new row violates row-level security policy for table "credit_notes"
@erp/api:test:db: 2026-11-01 23:09:21.634 UTC [2751] STATEMENT:  INSERT INTO credit_notes (id, tenant_id, branch_id, customer_id, invoice_id, note_date, currency_code, status)
@erp/api:test:db: 	     VALUES ('79797979-3000-4000-8000-000000000003', $1, 'abababab-0000-4000-8000-000000000002',
@erp/api:test:db: 	             'b5b5b5b5-0000-4000-8000-000000000002', '77777777-0000-4000-8000-000000000002',
@erp/api:test:db: 	             '2027-02-15', 'SAR', 'DRAFT')
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:21.645 UTC [2753] ERROR:  permission denied for table credit_notes
@erp/api:test:db: 2026-11-01 23:09:21.645 UTC [2753] STATEMENT:  DELETE FROM credit_notes WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:21.668 UTC [2757] ERROR:  new row violates row-level security policy for table "credit_note_lines"
@erp/api:test:db: 2026-11-01 23:09:21.668 UTC [2757] STATEMENT:  INSERT INTO credit_note_lines (id, tenant_id, note_id, line_no, invoice_line_id, item_id, qty, unit_price, net_amount)
@erp/api:test:db: 	     VALUES ('7a7a7a7a-3000-4000-8000-000000000003', $1, '79797979-0000-4000-8000-000000000002', 2,
@erp/api:test:db: 	             '78787878-0000-4000-8000-000000000002', 'babababa-0000-4000-8000-000000000002', 1, 1, 1)
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:21.679 UTC [2759] ERROR:  permission denied for table credit_note_lines
@erp/api:test:db: 2026-11-01 23:09:21.679 UTC [2759] STATEMENT:  DELETE FROM credit_note_lines WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:21.702 UTC [2763] ERROR:  new row violates row-level security policy for table "sales_reallocations"
@erp/api:test:db: 2026-11-01 23:09:21.702 UTC [2763] STATEMENT:  INSERT INTO sales_reallocations (id, tenant_id, doc_no, receipt_id, customer_id, reason, total_amount)
@erp/api:test:db: 	     VALUES ('7b7b7b7b-3000-4000-8000-000000000003', $1, 'SRAL-ATK-1', 'd3d3d3d3-0000-4000-8000-000000000002',
@erp/api:test:db: 	             'b5b5b5b5-0000-4000-8000-000000000002', 'attack sales re-allocation', 1)
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:21.708 UTC [2764] ERROR:  permission denied for table sales_reallocations
@erp/api:test:db: 2026-11-01 23:09:21.708 UTC [2764] STATEMENT:  UPDATE sales_reallocations SET reason = reason WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:21.713 UTC [2765] ERROR:  permission denied for table sales_reallocations
@erp/api:test:db: 2026-11-01 23:09:21.713 UTC [2765] STATEMENT:  DELETE FROM sales_reallocations WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:21.736 UTC [2769] ERROR:  new row violates row-level security policy for table "sales_reallocation_lines"
@erp/api:test:db: 2026-11-01 23:09:21.736 UTC [2769] STATEMENT:  INSERT INTO sales_reallocation_lines (id, tenant_id, reallocation_id, line_no, to_open_item_id, amount)
@erp/api:test:db: 	     VALUES ('7c7c7c7c-3000-4000-8000-000000000003', $1, '7b7b7b7b-0000-4000-8000-000000000002', 2,
@erp/api:test:db: 	             'cececece-0000-4000-8000-000000000002', 1)
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:21.742 UTC [2770] ERROR:  permission denied for table sales_reallocation_lines
@erp/api:test:db: 2026-11-01 23:09:21.742 UTC [2770] STATEMENT:  UPDATE sales_reallocation_lines SET amount = amount WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:21.748 UTC [2771] ERROR:  permission denied for table sales_reallocation_lines
@erp/api:test:db: 2026-11-01 23:09:21.748 UTC [2771] STATEMENT:  DELETE FROM sales_reallocation_lines WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:21.772 UTC [2775] ERROR:  new row violates row-level security policy for table "report_runs"
@erp/api:test:db: 2026-11-01 23:09:21.772 UTC [2775] STATEMENT:  INSERT INTO report_runs (id, tenant_id, report_key, contract_version, params,
@erp/api:test:db: 	                                      params_hash, execution_class, status)
@erp/api:test:db: 	     VALUES ('7d7d7d7d-3000-4000-8000-000000000003', $1, 'financial.trial-balance', 1,
@erp/api:test:db: 	             '{"locale": "ar"}'::jsonb, 'iso-attack', 'inline', 'QUEUED')
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:21.784 UTC [2777] ERROR:  permission denied for table report_runs
@erp/api:test:db: 2026-11-01 23:09:21.784 UTC [2777] STATEMENT:  DELETE FROM report_runs WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:21.807 UTC [2781] ERROR:  new row violates row-level security policy for table "print_templates"
@erp/api:test:db: 2026-11-01 23:09:21.807 UTC [2781] STATEMENT:  INSERT INTO print_templates (id, tenant_id, key, version, locale_variants)
@erp/api:test:db: 	     VALUES ('7e7e7e7e-3000-4000-8000-000000000003', $1, 'receipt-58', 1, '{"ar": 1}'::jsonb)
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:21.818 UTC [2783] ERROR:  permission denied for table print_templates
@erp/api:test:db: 2026-11-01 23:09:21.818 UTC [2783] STATEMENT:  DELETE FROM print_templates WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:21.840 UTC [2787] ERROR:  new row violates row-level security policy for table "subscription_invoices"
@erp/api:test:db: 2026-11-01 23:09:21.840 UTC [2787] STATEMENT:  INSERT INTO subscription_invoices (
@erp/api:test:db: 	       id, tenant_id, subscription_id, number, plan_key, period_start, period_end,
@erp/api:test:db: 	       amount, currency_code, status, source, due_date, placeholder_price)
@erp/api:test:db: 	     VALUES ('71717171-3000-4000-8000-000000000003', $1,
@erp/api:test:db: 	       'adadadad-0000-4000-8000-000000000002', 'BI-2026-0099', 'business',
@erp/api:test:db: 	       '2026-01-01', '2026-01-31', '0.0000', 'SAR', 'OPEN', 'checkout', '2026-01-08', true)
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:21.852 UTC [2789] ERROR:  permission denied for table subscription_invoices
@erp/api:test:db: 2026-11-01 23:09:21.852 UTC [2789] STATEMENT:  DELETE FROM subscription_invoices WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:21.875 UTC [2793] ERROR:  new row violates row-level security policy for table "billing_events"
@erp/api:test:db: 2026-11-01 23:09:21.875 UTC [2793] STATEMENT:  INSERT INTO billing_events (id, tenant_id, type, payload, idempotency_key)
@erp/api:test:db: 	     VALUES ('72727272-3000-4000-8000-000000000003', $1, 'trial.started', '{}'::jsonb, 'iso-attack-1')
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:21.880 UTC [2794] ERROR:  permission denied for table billing_events
@erp/api:test:db: 2026-11-01 23:09:21.880 UTC [2794] STATEMENT:  UPDATE billing_events SET type = type WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:21.886 UTC [2795] ERROR:  permission denied for table billing_events
@erp/api:test:db: 2026-11-01 23:09:21.886 UTC [2795] STATEMENT:  DELETE FROM billing_events WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:21.908 UTC [2799] ERROR:  new row violates row-level security policy for table "usage_counters"
@erp/api:test:db: 2026-11-01 23:09:21.908 UTC [2799] STATEMENT:  INSERT INTO usage_counters (id, tenant_id, counter_key, period, value)
@erp/api:test:db: 	     VALUES ('73737373-3000-4000-8000-000000000003', $1, 'documents_per_month', '2026-01', 5)
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:21.919 UTC [2801] ERROR:  permission denied for table usage_counters
@erp/api:test:db: 2026-11-01 23:09:21.919 UTC [2801] STATEMENT:  DELETE FROM usage_counters WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:21.942 UTC [2805] ERROR:  new row violates row-level security policy for table "notifications"
@erp/api:test:db: 2026-11-01 23:09:21.942 UTC [2805] STATEMENT:  INSERT INTO notifications (id, tenant_id, category, severity, title, body)
@erp/api:test:db: 	     VALUES ('74747474-3000-4000-8000-000000000003', $1, 'subscription', 'info',
@erp/api:test:db: 	       '{"ar":"س","en":"S"}'::jsonb, '{"ar":"ب","en":"B"}'::jsonb)
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:21.954 UTC [2807] ERROR:  permission denied for table notifications
@erp/api:test:db: 2026-11-01 23:09:21.954 UTC [2807] STATEMENT:  DELETE FROM notifications WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:21.976 UTC [2811] ERROR:  new row violates row-level security policy for table "notification_prefs"
@erp/api:test:db: 2026-11-01 23:09:21.976 UTC [2811] STATEMENT:  INSERT INTO notification_prefs (id, tenant_id, user_id, category, in_app, email)
@erp/api:test:db: 	     VALUES ('75757575-3000-4000-8000-000000000003', $1,
@erp/api:test:db: 	       'eeeeeeee-0000-4000-8000-000000000001', 'limits', true, true)
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:21.988 UTC [2813] ERROR:  permission denied for table notification_prefs
@erp/api:test:db: 2026-11-01 23:09:21.988 UTC [2813] STATEMENT:  DELETE FROM notification_prefs WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:22.000 UTC [2815] ERROR:  new row violates row-level security policy for table "roles"
@erp/api:test:db: 2026-11-01 23:09:22.000 UTC [2815] STATEMENT:  INSERT INTO roles (id, tenant_id, key, name, is_system)
@erp/api:test:db: 	       VALUES ('dddddddd-9999-4999-8999-999999999999', NULL, 'forged', 'Forged', true)
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:22.001 UTC [2815] ERROR:  new row violates row-level security policy for table "roles"
@erp/api:test:db: 2026-11-01 23:09:22.001 UTC [2815] STATEMENT:  UPDATE roles SET name = 'HACKED' WHERE tenant_id IS NULL AND key = 'owner'
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:22.012 UTC [2817] ERROR:  new row violates row-level security policy for table "roles"
@erp/api:test:db: 2026-11-01 23:09:22.012 UTC [2817] STATEMENT:  INSERT INTO roles (id, tenant_id, key, name, is_system)
@erp/api:test:db: 	         VALUES ('dddddddd-7777-4777-8777-777777777777', $1, 'tenant_probe', 'Tenant Probe', false)
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:09:22.019 UTC [2818] ERROR:  insert or update on table "memberships" violates foreign key constraint "fk_memberships_role"
@erp/api:test:db: 2026-11-01 23:09:22.019 UTC [2818] DETAIL:  Key (role_id, tenant_id)=(dddddddd-0000-4000-8000-000000000002, 11111111-1111-1111-1111-111111111111) is not present in table "roles".
@erp/api:test:db: 2026-11-01 23:09:22.019 UTC [2818] STATEMENT:  INSERT INTO memberships (id, tenant_id, user_id, role_id)
@erp/api:test:db: 	         VALUES ('ffffffff-1111-4111-8111-111111111111', $1,
@erp/api:test:db: 	                 'eeeeeeee-0000-4000-8000-000000000002',
@erp/api:test:db: 	                 'dddddddd-0000-4000-8000-000000000002')
@erp/api:test:db: 
@erp/api:test:db:  ✓ src/__db__/isolation/identity-isolation.db.spec.ts (642 tests) 4103ms
@erp/api:test:db: {"level":30,"time":1793574564474,"service":"erp-api","module":"jobs","action":"boss-started","msg":"pg-boss queue client started"}
@erp/api:test:db: {"level":30,"time":1793574564711,"service":"erp-api","module":"http","correlation_id":"01a1995f-f2b4-7000-8820-0c92c1f064cc","action":"request","method":"POST","path":"/api/v1/identity/sessions","status":200,"duration_ms":179,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574564779,"service":"erp-api","module":"http","correlation_id":"01a1995f-f38c-7000-b57b-6116fc091d9c","action":"request","method":"POST","path":"/api/v1/items/import-jobs","status":200,"duration_ms":31,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574564796,"service":"erp-api","module":"http","correlation_id":"01a1995f-f3b5-7000-a106-df88a8bad69c","action":"request","method":"POST","path":"/api/v1/items/import-jobs","status":200,"duration_ms":7,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574564813,"service":"erp-api","module":"http","correlation_id":"01a1995f-f3be-7000-93d3-bb28f6e67879","action":"request","method":"POST","path":"/api/v1/items/import-jobs/01a1995f-f398-7000-8502-940564bce52d/commit","status":200,"duration_ms":15,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574564820,"service":"erp-api","module":"http","correlation_id":"01a1995f-f3cf-7000-9785-2a3993bc0005","action":"request","method":"GET","path":"/api/v1/items/import-jobs/01a1995f-f398-7000-8502-940564bce52d","status":200,"duration_ms":5,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574565077,"service":"erp-api","module":"http","correlation_id":"01a1995f-f4cf-7000-9bff-aeca4ca85d64","action":"request","method":"GET","path":"/api/v1/items/import-jobs/01a1995f-f398-7000-8502-940564bce52d","status":200,"duration_ms":6,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574565338,"service":"erp-api","module":"http","correlation_id":"01a1995f-f5d1-7000-9390-9bfd7770813b","action":"request","method":"GET","path":"/api/v1/items/import-jobs/01a1995f-f398-7000-8502-940564bce52d","status":200,"duration_ms":8,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574565598,"service":"erp-api","module":"http","correlation_id":"01a1995f-f6d7-7000-bfa5-1685a5756db1","action":"request","method":"GET","path":"/api/v1/items/import-jobs/01a1995f-f398-7000-8502-940564bce52d","status":200,"duration_ms":7,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574565858,"service":"erp-api","module":"http","correlation_id":"01a1995f-f7db-7000-a6e9-edf0f15a50c4","action":"request","method":"GET","path":"/api/v1/items/import-jobs/01a1995f-f398-7000-8502-940564bce52d","status":200,"duration_ms":7,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574566119,"service":"erp-api","module":"http","correlation_id":"01a1995f-f8df-7000-8e1e-d187901ac004","action":"request","method":"GET","path":"/api/v1/items/import-jobs/01a1995f-f398-7000-8502-940564bce52d","status":200,"duration_ms":8,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574566378,"service":"erp-api","module":"http","correlation_id":"01a1995f-f9e3-7000-9b87-ec2a8da2e2f0","action":"request","method":"GET","path":"/api/v1/items/import-jobs/01a1995f-f398-7000-8502-940564bce52d","status":200,"duration_ms":7,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574566480,"service":"erp-api","module":"notifications","template":"login_notification","correlation_id":"01a1995f-f2b4-7000-8820-0c92c1f064cc","msg":"email delivered"}
@erp/api:test:db: {"level":30,"time":1793574566637,"service":"erp-api","module":"http","correlation_id":"01a1995f-fae4-7000-b72e-5d82845cefc3","action":"request","method":"GET","path":"/api/v1/items/import-jobs/01a1995f-f398-7000-8502-940564bce52d","status":200,"duration_ms":9,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574566648,"service":"erp-api","module":"http","correlation_id":"01a1995f-faf0-7000-9869-09674436145b","action":"request","method":"POST","path":"/api/v1/items/import-jobs/01a1995f-f398-7000-8502-940564bce52d/commit","status":200,"duration_ms":8,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574566671,"service":"erp-api","module":"http","correlation_id":"01a1995f-fafa-7000-ba33-105f36af8865","action":"request","method":"POST","path":"/api/v1/items/import-jobs","status":200,"duration_ms":21,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574566695,"service":"erp-api","module":"http","correlation_id":"01a1995f-fb18-7000-8b99-b2b9927067a6","action":"request","method":"POST","path":"/api/v1/items/import-jobs","status":422,"duration_ms":15,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574566766,"service":"erp-api","module":"http","correlation_id":"01a1995f-fb49-7000-8acc-51129800f6ca","action":"request","method":"POST","path":"/api/v1/items/import-jobs","status":200,"duration_ms":37,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574566780,"service":"erp-api","module":"http","correlation_id":"01a1995f-fb70-7000-b447-ab96ac9386e4","action":"request","method":"POST","path":"/api/v1/items/import-jobs/01a1995f-fb4e-7000-a084-f28aeae78324/commit","status":200,"duration_ms":12,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574566786,"service":"erp-api","module":"http","correlation_id":"01a1995f-fb7d-7000-8333-b7fbaefe84d6","action":"request","method":"GET","path":"/api/v1/items/import-jobs/01a1995f-fb4e-7000-a084-f28aeae78324","status":200,"duration_ms":5,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574567045,"service":"erp-api","module":"http","correlation_id":"01a1995f-fc7e-7000-802c-85e6accb905b","action":"request","method":"GET","path":"/api/v1/items/import-jobs/01a1995f-fb4e-7000-a084-f28aeae78324","status":200,"duration_ms":7,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574567303,"service":"erp-api","module":"http","correlation_id":"01a1995f-fd81-7000-aac5-6cc43eca7573","action":"request","method":"GET","path":"/api/v1/items/import-jobs/01a1995f-fb4e-7000-a084-f28aeae78324","status":200,"duration_ms":6,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574567560,"service":"erp-api","module":"http","correlation_id":"01a1995f-fe83-7000-b583-9695207b90fa","action":"request","method":"GET","path":"/api/v1/items/import-jobs/01a1995f-fb4e-7000-a084-f28aeae78324","status":200,"duration_ms":5,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574567819,"service":"erp-api","module":"http","correlation_id":"01a1995f-ff84-7000-8c77-2cdae9a0988d","action":"request","method":"GET","path":"/api/v1/items/import-jobs/01a1995f-fb4e-7000-a084-f28aeae78324","status":200,"duration_ms":7,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574568077,"service":"erp-api","module":"http","correlation_id":"01a19960-0086-7000-85be-ede1e424a48d","action":"request","method":"GET","path":"/api/v1/items/import-jobs/01a1995f-fb4e-7000-a084-f28aeae78324","status":200,"duration_ms":7,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574568334,"service":"erp-api","module":"http","correlation_id":"01a19960-0188-7000-b775-f82890fcb8f1","action":"request","method":"GET","path":"/api/v1/items/import-jobs/01a1995f-fb4e-7000-a084-f28aeae78324","status":200,"duration_ms":6,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574568593,"service":"erp-api","module":"http","correlation_id":"01a19960-028b-7000-bf5b-076ee6d58225","action":"request","method":"GET","path":"/api/v1/items/import-jobs/01a1995f-fb4e-7000-a084-f28aeae78324","status":200,"duration_ms":6,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574568627,"service":"erp-api","module":"http","correlation_id":"01a19960-029e-7000-a995-a41049a877d0","action":"request","method":"POST","path":"/api/v1/items/export-jobs","status":200,"duration_ms":21,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574568640,"service":"erp-api","module":"jobs","action":"boss-stopped","msg":"pg-boss queue client stopped"}
@erp/api:test:db:  ✓ src/__db__/import-export.db.spec.ts (4 tests) 4582ms
@erp/api:test:db:    ✓ PHASE-006 import/export engine > dry-run preview: row errors, duplicates, Arabic round-trip — all without writing  1955ms
@erp/api:test:db:    ✓ PHASE-006 import/export engine > XLSX import round-trips Arabic headers and content  1908ms
@erp/api:test:db: {"level":40,"time":1793574570070,"service":"erp-api","module":"identity","user_id":"01a19960-051d-7000-84fe-7dec956fbdc6","msg":"temporary lockout engaged (R-01)"}
@erp/api:test:db: {"level":40,"time":1793574570238,"service":"erp-api","module":"identity","email_hash":"405489a6a8e8","msg":"login attempt for unknown email"}
@erp/api:test:db: {"level":40,"time":1793574570563,"service":"erp-api","module":"identity","email_hash":"fe90e9be6563","msg":"login attempt for unknown email"}
@erp/api:test:db: {"level":40,"time":1793574570564,"service":"erp-api","module":"identity","email_hash":"236f1b9d195a","msg":"login attempt for unknown email"}
@erp/api:test:db: {"level":40,"time":1793574570565,"service":"erp-api","module":"identity","email_hash":"0b62835181c6","msg":"login attempt for unknown email"}
@erp/api:test:db: {"level":40,"time":1793574570566,"service":"erp-api","module":"identity","email_hash":"1c3ae17b41ed","msg":"login attempt for unknown email"}
@erp/api:test:db: {"level":40,"time":1793574570567,"service":"erp-api","module":"identity","email_hash":"f794a635dbba","msg":"login attempt for unknown email"}
@erp/api:test:db: {"level":40,"time":1793574570567,"service":"erp-api","module":"identity","email_hash":"a0a18e76e0be","msg":"login attempt for unknown email"}
@erp/api:test:db: {"level":40,"time":1793574570568,"service":"erp-api","module":"identity","email_hash":"6411faf0d2b7","msg":"login attempt for unknown email"}
@erp/api:test:db: {"level":40,"time":1793574570568,"service":"erp-api","module":"identity","email_hash":"3bea867b9b16","msg":"login attempt for unknown email"}
@erp/api:test:db: {"level":40,"time":1793574570569,"service":"erp-api","module":"identity","email_hash":"3b789b5ed688","msg":"login attempt for unknown email"}
@erp/api:test:db: {"level":40,"time":1793574570569,"service":"erp-api","module":"identity","email_hash":"2b71691224f2","msg":"login attempt for unknown email"}
@erp/api:test:db: {"level":30,"time":1793574571767,"service":"erp-api","module":"identity","user_id":"01a19960-0e63-7000-86bf-0178cff96b0e","msg":"password reset consumed; all sessions revoked"}
@erp/api:test:db:  ✓ src/__db__/identity-flows.db.spec.ts (21 tests) 5437ms
@erp/api:test:db:    ✓ login + progressive lockout (R-01, R-02, acceptance 1/2) > argon2id-verified login issues a rotating session and records user.login  378ms
@erp/api:test:db:    ✓ login + progressive lockout (R-01, R-02, acceptance 1/2) > progressive lockout: N failures → temporary lock, never permanent; counters reset on success (R-01)  1155ms
@erp/api:test:db:    ✓ session windows + rotation (M-01, M-02, M-04, M-10) > owner revokes another user's session — dead immediately (M-10)  361ms
@erp/api:test:db:    ✓ session windows + rotation (M-01, M-02, M-04, M-10) > password reset consume revokes every session (M-08 + AUTHENTICATION §4)  333ms
@erp/api:test:db:    ✓ TOTP MFA (M-06, M-07, acceptance 3) > enroll → verify confirms; same-code replay rejected; recovery codes single-use  658ms
@erp/api:test:db:    ✓ invitations (acceptance flow; single-use/expiry/revocation) > issue → accept creates membership + PENDING user path with password; token single-use  303ms
@erp/api:test:db:    ✓ route × role permission checklist (acceptance 5) > every protected route: owner template grants it, viewer template does not (identity/audit plane)  418ms
@erp/api:test:db: {"level":30,"time":1793574574172,"service":"erp-api","module":"jobs","action":"boss-started","msg":"pg-boss queue client started"}
@erp/api:test:db: {"level":30,"time":1793574574532,"service":"erp-api","module":"billing-subscriptions","invoice":"BI-2026-0001","paid_via":"provider_webhook","msg":"subscription activated"}
@erp/api:test:db: {"level":30,"time":1793574574566,"service":"erp-api","module":"jobs","action":"boss-started","msg":"pg-boss queue client started"}
@erp/api:test:db: {"level":30,"time":1793574574575,"service":"erp-api","module":"notifications","template":"subscription_state","msg":"email delivered"}
@erp/api:test:db: {"level":30,"time":1793574574773,"service":"erp-api","module":"http","correlation_id":"01a19960-19f1-7000-8325-e2a808c7806a","action":"request","method":"POST","path":"/api/v1/identity/sessions","status":200,"duration_ms":196,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574576148,"service":"erp-api","module":"http","correlation_id":"01a19960-200a-7000-9ef2-c45f6bb0123e","action":"request","method":"GET","path":"/api/v1/accounting/journal-entries?limit=50","status":200,"duration_ms":10,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574576155,"service":"erp-api","module":"http","correlation_id":"01a19960-2016-7000-af91-239e565f9206","action":"request","method":"GET","path":"/api/v1/accounting/journal-entries?limit=50","status":200,"duration_ms":5,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574576160,"service":"erp-api","module":"http","correlation_id":"01a19960-201c-7000-823d-222717ffd996","action":"request","method":"GET","path":"/api/v1/accounting/journal-entries?limit=50","status":200,"duration_ms":4,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574576164,"service":"erp-api","module":"http","correlation_id":"01a19960-2021-7000-9653-dd87f7b4f64d","action":"request","method":"GET","path":"/api/v1/accounting/journal-entries?limit=50","status":200,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574576168,"service":"erp-api","module":"http","correlation_id":"01a19960-2024-7000-9eab-e8815a29aca0","action":"request","method":"GET","path":"/api/v1/accounting/journal-entries?limit=50","status":200,"duration_ms":4,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574576172,"service":"erp-api","module":"http","correlation_id":"01a19960-2029-7000-8892-9c6a74422e52","action":"request","method":"GET","path":"/api/v1/accounting/journal-entries?limit=50","status":200,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574576177,"service":"erp-api","module":"http","correlation_id":"01a19960-202d-7000-9157-6e3bb8b0d974","action":"request","method":"GET","path":"/api/v1/accounting/journal-entries?limit=50","status":200,"duration_ms":4,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574576182,"service":"erp-api","module":"http","correlation_id":"01a19960-2032-7000-8d70-144c51c14ff5","action":"request","method":"GET","path":"/api/v1/accounting/journal-entries?limit=50","status":200,"duration_ms":4,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574576188,"service":"erp-api","module":"http","correlation_id":"01a19960-2038-7000-baff-7f856f23458e","action":"request","method":"GET","path":"/api/v1/accounting/journal-entries?limit=50","status":200,"duration_ms":4,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574576193,"service":"erp-api","module":"http","correlation_id":"01a19960-203d-7000-91a1-63fbe5371f08","action":"request","method":"GET","path":"/api/v1/accounting/journal-entries?limit=50","status":200,"duration_ms":4,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574576198,"service":"erp-api","module":"http","correlation_id":"01a19960-2043-7000-9151-5d4cd0eea4a9","action":"request","method":"GET","path":"/api/v1/accounting/journal-entries?limit=50","status":200,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574576204,"service":"erp-api","module":"http","correlation_id":"01a19960-2047-7000-a9e0-0ee388930dcc","action":"request","method":"GET","path":"/api/v1/accounting/journal-entries?limit=50","status":200,"duration_ms":5,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574576216,"service":"erp-api","module":"http","correlation_id":"01a19960-2052-7000-83d1-1b5930115ea8","action":"request","method":"GET","path":"/api/v1/accounting/journal-entries?limit=50","status":200,"duration_ms":6,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574576220,"service":"erp-api","module":"http","correlation_id":"01a19960-2058-7000-aeea-7201491d1ec1","action":"request","method":"GET","path":"/api/v1/accounting/journal-entries?limit=50","status":200,"duration_ms":4,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574576228,"service":"erp-api","module":"http","correlation_id":"01a19960-205d-7000-9863-0793f32fcfe8","action":"request","method":"GET","path":"/api/v1/accounting/journal-entries?limit=50","status":200,"duration_ms":7,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574576236,"service":"erp-api","module":"http","correlation_id":"01a19960-2066-7000-b3ea-548b74691266","action":"request","method":"GET","path":"/api/v1/accounting/journal-entries?limit=50","status":200,"duration_ms":6,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574576240,"service":"erp-api","module":"http","correlation_id":"01a19960-206c-7000-96d1-c94bf6ea309e","action":"request","method":"GET","path":"/api/v1/accounting/journal-entries?limit=50","status":200,"duration_ms":4,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574576249,"service":"erp-api","module":"http","correlation_id":"01a19960-2071-7000-bd92-0f31aa1cf40e","action":"request","method":"GET","path":"/api/v1/accounting/journal-entries?limit=50","status":200,"duration_ms":8,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574576256,"service":"erp-api","module":"http","correlation_id":"01a19960-207a-7000-a231-20d526929de9","action":"request","method":"GET","path":"/api/v1/accounting/journal-entries?limit=50","status":200,"duration_ms":6,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574576263,"service":"erp-api","module":"http","correlation_id":"01a19960-2082-7000-a66d-130d05f94c10","action":"request","method":"GET","path":"/api/v1/accounting/journal-entries?limit=50","status":200,"duration_ms":5,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574576270,"service":"erp-api","module":"http","correlation_id":"01a19960-2087-7000-8ffe-e83f1eb04b72","action":"request","method":"GET","path":"/api/v1/accounting/journal-entries?limit=50","status":200,"duration_ms":6,"msg":"request completed"}
@erp/api:test:db: stdout | src/__db__/performance/mvp-candidate.local.spec.ts > MVP candidate load — local harness (T12; PERFORMANCE_TEST_PLAN §2/§9) > T-01: document list p95 < 500 ms over a 100k-row register
@erp/api:test:db: [mvp-candidate] T-01 document-list p95=9ms (n=20, 100k rows) budget=500ms
@erp/api:test:db: 
@erp/api:test:db: {"level":30,"time":1793574576567,"service":"erp-api","module":"notifications","template":"login_notification","correlation_id":"01a19960-19f1-7000-8325-e2a808c7806a","msg":"email delivered"}
@erp/api:test:db: stdout | src/__db__/performance/mvp-candidate.local.spec.ts > MVP candidate load — local harness (T12; PERFORMANCE_TEST_PLAN §2/§9) > T-02: posting p95 < 300 ms (the engine path, n=30)
@erp/api:test:db: [mvp-candidate] T-02 posting p95=25ms (n=30) budget=300ms
@erp/api:test:db: 
@erp/api:test:db: stdout | src/__db__/performance/mvp-candidate.local.spec.ts > MVP candidate load — local harness (T12; PERFORMANCE_TEST_PLAN §2/§9) > T-04: interactive report tier p95 < 2 s (four contract families)
@erp/api:test:db: [mvp-candidate] T-04 interactive-report compute p95=12ms (n=4, 4 contract families) budget=2000ms; cached re-run p95=0ms
@erp/api:test:db: 
@erp/api:test:db: {"level":30,"time":1793574576840,"service":"erp-api","module":"http","correlation_id":"01a19960-2233-7000-8148-ace7c5c28e60","action":"request","method":"POST","path":"/api/v1/identity/sessions","status":200,"duration_ms":149,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574576845,"service":"erp-api","module":"http","correlation_id":"01a19960-22c9-7000-91ad-b53952c734c5","action":"request","method":"GET","path":"/api/v1/identity/sessions/current","status":200,"duration_ms":4,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574576849,"service":"erp-api","module":"http","correlation_id":"01a19960-22ce-7000-aa99-b992396a9145","action":"request","method":"GET","path":"/api/v1/tenancy/entitlements","status":200,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574576854,"service":"erp-api","module":"http","correlation_id":"01a19960-22d2-7000-9c16-867c5d4b531c","action":"request","method":"GET","path":"/api/v1/tenancy/navigation","status":200,"duration_ms":4,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574577001,"service":"erp-api","module":"http","correlation_id":"01a19960-22d7-7000-9d29-635b944491f1","action":"request","method":"POST","path":"/api/v1/identity/sessions","status":200,"duration_ms":146,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574577006,"service":"erp-api","module":"http","correlation_id":"01a19960-236a-7000-a5fc-caa3eaf62636","action":"request","method":"GET","path":"/api/v1/identity/sessions/current","status":200,"duration_ms":4,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574577010,"service":"erp-api","module":"http","correlation_id":"01a19960-236e-7000-aa44-54a96c8e9860","action":"request","method":"GET","path":"/api/v1/tenancy/entitlements","status":200,"duration_ms":4,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574577015,"service":"erp-api","module":"http","correlation_id":"01a19960-2372-7000-83e8-f3d2a3c3f300","action":"request","method":"GET","path":"/api/v1/tenancy/navigation","status":200,"duration_ms":5,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574577148,"service":"erp-api","module":"http","correlation_id":"01a19960-2378-7000-935c-2b977f44b24c","action":"request","method":"POST","path":"/api/v1/identity/sessions","status":200,"duration_ms":132,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574577153,"service":"erp-api","module":"http","correlation_id":"01a19960-23fd-7000-9d3c-b419e185af3e","action":"request","method":"GET","path":"/api/v1/identity/sessions/current","status":200,"duration_ms":4,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574577158,"service":"erp-api","module":"http","correlation_id":"01a19960-2403-7000-80e6-ff43d5fcc75b","action":"request","method":"GET","path":"/api/v1/tenancy/entitlements","status":200,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574577163,"service":"erp-api","module":"http","correlation_id":"01a19960-2407-7000-ad8f-3a18a633bf38","action":"request","method":"GET","path":"/api/v1/tenancy/navigation","status":200,"duration_ms":4,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574577300,"service":"erp-api","module":"http","correlation_id":"01a19960-240c-7000-8da6-e8a12a98d4b9","action":"request","method":"POST","path":"/api/v1/identity/sessions","status":200,"duration_ms":136,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574577305,"service":"erp-api","module":"http","correlation_id":"01a19960-2496-7000-ae87-171b92c64510","action":"request","method":"GET","path":"/api/v1/identity/sessions/current","status":200,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574577312,"service":"erp-api","module":"http","correlation_id":"01a19960-249a-7000-a643-f7414b921022","action":"request","method":"GET","path":"/api/v1/tenancy/entitlements","status":200,"duration_ms":6,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574577317,"service":"erp-api","module":"http","correlation_id":"01a19960-24a1-7000-8f2b-ea638553c77a","action":"request","method":"GET","path":"/api/v1/tenancy/navigation","status":200,"duration_ms":4,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574577469,"service":"erp-api","module":"http","correlation_id":"01a19960-24a6-7000-9db0-a9bf7fb2afce","action":"request","method":"POST","path":"/api/v1/identity/sessions","status":200,"duration_ms":151,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574577474,"service":"erp-api","module":"http","correlation_id":"01a19960-253e-7000-8092-87c91029d90b","action":"request","method":"GET","path":"/api/v1/identity/sessions/current","status":200,"duration_ms":4,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574577477,"service":"erp-api","module":"http","correlation_id":"01a19960-2543-7000-86e3-6cc4cc93d743","action":"request","method":"GET","path":"/api/v1/tenancy/entitlements","status":200,"duration_ms":2,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574577481,"service":"erp-api","module":"http","correlation_id":"01a19960-2546-7000-84d0-5072b9be06ed","action":"request","method":"GET","path":"/api/v1/tenancy/navigation","status":200,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: stdout | src/__db__/performance/mvp-candidate.local.spec.ts > MVP candidate load — local harness (T12; PERFORMANCE_TEST_PLAN §2/§9) > T-06: login + shell substrate p95 < 1.5 s (AR + EN)
@erp/api:test:db: [mvp-candidate] T-06 login+shell(ar) p95=165ms (n=5) budget=1500ms
@erp/api:test:db: 
@erp/api:test:db: {"level":30,"time":1793574577626,"service":"erp-api","module":"http","correlation_id":"01a19960-254b-7000-b309-95034748eab1","action":"request","method":"POST","path":"/api/v1/identity/sessions","status":200,"duration_ms":143,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574577632,"service":"erp-api","module":"http","correlation_id":"01a19960-25db-7000-8210-d8aa99b23458","action":"request","method":"GET","path":"/api/v1/identity/sessions/current","status":200,"duration_ms":5,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574577636,"service":"erp-api","module":"http","correlation_id":"01a19960-25e1-7000-8a80-49910a80ce9e","action":"request","method":"GET","path":"/api/v1/tenancy/entitlements","status":200,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574577640,"service":"erp-api","module":"http","correlation_id":"01a19960-25e5-7000-982d-4710c3aa55aa","action":"request","method":"GET","path":"/api/v1/tenancy/navigation","status":200,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574577785,"service":"erp-api","module":"http","correlation_id":"01a19960-25e9-7000-a8c6-98bd6ef5f509","action":"request","method":"POST","path":"/api/v1/identity/sessions","status":200,"duration_ms":144,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574577791,"service":"erp-api","module":"http","correlation_id":"01a19960-267b-7000-a25c-b18f8d499350","action":"request","method":"GET","path":"/api/v1/identity/sessions/current","status":200,"duration_ms":4,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574577795,"service":"erp-api","module":"http","correlation_id":"01a19960-2680-7000-ae03-cfee1f55dfa7","action":"request","method":"GET","path":"/api/v1/tenancy/entitlements","status":200,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574577800,"service":"erp-api","module":"http","correlation_id":"01a19960-2684-7000-b527-df6aa3a7433a","action":"request","method":"GET","path":"/api/v1/tenancy/navigation","status":200,"duration_ms":4,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574577945,"service":"erp-api","module":"http","correlation_id":"01a19960-2689-7000-95fc-b12dc0053f83","action":"request","method":"POST","path":"/api/v1/identity/sessions","status":200,"duration_ms":144,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574577950,"service":"erp-api","module":"http","correlation_id":"01a19960-271a-7000-ad9b-37c9aad37945","action":"request","method":"GET","path":"/api/v1/identity/sessions/current","status":200,"duration_ms":4,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574577953,"service":"erp-api","module":"http","correlation_id":"01a19960-271f-7000-a90a-c7a68c0f145e","action":"request","method":"GET","path":"/api/v1/tenancy/entitlements","status":200,"duration_ms":2,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574577958,"service":"erp-api","module":"http","correlation_id":"01a19960-2722-7000-8144-3834442bbb09","action":"request","method":"GET","path":"/api/v1/tenancy/navigation","status":200,"duration_ms":4,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574578104,"service":"erp-api","module":"http","correlation_id":"01a19960-2728-7000-ae15-1c24188e08f1","action":"request","method":"POST","path":"/api/v1/identity/sessions","status":200,"duration_ms":144,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574578109,"service":"erp-api","module":"http","correlation_id":"01a19960-27b9-7000-b54c-4570b57402cc","action":"request","method":"GET","path":"/api/v1/identity/sessions/current","status":200,"duration_ms":4,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574578113,"service":"erp-api","module":"http","correlation_id":"01a19960-27be-7000-8449-e5f1e5b4290a","action":"request","method":"GET","path":"/api/v1/tenancy/entitlements","status":200,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574578117,"service":"erp-api","module":"http","correlation_id":"01a19960-27c2-7000-9d00-c79c72ec4c71","action":"request","method":"GET","path":"/api/v1/tenancy/navigation","status":200,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574578272,"service":"erp-api","module":"http","correlation_id":"01a19960-27c6-7000-a18d-605f01496028","action":"request","method":"POST","path":"/api/v1/identity/sessions","status":200,"duration_ms":154,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574578278,"service":"erp-api","module":"http","correlation_id":"01a19960-2862-7000-865c-2bc5e0b42760","action":"request","method":"GET","path":"/api/v1/identity/sessions/current","status":200,"duration_ms":4,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574578282,"service":"erp-api","module":"http","correlation_id":"01a19960-2866-7000-a8f2-835f517be21b","action":"request","method":"GET","path":"/api/v1/tenancy/entitlements","status":200,"duration_ms":4,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574578286,"service":"erp-api","module":"http","correlation_id":"01a19960-286b-7000-bce5-96ff65cb56c0","action":"request","method":"GET","path":"/api/v1/tenancy/navigation","status":200,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: stdout | src/__db__/performance/mvp-candidate.local.spec.ts > MVP candidate load — local harness (T12; PERFORMANCE_TEST_PLAN §2/§9) > T-06: login + shell substrate p95 < 1.5 s (AR + EN)
@erp/api:test:db: [mvp-candidate] T-06 login+shell(en) p95=169ms (n=5) budget=1500ms
@erp/api:test:db: 
@erp/api:test:db: stdout | src/__db__/performance/mvp-candidate.local.spec.ts > MVP candidate load — local harness (T12; PERFORMANCE_TEST_PLAN §2/§9) > T-07: the scenario's 5xx rate < 0.1% (4xx business rejections excluded)
@erp/api:test:db: [mvp-candidate] T-07 5xx=0/62 (rate 0.000%) budget<0.1%
@erp/api:test:db: 
@erp/api:test:db:  ✓ src/__db__/performance/mvp-candidate.local.spec.ts (5 tests) 4128ms
@erp/api:test:db:    ✓ MVP candidate load — local harness (T12; PERFORMANCE_TEST_PLAN §2/§9) > T-01: document list p95 < 500 ms over a 100k-row register  1633ms
@erp/api:test:db:    ✓ MVP candidate load — local harness (T12; PERFORMANCE_TEST_PLAN §2/§9) > T-06: login + shell substrate p95 < 1.5 s (AR + EN)  1596ms
@erp/api:test:db: {"level":30,"time":1793574578290,"service":"erp-api","module":"jobs","action":"boss-stopped","msg":"pg-boss queue client stopped"}
@erp/api:test:db: 2026-11-01 23:09:39.986 UTC [2899] ERROR:  permission denied for table sales_reallocations
@erp/api:test:db: 2026-11-01 23:09:39.986 UTC [2899] STATEMENT:  UPDATE sales_reallocations SET reason = 'tamper' WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db:  ✓ src/__db__/sales/operations.spec.ts (17 tests) 3463ms
@erp/api:test:db:    ✓ RC-01/RC-03 — AR subledger = AR_CONTROL exact, drift detected > RC-01: 20 randomized AR operations reconcile exactly (OK run)  639ms
@erp/api:test:db:    ✓ CC-03 / INV-021 — 50 parallel posts → 50 unique official numbers > consumes 50 distinct contiguous SAL numbers with no gaps or collisions  1840ms
@erp/api:test:db: {"level":30,"time":1793574581855,"service":"erp-api","module":"jobs","action":"boss-started","msg":"pg-boss queue client started"}
@erp/api:test:db: {"level":30,"time":1793574584399,"service":"erp-api","module":"jobs","action":"boss-stopped","msg":"pg-boss queue client stopped"}
@erp/api:test:db:  ✓ src/__db__/jobs.db.spec.ts (4 tests) 2552ms
@erp/api:test:db:    ✓ pg-boss queue infrastructure > test job executes exactly once for duplicate enqueues (dedupe contract, acceptance 5)  2513ms
@erp/api:test:db: {"level":30,"time":1793574584609,"service":"erp-api","module":"jobs","action":"boss-started","msg":"pg-boss queue client started"}
@erp/api:test:db: {"level":30,"time":1793574584620,"service":"erp-api","module":"http","correlation_id":"01a19960-4128-7000-ac52-0418baaef6bf","action":"request","method":"GET","path":"/api/v1/platform/register/options","status":200,"duration_ms":4,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574584637,"service":"erp-api","module":"notifications","template":"login_notification","correlation_id":"01a19960-2233-7000-8148-ace7c5c28e60","msg":"email delivered"}
@erp/api:test:db: {"level":30,"time":1793574584834,"service":"erp-api","module":"tenancy-registration","tenant_id":"01a19960-41dc-7000-8d5b-167f5e670f05","country":"SA","msg":"tenant registered via public flow"}
@erp/api:test:db: {"level":30,"time":1793574584835,"service":"erp-api","module":"http","correlation_id":"01a19960-4134-7000-8ac4-9773e08fd78a","action":"request","method":"POST","path":"/api/v1/platform/register","status":200,"duration_ms":207,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574585034,"service":"erp-api","module":"tenancy-registration","tenant_id":"01a19960-42a3-7000-a19e-2d9fa4293db1","country":"YE","msg":"tenant registered via public flow"}
@erp/api:test:db: {"level":30,"time":1793574585035,"service":"erp-api","module":"http","correlation_id":"01a19960-4205-7000-bc77-11c0bb5f8bb8","action":"request","method":"POST","path":"/api/v1/platform/register","status":200,"duration_ms":198,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574585198,"service":"erp-api","module":"tenancy-registration","tenant_id":"01a19960-4350-7000-bb73-232d06a45531","country":"YE","msg":"tenant registered via public flow"}
@erp/api:test:db: {"level":30,"time":1793574585199,"service":"erp-api","module":"http","correlation_id":"01a19960-42ce-7000-9a15-d903af95e91d","action":"request","method":"POST","path":"/api/v1/platform/register","status":200,"duration_ms":161,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574585377,"service":"erp-api","module":"tenancy-registration","tenant_id":"01a19960-43fa-7000-be95-d02a94a26c99","country":"YE","msg":"tenant registered via public flow"}
@erp/api:test:db: {"level":30,"time":1793574585377,"service":"erp-api","module":"http","correlation_id":"01a19960-4371-7000-b1fd-e4a32a413058","action":"request","method":"POST","path":"/api/v1/platform/register","status":200,"duration_ms":176,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574585575,"service":"erp-api","module":"tenancy-registration","tenant_id":"01a19960-44c6-7000-a19b-a37975f61309","country":"YE","msg":"tenant registered via public flow"}
@erp/api:test:db: {"level":30,"time":1793574585576,"service":"erp-api","module":"http","correlation_id":"01a19960-4423-7000-aff4-ed8acd0eaf6a","action":"request","method":"POST","path":"/api/v1/platform/register","status":200,"duration_ms":197,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574585578,"service":"erp-api","module":"http","correlation_id":"01a19960-44ea-7000-9268-31178339ad0c","action":"request","method":"POST","path":"/api/v1/platform/register","status":429,"duration_ms":0,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574585745,"service":"erp-api","module":"http","correlation_id":"01a19960-44ec-7000-bceb-e11f85bc2cc4","action":"request","method":"POST","path":"/api/v1/identity/sessions","status":200,"duration_ms":164,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574585798,"service":"erp-api","module":"http","correlation_id":"01a19960-4593-7000-8ddd-1f16a6f75baf","action":"request","method":"POST","path":"/api/v1/tenancy/onboarding/provision","status":200,"duration_ms":51,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574585818,"service":"erp-api","module":"http","correlation_id":"01a19960-45c8-7000-9a75-5e491173634a","action":"request","method":"POST","path":"/api/v1/tenancy/onboarding/provision","status":200,"duration_ms":18,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574586123,"service":"erp-api","module":"http","correlation_id":"01a19960-4684-7000-a11b-55e846e41181","action":"request","method":"POST","path":"/api/v1/identity/sessions","status":200,"duration_ms":135,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574586134,"service":"erp-api","module":"http","correlation_id":"01a19960-470d-7000-808b-1f94b5e29cfe","action":"request","method":"POST","path":"/api/v1/tenancy/branches","status":200,"duration_ms":9,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574586139,"service":"erp-api","module":"http","correlation_id":"01a19960-4717-7000-9d68-2bb0c423eb7d","action":"request","method":"POST","path":"/api/v1/tenancy/branches","status":403,"duration_ms":4,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574586146,"service":"erp-api","module":"http","correlation_id":"01a19960-471c-7000-aa9a-3fc7050b2a13","action":"request","method":"PATCH","path":"/api/v1/tenancy/branches/01a19960-4714-7000-a7ab-0341d5174869","status":200,"duration_ms":6,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574586153,"service":"erp-api","module":"http","correlation_id":"01a19960-4724-7000-aeb8-b900507f7637","action":"request","method":"POST","path":"/api/v1/tenancy/branches","status":409,"duration_ms":5,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574586158,"service":"erp-api","module":"http","correlation_id":"01a19960-472a-7000-a8a0-24461031c8eb","action":"request","method":"GET","path":"/api/v1/tenancy/settings","status":200,"duration_ms":4,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574586164,"service":"erp-api","module":"http","correlation_id":"01a19960-472f-7000-b505-27c0940cab49","action":"request","method":"PUT","path":"/api/v1/tenancy/settings/general.numeral_system","status":200,"duration_ms":5,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574586171,"service":"erp-api","module":"http","correlation_id":"01a19960-4735-7001-b9b1-8a2bf6499e1b","action":"request","method":"PUT","path":"/api/v1/tenancy/settings/does.not_exist","status":422,"duration_ms":6,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574586176,"service":"erp-api","module":"http","correlation_id":"01a19960-473c-7000-9b6e-6f749038c269","action":"request","method":"PUT","path":"/api/v1/tenancy/settings/general.default_locale","status":422,"duration_ms":4,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574586182,"service":"erp-api","module":"http","correlation_id":"01a19960-4742-7000-a450-c567c11ebea6","action":"request","method":"GET","path":"/api/v1/tenancy/entitlements","status":200,"duration_ms":4,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574586355,"service":"erp-api","module":"http","correlation_id":"01a19960-4747-7000-b660-680e6cd5885d","action":"request","method":"POST","path":"/api/v1/identity/sessions","status":200,"duration_ms":172,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574586364,"service":"erp-api","module":"http","correlation_id":"01a19960-47f5-7000-8804-2d708816d1e1","action":"request","method":"GET","path":"/api/v1/platform/tenants?limit=200","status":200,"duration_ms":7,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574586370,"service":"erp-api","module":"http","correlation_id":"01a19960-47fe-7000-85ac-11ce491b1338","action":"request","method":"GET","path":"/api/v1/platform/tenants","status":403,"duration_ms":4,"msg":"request completed"}
@erp/api:test:db: (node:2137) DeprecationWarning: Calling client.query() when the client is already executing a query is deprecated and will be removed in pg@9.0. Use async/await or an external async flow control mechanism instead.
@erp/api:test:db: (Use `node --trace-deprecation ...` to show where the warning was created)
@erp/api:test:db: {"level":30,"time":1793574586381,"service":"erp-api","module":"http","correlation_id":"01a19960-4804-7000-8d62-bef3445b3b79","action":"request","method":"GET","path":"/api/v1/platform/tenants/01a19960-41dc-7000-8d5b-167f5e670f05","status":200,"duration_ms":9,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574586405,"service":"erp-api","module":"http","correlation_id":"01a19960-480f-7000-930f-0ad5722bb65c","action":"request","method":"POST","path":"/api/v1/platform/tenants/01a19960-41dc-7000-8d5b-167f5e670f05/plan","status":200,"duration_ms":22,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574586414,"service":"erp-api","module":"http","correlation_id":"01a19960-4828-7000-9d22-f449fff9b2af","action":"request","method":"POST","path":"/api/v1/platform/tenants/01a19960-41dc-7000-8d5b-167f5e670f05/entitlements","status":200,"duration_ms":6,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574586421,"service":"erp-api","module":"http","correlation_id":"01a19960-4830-7000-ba77-88aee2261cd4","action":"request","method":"POST","path":"/api/v1/platform/tenants/01a19960-41dc-7000-8d5b-167f5e670f05/entitlements","status":422,"duration_ms":5,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574586430,"service":"erp-api","module":"http","correlation_id":"01a19960-4836-7000-8634-1c5a91398356","action":"request","method":"DELETE","path":"/api/v1/platform/tenants/01a19960-41dc-7000-8d5b-167f5e670f05/entitlements/accounting.recurring_journals?reason=cleanup","status":200,"duration_ms":8,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574586437,"service":"erp-api","module":"http","correlation_id":"01a19960-4840-7000-a35d-3941923f46e3","action":"request","method":"GET","path":"/api/v1/platform/audit/events?platformOnly=true&limit=200","status":200,"duration_ms":5,"msg":"request completed"}
@erp/api:test:db: {"level":40,"time":1793574586447,"service":"erp-api","module":"tenancy-lifecycle","tenant_id":"01a19960-41dc-7000-8d5b-167f5e670f05","killed_sessions":2,"msg":"tenant suspended"}
@erp/api:test:db: {"level":30,"time":1793574586447,"service":"erp-api","module":"http","correlation_id":"01a19960-4847-7000-8559-b743dc7a9a07","action":"request","method":"POST","path":"/api/v1/platform/tenants/01a19960-41dc-7000-8d5b-167f5e670f05/suspend","status":200,"duration_ms":8,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574586449,"service":"erp-api","module":"http","correlation_id":"01a19960-4850-7001-a79a-0a4ec41d69e0","action":"request","method":"GET","path":"/api/v1/tenancy/profile","status":401,"duration_ms":1,"msg":"request completed"}
@erp/api:test:db: {"level":40,"time":1793574586611,"service":"erp-api","module":"identity","user_id":"01a19960-41de-7001-9644-821b46394735","msg":"authenticated user has no active membership"}
@erp/api:test:db: {"level":30,"time":1793574586612,"service":"erp-api","module":"http","correlation_id":"01a19960-4853-7000-8b4b-13fd82c45176","action":"request","method":"POST","path":"/api/v1/identity/sessions","status":401,"duration_ms":161,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574586613,"service":"erp-api","module":"notifications","template":"login_notification","correlation_id":"01a19960-22d7-7000-9d29-635b944491f1","msg":"email delivered"}
@erp/api:test:db: {"level":30,"time":1793574586622,"service":"erp-api","module":"http","correlation_id":"01a19960-48f6-7000-9af1-4f1312f9bdc7","action":"request","method":"GET","path":"/api/v1/platform/tenants/01a19960-41dc-7000-8d5b-167f5e670f05","status":200,"duration_ms":8,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574586630,"service":"erp-api","module":"http","correlation_id":"01a19960-4900-7000-87b3-1870ddedd22a","action":"request","method":"POST","path":"/api/v1/platform/tenants/01a19960-41dc-7000-8d5b-167f5e670f05/restore","status":200,"duration_ms":6,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574586767,"service":"erp-api","module":"http","correlation_id":"01a19960-4907-7000-aae7-30b653a9bebc","action":"request","method":"POST","path":"/api/v1/identity/sessions","status":200,"duration_ms":135,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574586773,"service":"erp-api","module":"http","correlation_id":"01a19960-4991-7000-9fcc-f35365f7cdd6","action":"request","method":"GET","path":"/api/v1/tenancy/profile","status":200,"duration_ms":4,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574586780,"service":"erp-api","module":"http","correlation_id":"01a19960-4998-7000-81e5-878bde4f48e8","action":"request","method":"PUT","path":"/api/v1/tenancy/settings/platform.support.opt_in","status":200,"duration_ms":4,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574586787,"service":"erp-api","module":"http","correlation_id":"01a19960-499e-7000-b24f-b5804246db72","action":"request","method":"POST","path":"/api/v1/platform/tenants/01a19960-41dc-7000-8d5b-167f5e670f05/support-sessions","status":200,"duration_ms":5,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574586794,"service":"erp-api","module":"http","correlation_id":"01a19960-49a5-7000-95eb-420dadc60e8e","action":"request","method":"GET","path":"/api/v1/platform/tenants/01a19960-41dc-7000-8d5b-167f5e670f05/support-sessions/01a19960-49a2-7000-9fde-1ce7164823bb/tenant-data/users","status":200,"duration_ms":5,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574586798,"service":"erp-api","module":"http","correlation_id":"01a19960-49ab-7000-877a-be88c6577647","action":"request","method":"GET","path":"/api/v1/tenancy/support-sessions","status":200,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574586805,"service":"erp-api","module":"http","correlation_id":"01a19960-49af-7001-b73e-910050b55a36","action":"request","method":"DELETE","path":"/api/v1/tenancy/support-sessions/01a19960-49a2-7000-9fde-1ce7164823bb","status":200,"duration_ms":6,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574586825,"service":"erp-api","module":"jobs","action":"boss-stopped","msg":"pg-boss queue client stopped"}
@erp/api:test:db:  ✓ src/__db__/tenancy-http.db.spec.ts (16 tests) 2426ms
@erp/api:test:db:    ✓ public registration (anonymous, rate-limited) > per-IP rate limit caps anonymous registrations (429 + Retry-After)  744ms
@erp/api:test:db:    ✓ owner journey: login → onboarding → branches → settings > the viewer joins on the instantiated viewer role (provision made it exist)  304ms
@erp/api:test:db: {"level":30,"time":1793574586879,"service":"erp-api","module":"jobs","action":"boss-started","msg":"pg-boss queue client started"}
@erp/api:test:db: {"level":30,"time":1793574587268,"service":"erp-api","module":"billing-subscriptions","invoice":"BI-2026-0001","paid_via":"provider_webhook","msg":"subscription activated"}
@erp/api:test:db: {"level":30,"time":1793574587325,"service":"erp-api","module":"billing-subscriptions","invoice":"BI-2026-0001","paid_via":"provider_webhook","msg":"subscription activated"}
@erp/api:test:db: {"level":40,"time":1793574587357,"service":"erp-api","module":"billing-subscriptions","tenant_id":"49494949-4949-4949-4949-494949494949","invoice":"BI-2026-0002","msg":"billing grace entered"}
@erp/api:test:db: {"level":30,"time":1793574587384,"service":"erp-api","module":"jobs","action":"boss-started","msg":"pg-boss queue client started"}
@erp/api:test:db: {"level":30,"time":1793574587390,"service":"erp-api","module":"notifications","template":"login_notification","correlation_id":"01a19960-2378-7000-935c-2b977f44b24c","msg":"email delivered"}
@erp/api:test:db: {"level":30,"time":1793574587546,"service":"erp-api","module":"http","correlation_id":"01a19960-4c00-7000-a4da-26e0c1e2b733","action":"request","method":"POST","path":"/api/v1/identity/sessions","status":200,"duration_ms":154,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574587676,"service":"erp-api","module":"http","correlation_id":"01a19960-4c9c-7000-b700-bd632271a11c","action":"request","method":"POST","path":"/api/v1/identity/sessions","status":200,"duration_ms":128,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574587685,"service":"erp-api","module":"http","correlation_id":"01a19960-4d20-7000-9db5-3a35fc060b00","action":"request","method":"POST","path":"/api/v1/identity/invitations","status":403,"duration_ms":5,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574587689,"service":"erp-api","module":"http","correlation_id":"01a19960-4d27-7000-a239-de6d611fb66f","action":"request","method":"POST","path":"/api/v1/identity/invitations/11111111-1111-1111-1111-111111111111/revoke","status":403,"duration_ms":2,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574587693,"service":"erp-api","module":"http","correlation_id":"01a19960-4d2b-7000-bdab-74d666a5e657","action":"request","method":"POST","path":"/api/v1/identity/memberships/11111111-1111-1111-1111-111111111111/revoke","status":403,"duration_ms":2,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574587697,"service":"erp-api","module":"http","correlation_id":"01a19960-4d2f-7000-a8d9-6123a6dfc4a4","action":"request","method":"POST","path":"/api/v1/identity/sessions/11111111-1111-1111-1111-111111111111/revoke","status":403,"duration_ms":2,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574587702,"service":"erp-api","module":"http","correlation_id":"01a19960-4d33-7000-9fb9-36699aa30e8b","action":"request","method":"POST","path":"/api/v1/identity/roles/clone-template","status":403,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574587706,"service":"erp-api","module":"http","correlation_id":"01a19960-4d37-7000-b74d-a2cfad931937","action":"request","method":"POST","path":"/api/v1/identity/roles/11111111-1111-1111-1111-111111111111/grants","status":403,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574587710,"service":"erp-api","module":"http","correlation_id":"01a19960-4d3b-7000-bf91-dd25016e384f","action":"request","method":"PUT","path":"/api/v1/tenancy/profile","status":403,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574587714,"service":"erp-api","module":"http","correlation_id":"01a19960-4d3f-7001-8b0d-a976d8971e32","action":"request","method":"PUT","path":"/api/v1/tenancy/settings/11111111-1111-1111-1111-111111111111","status":403,"duration_ms":2,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574587719,"service":"erp-api","module":"http","correlation_id":"01a19960-4d43-7001-b9fa-07bd6533fea6","action":"request","method":"POST","path":"/api/v1/tenancy/branches","status":403,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574587723,"service":"erp-api","module":"http","correlation_id":"01a19960-4d48-7000-bb61-48bd062ae9f4","action":"request","method":"PATCH","path":"/api/v1/tenancy/branches/11111111-1111-1111-1111-111111111111","status":403,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574587728,"service":"erp-api","module":"http","correlation_id":"01a19960-4d4c-7001-912d-7e84a0565941","action":"request","method":"POST","path":"/api/v1/tenancy/onboarding/provision","status":403,"duration_ms":4,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574587732,"service":"erp-api","module":"http","correlation_id":"01a19960-4d51-7000-a04b-f348bc66dc4c","action":"request","method":"DELETE","path":"/api/v1/tenancy/support-sessions/11111111-1111-1111-1111-111111111111","status":403,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574587737,"service":"erp-api","module":"http","correlation_id":"01a19960-4d56-7000-8b33-7e0579710261","action":"request","method":"POST","path":"/api/v1/partners/partners","status":403,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574587742,"service":"erp-api","module":"http","correlation_id":"01a19960-4d5b-7000-8fd7-d38e6a9ac078","action":"request","method":"PATCH","path":"/api/v1/partners/partners/11111111-1111-1111-1111-111111111111","status":403,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574587746,"service":"erp-api","module":"http","correlation_id":"01a19960-4d60-7000-9c9e-c950253e909b","action":"request","method":"POST","path":"/api/v1/partners/partners/11111111-1111-1111-1111-111111111111/kind","status":403,"duration_ms":2,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574587752,"service":"erp-api","module":"http","correlation_id":"01a19960-4d64-7000-998c-3896d9d188fe","action":"request","method":"POST","path":"/api/v1/partners/partners/11111111-1111-1111-1111-111111111111/archive","status":403,"duration_ms":4,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574587756,"service":"erp-api","module":"http","correlation_id":"01a19960-4d6a-7000-a84d-55efcc656a13","action":"request","method":"POST","path":"/api/v1/partners/partners/11111111-1111-1111-1111-111111111111/contacts","status":403,"duration_ms":2,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574587761,"service":"erp-api","module":"http","correlation_id":"01a19960-4d6e-7000-ada8-2a01263c8c18","action":"request","method":"POST","path":"/api/v1/partners/partners/11111111-1111-1111-1111-111111111111/addresses","status":403,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574587765,"service":"erp-api","module":"http","correlation_id":"01a19960-4d72-7000-9135-88d83b023f84","action":"request","method":"POST","path":"/api/v1/partners/credit-terms","status":403,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574587769,"service":"erp-api","module":"http","correlation_id":"01a19960-4d77-7000-8dd8-f126cc6eaf68","action":"request","method":"PATCH","path":"/api/v1/partners/credit-terms/11111111-1111-1111-1111-111111111111","status":403,"duration_ms":2,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574587773,"service":"erp-api","module":"http","correlation_id":"01a19960-4d7b-7000-836a-ce435616ba37","action":"request","method":"POST","path":"/api/v1/partners/credit-check","status":403,"duration_ms":2,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574587778,"service":"erp-api","module":"http","correlation_id":"01a19960-4d7f-7000-b072-7a2a9b17d882","action":"request","method":"POST","path":"/api/v1/partners/opening-balances","status":403,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574587782,"service":"erp-api","module":"http","correlation_id":"01a19960-4d83-7000-ac44-ab74a1f7da2d","action":"request","method":"PATCH","path":"/api/v1/partners/opening-balances/11111111-1111-1111-1111-111111111111","status":403,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574587786,"service":"erp-api","module":"http","correlation_id":"01a19960-4d88-7000-bf9f-c4b5e0ec85dd","action":"request","method":"POST","path":"/api/v1/partners/partners/11111111-1111-1111-1111-111111111111/attachments","status":403,"duration_ms":2,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574587791,"service":"erp-api","module":"http","correlation_id":"01a19960-4d8c-7000-bd69-bca23c8bb5d2","action":"request","method":"POST","path":"/api/v1/partners/partners/11111111-1111-1111-1111-111111111111/attachments/11111111-1111-1111-1111-111111111111/archive","status":403,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574587797,"service":"erp-api","module":"http","correlation_id":"01a19960-4d91-7000-b193-392ea683d1cb","action":"request","method":"POST","path":"/api/v1/partners/opening-balances/11111111-1111-1111-1111-111111111111/attachments","status":403,"duration_ms":4,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574587801,"service":"erp-api","module":"http","correlation_id":"01a19960-4d96-7000-90d1-f66a9ba4cfda","action":"request","method":"POST","path":"/api/v1/items/items","status":403,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574587805,"service":"erp-api","module":"http","correlation_id":"01a19960-4d9a-7000-a9cb-2267e0dc4860","action":"request","method":"PATCH","path":"/api/v1/items/items/11111111-1111-1111-1111-111111111111","status":403,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574587811,"service":"erp-api","module":"http","correlation_id":"01a19960-4d9e-7000-a588-1d175f2f72a7","action":"request","method":"POST","path":"/api/v1/items/items/11111111-1111-1111-1111-111111111111/archive","status":403,"duration_ms":5,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574587815,"service":"erp-api","module":"http","correlation_id":"01a19960-4da4-7000-ae5d-bc7ad4b387ea","action":"request","method":"POST","path":"/api/v1/items/item-categories","status":403,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574587819,"service":"erp-api","module":"http","correlation_id":"01a19960-4da8-7000-b011-589d6ec73a08","action":"request","method":"PATCH","path":"/api/v1/items/item-categories/11111111-1111-1111-1111-111111111111","status":403,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574587823,"service":"erp-api","module":"http","correlation_id":"01a19960-4dac-7000-a51b-769a3bdefd22","action":"request","method":"POST","path":"/api/v1/items/uoms","status":403,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574587827,"service":"erp-api","module":"http","correlation_id":"01a19960-4db0-7000-96db-2124363dd424","action":"request","method":"PATCH","path":"/api/v1/items/uoms/11111111-1111-1111-1111-111111111111","status":403,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574587841,"service":"erp-api","module":"http","correlation_id":"01a19960-4db4-7000-b90e-d851babe5803","action":"request","method":"POST","path":"/api/v1/items/uom-conversions","status":403,"duration_ms":13,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574587845,"service":"erp-api","module":"http","correlation_id":"01a19960-4dc2-7000-9e60-0ed0b83065c2","action":"request","method":"POST","path":"/api/v1/items/barcodes","status":403,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574587850,"service":"erp-api","module":"http","correlation_id":"01a19960-4dc7-7000-9a8e-55c3354c440a","action":"request","method":"POST","path":"/api/v1/items/price-lists","status":403,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574587853,"service":"erp-api","module":"http","correlation_id":"01a19960-4dcb-7000-a939-df4f76bbeba8","action":"request","method":"PATCH","path":"/api/v1/items/price-lists/11111111-1111-1111-1111-111111111111","status":403,"duration_ms":2,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574587857,"service":"erp-api","module":"http","correlation_id":"01a19960-4dce-7001-b529-117db1b1fbaf","action":"request","method":"POST","path":"/api/v1/items/price-lists/11111111-1111-1111-1111-111111111111/items","status":403,"duration_ms":2,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574587861,"service":"erp-api","module":"http","correlation_id":"01a19960-4dd2-7000-8cbd-f96d2313c979","action":"request","method":"POST","path":"/api/v1/items/resolve-price","status":403,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574587867,"service":"erp-api","module":"http","correlation_id":"01a19960-4dd7-7000-8f30-b7070de0942a","action":"request","method":"POST","path":"/api/v1/items/items/11111111-1111-1111-1111-111111111111/attachments","status":403,"duration_ms":4,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574587872,"service":"erp-api","module":"http","correlation_id":"01a19960-4ddd-7000-8ed0-9360a48abd77","action":"request","method":"POST","path":"/api/v1/items/items/11111111-1111-1111-1111-111111111111/attachments/11111111-1111-1111-1111-111111111111/archive","status":403,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574587876,"service":"erp-api","module":"http","correlation_id":"01a19960-4de1-7000-9b0c-c36aabb193db","action":"request","method":"POST","path":"/api/v1/items/import-jobs","status":403,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574587880,"service":"erp-api","module":"http","correlation_id":"01a19960-4de5-7000-8135-611d26fa8fc6","action":"request","method":"POST","path":"/api/v1/items/import-jobs/11111111-1111-1111-1111-111111111111/commit","status":403,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574587884,"service":"erp-api","module":"http","correlation_id":"01a19960-4de9-7000-ae0f-cfb63149f5d4","action":"request","method":"POST","path":"/api/v1/items/export-jobs","status":403,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574587888,"service":"erp-api","module":"http","correlation_id":"01a19960-4ded-7000-a01a-3906d4a27da0","action":"request","method":"POST","path":"/api/v1/accounting/accounts","status":403,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574587892,"service":"erp-api","module":"http","correlation_id":"01a19960-4df1-7000-80bf-91f332dd81a0","action":"request","method":"PATCH","path":"/api/v1/accounting/accounts/11111111-1111-1111-1111-111111111111","status":403,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574587896,"service":"erp-api","module":"http","correlation_id":"01a19960-4df5-7000-8797-799d3a467dbb","action":"request","method":"POST","path":"/api/v1/accounting/accounts/11111111-1111-1111-1111-111111111111/archive","status":403,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574587900,"service":"erp-api","module":"http","correlation_id":"01a19960-4df9-7001-b6ca-8a10187d930d","action":"request","method":"POST","path":"/api/v1/accounting/purposes","status":403,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574587911,"service":"erp-api","module":"http","correlation_id":"01a19960-4dfd-7000-92d0-b4a06b1bcc06","action":"request","method":"POST","path":"/api/v1/accounting/purposes/11111111-1111-1111-1111-111111111111/supersede","status":403,"duration_ms":10,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574587917,"service":"erp-api","module":"http","correlation_id":"01a19960-4e08-7001-8107-4e8a8d9bf713","action":"request","method":"POST","path":"/api/v1/accounting/fiscal-years","status":403,"duration_ms":4,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574587923,"service":"erp-api","module":"http","correlation_id":"01a19960-4e0e-7000-b4e1-93bdc1ea40a6","action":"request","method":"POST","path":"/api/v1/accounting/periods/11111111-1111-1111-1111-111111111111/soft-close","status":403,"duration_ms":5,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574587927,"service":"erp-api","module":"http","correlation_id":"01a19960-4e14-7000-94ad-62be1e94432f","action":"request","method":"POST","path":"/api/v1/accounting/periods/11111111-1111-1111-1111-111111111111/lock","status":403,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574587931,"service":"erp-api","module":"http","correlation_id":"01a19960-4e18-7000-9282-f6d993d1d626","action":"request","method":"POST","path":"/api/v1/accounting/periods/11111111-1111-1111-1111-111111111111/reopen","status":403,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574587935,"service":"erp-api","module":"http","correlation_id":"01a19960-4e1c-7000-8ad0-079a9f3cb16c","action":"request","method":"POST","path":"/api/v1/accounting/periods/11111111-1111-1111-1111-111111111111/checklist","status":403,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574587939,"service":"erp-api","module":"http","correlation_id":"01a19960-4e20-7000-82bf-c6e9845b4efa","action":"request","method":"POST","path":"/api/v1/accounting/exchange-rates","status":403,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574587943,"service":"erp-api","module":"http","correlation_id":"01a19960-4e24-7000-8536-714c52edf52e","action":"request","method":"POST","path":"/api/v1/accounting/cost-centers","status":403,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574587947,"service":"erp-api","module":"http","correlation_id":"01a19960-4e28-7000-a458-8955e33b9a65","action":"request","method":"PATCH","path":"/api/v1/accounting/cost-centers/11111111-1111-1111-1111-111111111111","status":403,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574587951,"service":"erp-api","module":"http","correlation_id":"01a19960-4e2c-7001-b34c-3813174ef19a","action":"request","method":"POST","path":"/api/v1/accounting/journal-entries","status":403,"duration_ms":2,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574587955,"service":"erp-api","module":"http","correlation_id":"01a19960-4e30-7001-89ad-4cfae547712b","action":"request","method":"PATCH","path":"/api/v1/accounting/journal-entries/11111111-1111-1111-1111-111111111111","status":403,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574587960,"service":"erp-api","module":"http","correlation_id":"01a19960-4e35-7000-ac51-3e2c02103cf7","action":"request","method":"POST","path":"/api/v1/accounting/journal-entries/11111111-1111-1111-1111-111111111111/submit","status":403,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574587964,"service":"erp-api","module":"http","correlation_id":"01a19960-4e39-7000-b458-06347b37a3c0","action":"request","method":"POST","path":"/api/v1/accounting/journal-entries/11111111-1111-1111-1111-111111111111/approve","status":403,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574587968,"service":"erp-api","module":"http","correlation_id":"01a19960-4e3d-7000-b915-44961830e692","action":"request","method":"POST","path":"/api/v1/accounting/journal-entries/11111111-1111-1111-1111-111111111111/post","status":403,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574587973,"service":"erp-api","module":"http","correlation_id":"01a19960-4e41-7000-95eb-246c2f2c5ad8","action":"request","method":"POST","path":"/api/v1/accounting/journal-entries/11111111-1111-1111-1111-111111111111/reverse","status":403,"duration_ms":4,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574587977,"service":"erp-api","module":"http","correlation_id":"01a19960-4e46-7000-a15c-2b8f4d89f21b","action":"request","method":"POST","path":"/api/v1/accounting/journal-entries/11111111-1111-1111-1111-111111111111/cancel","status":403,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574587981,"service":"erp-api","module":"http","correlation_id":"01a19960-4e4a-7001-a325-5e8bc5e42ac0","action":"request","method":"POST","path":"/api/v1/accounting/approval-policies","status":403,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574587985,"service":"erp-api","module":"http","correlation_id":"01a19960-4e4e-7001-a9cb-136aac4b5245","action":"request","method":"POST","path":"/api/v1/accounting/recurring-journals","status":403,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574587989,"service":"erp-api","module":"http","correlation_id":"01a19960-4e52-7000-a5de-3936ccb0ea11","action":"request","method":"POST","path":"/api/v1/accounting/recurring-journals/11111111-1111-1111-1111-111111111111/status","status":403,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574587994,"service":"erp-api","module":"http","correlation_id":"01a19960-4e55-7001-909d-23edc4e353a2","action":"request","method":"POST","path":"/api/v1/accounting/recurring-journals/generate-due","status":403,"duration_ms":5,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574587997,"service":"erp-api","module":"http","correlation_id":"01a19960-4e5b-7000-8068-073bab1efc36","action":"request","method":"POST","path":"/api/v1/accounting/opening-balances/11111111-1111-1111-1111-111111111111/post","status":403,"duration_ms":2,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574588001,"service":"erp-api","module":"http","correlation_id":"01a19960-4e5e-7001-af6a-0425da74d7a8","action":"request","method":"POST","path":"/api/v1/accounting/year-end-close/11111111-1111-1111-1111-111111111111/execute","status":403,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574588012,"service":"erp-api","module":"http","correlation_id":"01a19960-4e69-7000-8ee6-ed8f20f6c837","action":"request","method":"POST","path":"/api/v1/accounting/year-end-close/11111111-1111-1111-1111-111111111111/reverse","status":403,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574588016,"service":"erp-api","module":"http","correlation_id":"01a19960-4e6d-7001-a0ca-296e39667e73","action":"request","method":"POST","path":"/api/v1/accounting/reconciliation/run","status":403,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574588021,"service":"erp-api","module":"http","correlation_id":"01a19960-4e72-7000-b09d-9f2e1c7fadf3","action":"request","method":"POST","path":"/api/v1/treasury/cash-accounts","status":403,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574588025,"service":"erp-api","module":"http","correlation_id":"01a19960-4e76-7000-bff3-941bfd375c18","action":"request","method":"POST","path":"/api/v1/treasury/cash-accounts/11111111-1111-1111-1111-111111111111/close","status":403,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574588032,"service":"erp-api","module":"http","correlation_id":"01a19960-4e7a-7000-9323-3709d4d9529b","action":"request","method":"POST","path":"/api/v1/treasury/receipts","status":403,"duration_ms":6,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574588037,"service":"erp-api","module":"http","correlation_id":"01a19960-4e82-7000-9e59-6c3099edc28a","action":"request","method":"POST","path":"/api/v1/treasury/receipts/11111111-1111-1111-1111-111111111111/submit","status":403,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574588041,"service":"erp-api","module":"http","correlation_id":"01a19960-4e86-7000-9445-1feabe89f81d","action":"request","method":"POST","path":"/api/v1/treasury/receipts/11111111-1111-1111-1111-111111111111/approve","status":403,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574588045,"service":"erp-api","module":"http","correlation_id":"01a19960-4e8a-7000-bfeb-a2787848758c","action":"request","method":"POST","path":"/api/v1/treasury/receipts/11111111-1111-1111-1111-111111111111/post","status":403,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574588050,"service":"erp-api","module":"http","correlation_id":"01a19960-4e8e-7001-851f-1b52a48a40cb","action":"request","method":"POST","path":"/api/v1/treasury/receipts/11111111-1111-1111-1111-111111111111/reverse","status":403,"duration_ms":4,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574588055,"service":"erp-api","module":"http","correlation_id":"01a19960-4e93-7001-97fe-355af4dbbd9a","action":"request","method":"POST","path":"/api/v1/treasury/receipts/11111111-1111-1111-1111-111111111111/cancel","status":403,"duration_ms":4,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574588059,"service":"erp-api","module":"http","correlation_id":"01a19960-4e98-7000-ac58-9cc6e242e326","action":"request","method":"PUT","path":"/api/v1/treasury/receipts/11111111-1111-1111-1111-111111111111/allocations","status":403,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574588064,"service":"erp-api","module":"http","correlation_id":"01a19960-4e9c-7000-b359-997917d73899","action":"request","method":"POST","path":"/api/v1/treasury/payments","status":403,"duration_ms":4,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574588068,"service":"erp-api","module":"http","correlation_id":"01a19960-4ea1-7000-a943-5cf1d18cbd3f","action":"request","method":"POST","path":"/api/v1/treasury/payments/11111111-1111-1111-1111-111111111111/submit","status":403,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574588073,"service":"erp-api","module":"http","correlation_id":"01a19960-4ea5-7000-8186-3d7806025995","action":"request","method":"POST","path":"/api/v1/treasury/payments/11111111-1111-1111-1111-111111111111/approve","status":403,"duration_ms":4,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574588078,"service":"erp-api","module":"http","correlation_id":"01a19960-4eaa-7000-b51a-b09a7c4fb6b3","action":"request","method":"POST","path":"/api/v1/treasury/payments/11111111-1111-1111-1111-111111111111/post","status":403,"duration_ms":4,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574588083,"service":"erp-api","module":"http","correlation_id":"01a19960-4eaf-7001-847f-0bff79b93a98","action":"request","method":"POST","path":"/api/v1/treasury/payments/11111111-1111-1111-1111-111111111111/reverse","status":403,"duration_ms":4,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574588087,"service":"erp-api","module":"http","correlation_id":"01a19960-4eb4-7000-ad0e-e0f73794bf7c","action":"request","method":"POST","path":"/api/v1/treasury/payments/11111111-1111-1111-1111-111111111111/cancel","status":403,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574588092,"service":"erp-api","module":"http","correlation_id":"01a19960-4eb8-7001-8c58-5097af7f62a0","action":"request","method":"PUT","path":"/api/v1/treasury/payments/11111111-1111-1111-1111-111111111111/allocations","status":403,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574588096,"service":"erp-api","module":"http","correlation_id":"01a19960-4ebd-7000-aded-ae28cf905434","action":"request","method":"POST","path":"/api/v1/treasury/expense-categories","status":403,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574588102,"service":"erp-api","module":"http","correlation_id":"01a19960-4ec2-7000-971f-8484fd6147c4","action":"request","method":"POST","path":"/api/v1/treasury/expenses","status":403,"duration_ms":4,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574588106,"service":"erp-api","module":"http","correlation_id":"01a19960-4ec7-7000-82ca-eb59965ea342","action":"request","method":"POST","path":"/api/v1/treasury/expenses/11111111-1111-1111-1111-111111111111/submit","status":403,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574588111,"service":"erp-api","module":"http","correlation_id":"01a19960-4ecb-7001-8138-2f72f877da65","action":"request","method":"POST","path":"/api/v1/treasury/expenses/11111111-1111-1111-1111-111111111111/approve","status":403,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574588115,"service":"erp-api","module":"http","correlation_id":"01a19960-4ed0-7000-a346-b3836771e2cf","action":"request","method":"POST","path":"/api/v1/treasury/expenses/11111111-1111-1111-1111-111111111111/post","status":403,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574588120,"service":"erp-api","module":"http","correlation_id":"01a19960-4ed4-7001-beb1-5a0bdd0c24ac","action":"request","method":"POST","path":"/api/v1/treasury/expenses/11111111-1111-1111-1111-111111111111/cancel","status":403,"duration_ms":4,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574588123,"service":"erp-api","module":"http","correlation_id":"01a19960-4ed9-7000-95e0-956bcffed82c","action":"request","method":"POST","path":"/api/v1/treasury/cash-transfers","status":403,"duration_ms":2,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574588127,"service":"erp-api","module":"http","correlation_id":"01a19960-4edd-7000-b206-6b9bdc9aadc4","action":"request","method":"POST","path":"/api/v1/treasury/cash-transfers/11111111-1111-1111-1111-111111111111/submit","status":403,"duration_ms":2,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574588132,"service":"erp-api","module":"http","correlation_id":"01a19960-4ee1-7000-9ad3-148c47d4b55f","action":"request","method":"POST","path":"/api/v1/treasury/cash-transfers/11111111-1111-1111-1111-111111111111/approve","status":403,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574588135,"service":"erp-api","module":"http","correlation_id":"01a19960-4ee5-7000-8cee-9d03e69e3f8e","action":"request","method":"POST","path":"/api/v1/treasury/cash-transfers/11111111-1111-1111-1111-111111111111/post","status":403,"duration_ms":2,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574588140,"service":"erp-api","module":"http","correlation_id":"01a19960-4ee8-7001-b7a6-471ae57284a9","action":"request","method":"POST","path":"/api/v1/treasury/cash-transfers/11111111-1111-1111-1111-111111111111/cancel","status":403,"duration_ms":4,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574588144,"service":"erp-api","module":"http","correlation_id":"01a19960-4eed-7000-b0fa-f8bb0c45bf01","action":"request","method":"POST","path":"/api/v1/treasury/shifts","status":403,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574588147,"service":"erp-api","module":"http","correlation_id":"01a19960-4ef1-7000-80b0-bb6054e2d7a3","action":"request","method":"POST","path":"/api/v1/treasury/shifts/11111111-1111-1111-1111-111111111111/capture","status":403,"duration_ms":2,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574588153,"service":"erp-api","module":"http","correlation_id":"01a19960-4ef4-7001-ac6d-7359e9547b3d","action":"request","method":"POST","path":"/api/v1/treasury/shifts/11111111-1111-1111-1111-111111111111/close","status":403,"duration_ms":4,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574588157,"service":"erp-api","module":"http","correlation_id":"01a19960-4efa-7000-8bf6-1903fd251246","action":"request","method":"POST","path":"/api/v1/treasury/shifts/11111111-1111-1111-1111-111111111111/cancel","status":403,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574588161,"service":"erp-api","module":"http","correlation_id":"01a19960-4efe-7000-a5b4-3865891da44e","action":"request","method":"POST","path":"/api/v1/treasury/bank-statements/import","status":403,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574588165,"service":"erp-api","module":"http","correlation_id":"01a19960-4f02-7000-8f73-9ca76259b822","action":"request","method":"POST","path":"/api/v1/treasury/bank-statements/11111111-1111-1111-1111-111111111111/auto-match","status":403,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574588169,"service":"erp-api","module":"http","correlation_id":"01a19960-4f06-7000-9477-e444ee681e4d","action":"request","method":"POST","path":"/api/v1/treasury/bank-statements/11111111-1111-1111-1111-111111111111/match","status":403,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574588173,"service":"erp-api","module":"http","correlation_id":"01a19960-4f0a-7000-b857-d6a5ab79b601","action":"request","method":"POST","path":"/api/v1/treasury/bank-statements/11111111-1111-1111-1111-111111111111/reconcile","status":403,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574588177,"service":"erp-api","module":"http","correlation_id":"01a19960-4f0e-7000-aa0f-2536c1cce6de","action":"request","method":"POST","path":"/api/v1/treasury/reconciliation/cash-check","status":403,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574588184,"service":"erp-api","module":"http","correlation_id":"01a19960-4f12-7000-a60f-a2949934239c","action":"request","method":"POST","path":"/api/v1/tax/packs/11111111-1111-1111-1111-111111111111/apply","status":403,"duration_ms":6,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574588188,"service":"erp-api","module":"http","correlation_id":"01a19960-4f19-7000-b7a4-b0da1be8d281","action":"request","method":"POST","path":"/api/v1/tax/tax-codes","status":403,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574588197,"service":"erp-api","module":"http","correlation_id":"01a19960-4f1d-7001-bedb-c4a4d5043c6c","action":"request","method":"POST","path":"/api/v1/tax/tax-codes/11111111-1111-1111-1111-111111111111/archive","status":403,"duration_ms":8,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574588201,"service":"erp-api","module":"http","correlation_id":"01a19960-4f26-7000-a5ad-453004fbc8f3","action":"request","method":"POST","path":"/api/v1/tax/tax-registrations","status":403,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574588205,"service":"erp-api","module":"http","correlation_id":"01a19960-4f2a-7001-a9a0-d92162c4e645","action":"request","method":"POST","path":"/api/v1/tax/resolve-lines","status":403,"duration_ms":2,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574588209,"service":"erp-api","module":"http","correlation_id":"01a19960-4f2f-7000-8340-21699699b0ad","action":"request","method":"POST","path":"/api/v1/tax/vat-returns","status":403,"duration_ms":2,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574588214,"service":"erp-api","module":"http","correlation_id":"01a19960-4f33-7000-8813-63c5295e6f87","action":"request","method":"POST","path":"/api/v1/tax/vat-returns/11111111-1111-1111-1111-111111111111/prepare","status":403,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574588220,"service":"erp-api","module":"http","correlation_id":"01a19960-4f37-7001-90bf-64733e2739c4","action":"request","method":"POST","path":"/api/v1/tax/vat-returns/11111111-1111-1111-1111-111111111111/mark-filed","status":403,"duration_ms":4,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574588225,"service":"erp-api","module":"http","correlation_id":"01a19960-4f3e-7000-9ab1-3a3b95201dfc","action":"request","method":"POST","path":"/api/v1/tax/vat-returns/11111111-1111-1111-1111-111111111111/export","status":403,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574588229,"service":"erp-api","module":"http","correlation_id":"01a19960-4f42-7000-ad16-9f8f105b6b5a","action":"request","method":"POST","path":"/api/v1/tax/reconciliation/vat-check","status":403,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574588234,"service":"erp-api","module":"http","correlation_id":"01a19960-4f46-7001-8273-b5a36931c233","action":"request","method":"POST","path":"/api/v1/tax/einvoicing/submissions","status":403,"duration_ms":4,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574588239,"service":"erp-api","module":"http","correlation_id":"01a19960-4f4b-7000-b988-27ed3a202b22","action":"request","method":"POST","path":"/api/v1/inventory/warehouses","status":403,"duration_ms":4,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574588243,"service":"erp-api","module":"http","correlation_id":"01a19960-4f50-7000-b3a8-4374464f0770","action":"request","method":"POST","path":"/api/v1/inventory/warehouses/11111111-1111-1111-1111-111111111111/update","status":403,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574588247,"service":"erp-api","module":"http","correlation_id":"01a19960-4f54-7001-a232-58369fa5cf76","action":"request","method":"POST","path":"/api/v1/inventory/warehouses/11111111-1111-1111-1111-111111111111/deactivate","status":403,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574588252,"service":"erp-api","module":"http","correlation_id":"01a19960-4f59-7000-b186-ccc2ce5faa00","action":"request","method":"POST","path":"/api/v1/inventory/warehouses/11111111-1111-1111-1111-111111111111/reactivate","status":403,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574588257,"service":"erp-api","module":"http","correlation_id":"01a19960-4f5d-7001-b338-0fe3b3917d4d","action":"request","method":"POST","path":"/api/v1/inventory/item-warehouse-settings","status":403,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574588261,"service":"erp-api","module":"http","correlation_id":"01a19960-4f62-7000-9484-27ab3f4f4147","action":"request","method":"POST","path":"/api/v1/inventory/receipts","status":403,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574588267,"service":"erp-api","module":"http","correlation_id":"01a19960-4f66-7000-b47c-e7beeee24b47","action":"request","method":"POST","path":"/api/v1/inventory/issues","status":403,"duration_ms":5,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574588273,"service":"erp-api","module":"http","correlation_id":"01a19960-4f6c-7001-8cb9-161adc07294f","action":"request","method":"POST","path":"/api/v1/inventory/adjustments","status":403,"duration_ms":5,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574588277,"service":"erp-api","module":"http","correlation_id":"01a19960-4f72-7000-91ec-6194a7e1c049","action":"request","method":"POST","path":"/api/v1/inventory/adjustments/11111111-1111-1111-1111-111111111111/post","status":403,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574588281,"service":"erp-api","module":"http","correlation_id":"01a19960-4f76-7000-a06e-3b835a62223f","action":"request","method":"POST","path":"/api/v1/inventory/adjustments/11111111-1111-1111-1111-111111111111/cancel","status":403,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574588285,"service":"erp-api","module":"http","correlation_id":"01a19960-4f7a-7000-a7e0-82094abf012c","action":"request","method":"POST","path":"/api/v1/inventory/transfers","status":403,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574588288,"service":"erp-api","module":"http","correlation_id":"01a19960-4f7d-7001-9450-c254b379f92d","action":"request","method":"POST","path":"/api/v1/inventory/transfers/11111111-1111-1111-1111-111111111111/dispatch","status":403,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574588292,"service":"erp-api","module":"http","correlation_id":"01a19960-4f81-7000-a631-5cfcab1b23c2","action":"request","method":"POST","path":"/api/v1/inventory/transfers/11111111-1111-1111-1111-111111111111/receive","status":403,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574588296,"service":"erp-api","module":"http","correlation_id":"01a19960-4f85-7000-a22a-12a4217af1a1","action":"request","method":"POST","path":"/api/v1/inventory/transfers/11111111-1111-1111-1111-111111111111/cancel","status":403,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574588300,"service":"erp-api","module":"http","correlation_id":"01a19960-4f88-7001-bdd2-504f6ae043bf","action":"request","method":"POST","path":"/api/v1/inventory/counts","status":403,"duration_ms":4,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574588310,"service":"erp-api","module":"http","correlation_id":"01a19960-4f8d-7000-bfee-f21625be7a82","action":"request","method":"POST","path":"/api/v1/inventory/counts/11111111-1111-1111-1111-111111111111/enter","status":403,"duration_ms":9,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574588314,"service":"erp-api","module":"http","correlation_id":"01a19960-4f97-7000-98d6-30c96a131e70","action":"request","method":"POST","path":"/api/v1/inventory/counts/11111111-1111-1111-1111-111111111111/submit","status":403,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574588318,"service":"erp-api","module":"http","correlation_id":"01a19960-4f9b-7000-ba20-67271bbaef00","action":"request","method":"POST","path":"/api/v1/inventory/counts/11111111-1111-1111-1111-111111111111/recount","status":403,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574588321,"service":"erp-api","module":"http","correlation_id":"01a19960-4f9f-7000-ae25-896ae24ac0f4","action":"request","method":"POST","path":"/api/v1/inventory/counts/11111111-1111-1111-1111-111111111111/approve","status":403,"duration_ms":2,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574588325,"service":"erp-api","module":"http","correlation_id":"01a19960-4fa2-7001-a83a-fef0da065741","action":"request","method":"POST","path":"/api/v1/inventory/counts/11111111-1111-1111-1111-111111111111/cancel","status":403,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574588338,"service":"erp-api","module":"http","correlation_id":"01a19960-4fa6-7000-94eb-3e8ed79ec0b9","action":"request","method":"POST","path":"/api/v1/inventory/batches","status":403,"duration_ms":12,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574588341,"service":"erp-api","module":"http","correlation_id":"01a19960-4fb3-7000-8e66-5530e93dd669","action":"request","method":"POST","path":"/api/v1/inventory/batches/11111111-1111-1111-1111-111111111111/write-off","status":403,"duration_ms":2,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574588345,"service":"erp-api","module":"http","correlation_id":"01a19960-4fb6-7001-b681-89712caf9841","action":"request","method":"POST","path":"/api/v1/inventory/serials","status":403,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574588349,"service":"erp-api","module":"http","correlation_id":"01a19960-4fba-7001-bc9c-8d788ba6b20d","action":"request","method":"POST","path":"/api/v1/inventory/reservations","status":403,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574588353,"service":"erp-api","module":"http","correlation_id":"01a19960-4fbe-7001-824d-fdba777df821","action":"request","method":"POST","path":"/api/v1/inventory/reservations/11111111-1111-1111-1111-111111111111/release","status":403,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574588357,"service":"erp-api","module":"http","correlation_id":"01a19960-4fc2-7001-8059-948e07091079","action":"request","method":"POST","path":"/api/v1/inventory/reservations/11111111-1111-1111-1111-111111111111/consume","status":403,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574588360,"service":"erp-api","module":"http","correlation_id":"01a19960-4fc6-7000-96e9-5f96c2b65511","action":"request","method":"POST","path":"/api/v1/inventory/reservations/sweep-expired","status":403,"duration_ms":2,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574588364,"service":"erp-api","module":"http","correlation_id":"01a19960-4fc9-7001-af3a-c4dd04541e84","action":"request","method":"POST","path":"/api/v1/inventory/reorder/run-scan","status":403,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574588369,"service":"erp-api","module":"http","correlation_id":"01a19960-4fcd-7001-ac55-266abc20bd1d","action":"request","method":"POST","path":"/api/v1/inventory/reconciliation/stock-check","status":403,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574588373,"service":"erp-api","module":"http","correlation_id":"01a19960-4fd2-7000-b1a9-e9b8aa346d5d","action":"request","method":"POST","path":"/api/v1/inventory/items/11111111-1111-1111-1111-111111111111/method-switch","status":403,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574588378,"service":"erp-api","module":"http","correlation_id":"01a19960-4fd6-7001-a59c-c77c4780b523","action":"request","method":"POST","path":"/api/v1/inventory/opening-stock/post","status":403,"duration_ms":4,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574588381,"service":"erp-api","module":"http","correlation_id":"01a19960-4fda-7001-b41b-33700cf99132","action":"request","method":"POST","path":"/api/v1/purchasing/purchase-requests","status":403,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574588384,"service":"erp-api","module":"http","correlation_id":"01a19960-4fde-7000-899f-a3287a496bc8","action":"request","method":"POST","path":"/api/v1/purchasing/purchase-requests/11111111-1111-1111-1111-111111111111/submit","status":403,"duration_ms":2,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574588388,"service":"erp-api","module":"http","correlation_id":"01a19960-4fe1-7001-8391-b1de8321cd91","action":"request","method":"POST","path":"/api/v1/purchasing/purchase-requests/11111111-1111-1111-1111-111111111111/approve","status":403,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574588391,"service":"erp-api","module":"http","correlation_id":"01a19960-4fe5-7000-b5de-d5f5e9a68601","action":"request","method":"POST","path":"/api/v1/purchasing/purchase-requests/11111111-1111-1111-1111-111111111111/reject","status":403,"duration_ms":2,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574588394,"service":"erp-api","module":"http","correlation_id":"01a19960-4fe8-7000-9a2d-957f37e711fd","action":"request","method":"POST","path":"/api/v1/purchasing/purchase-requests/11111111-1111-1111-1111-111111111111/cancel","status":403,"duration_ms":2,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574588412,"service":"erp-api","module":"http","correlation_id":"01a19960-4ff9-7000-8890-1f90510dff57","action":"request","method":"POST","path":"/api/v1/purchasing/purchase-orders","status":403,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574588416,"service":"erp-api","module":"http","correlation_id":"01a19960-4ffd-7000-a588-1aa5f8983bbe","action":"request","method":"POST","path":"/api/v1/purchasing/purchase-orders/11111111-1111-1111-1111-111111111111/submit","status":403,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574588423,"service":"erp-api","module":"http","correlation_id":"01a19960-5001-7001-a0df-46a486ea2793","action":"request","method":"POST","path":"/api/v1/purchasing/purchase-orders/11111111-1111-1111-1111-111111111111/approve","status":403,"duration_ms":6,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574588428,"service":"erp-api","module":"http","correlation_id":"01a19960-5008-7001-9816-25953a6035e1","action":"request","method":"POST","path":"/api/v1/purchasing/purchase-orders/11111111-1111-1111-1111-111111111111/issue","status":403,"duration_ms":4,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574588431,"service":"erp-api","module":"http","correlation_id":"01a19960-500c-7001-88db-54a7dfe9ee9d","action":"request","method":"POST","path":"/api/v1/purchasing/purchase-orders/11111111-1111-1111-1111-111111111111/close","status":403,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574588435,"service":"erp-api","module":"http","correlation_id":"01a19960-5010-7000-9407-fcf08ead3681","action":"request","method":"POST","path":"/api/v1/purchasing/purchase-orders/11111111-1111-1111-1111-111111111111/cancel","status":403,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574588438,"service":"erp-api","module":"http","correlation_id":"01a19960-5013-7001-9e6e-a5a7dac4afff","action":"request","method":"POST","path":"/api/v1/purchasing/goods-receipts","status":403,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574588442,"service":"erp-api","module":"http","correlation_id":"01a19960-5017-7000-ba7a-6681a47aca31","action":"request","method":"POST","path":"/api/v1/purchasing/goods-receipts/11111111-1111-1111-1111-111111111111/post","status":403,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574588446,"service":"erp-api","module":"http","correlation_id":"01a19960-501a-7001-b827-7596e67ce140","action":"request","method":"POST","path":"/api/v1/purchasing/goods-receipts/11111111-1111-1111-1111-111111111111/cancel","status":403,"duration_ms":4,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574588450,"service":"erp-api","module":"http","correlation_id":"01a19960-501f-7000-9f36-5f85f7d014f2","action":"request","method":"POST","path":"/api/v1/purchasing/landed-costs","status":403,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574588453,"service":"erp-api","module":"http","correlation_id":"01a19960-5023-7000-97c6-558643471507","action":"request","method":"POST","path":"/api/v1/purchasing/landed-costs/11111111-1111-1111-1111-111111111111/post","status":403,"duration_ms":2,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574588457,"service":"erp-api","module":"http","correlation_id":"01a19960-5026-7001-9c09-1902fcb90304","action":"request","method":"POST","path":"/api/v1/purchasing/landed-costs/11111111-1111-1111-1111-111111111111/cancel","status":403,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574588461,"service":"erp-api","module":"http","correlation_id":"01a19960-502a-7000-8020-9c084f7efea5","action":"request","method":"POST","path":"/api/v1/purchasing/supplier-invoices","status":403,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574588464,"service":"erp-api","module":"http","correlation_id":"01a19960-502e-7000-a1db-0987f408a317","action":"request","method":"POST","path":"/api/v1/purchasing/supplier-invoices/11111111-1111-1111-1111-111111111111/match","status":403,"duration_ms":2,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574588468,"service":"erp-api","module":"http","correlation_id":"01a19960-5031-7001-a4cb-0cf6d895896e","action":"request","method":"POST","path":"/api/v1/purchasing/supplier-invoices/11111111-1111-1111-1111-111111111111/submit","status":403,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574588472,"service":"erp-api","module":"http","correlation_id":"01a19960-5035-7000-840e-333205f123fa","action":"request","method":"POST","path":"/api/v1/purchasing/supplier-invoices/11111111-1111-1111-1111-111111111111/approve","status":403,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574588476,"service":"erp-api","module":"http","correlation_id":"01a19960-5039-7000-b9fe-cf6d1d426e95","action":"request","method":"POST","path":"/api/v1/purchasing/supplier-invoices/11111111-1111-1111-1111-111111111111/post","status":403,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574588480,"service":"erp-api","module":"http","correlation_id":"01a19960-503c-7001-9a80-04e569321490","action":"request","method":"POST","path":"/api/v1/purchasing/supplier-invoices/11111111-1111-1111-1111-111111111111/cancel","status":403,"duration_ms":4,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574588483,"service":"erp-api","module":"http","correlation_id":"01a19960-5041-7000-9b55-1d285c92e7fc","action":"request","method":"POST","path":"/api/v1/purchasing/debit-notes","status":403,"duration_ms":2,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574588488,"service":"erp-api","module":"http","correlation_id":"01a19960-5044-7001-9b34-4fe967071489","action":"request","method":"POST","path":"/api/v1/purchasing/debit-notes/11111111-1111-1111-1111-111111111111/submit","status":403,"duration_ms":4,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574588492,"service":"erp-api","module":"http","correlation_id":"01a19960-5048-7001-9262-a1a7b2839652","action":"request","method":"POST","path":"/api/v1/purchasing/debit-notes/11111111-1111-1111-1111-111111111111/approve","status":403,"duration_ms":4,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574588495,"service":"erp-api","module":"http","correlation_id":"01a19960-504d-7000-b5ce-48037eb6c9ea","action":"request","method":"POST","path":"/api/v1/purchasing/debit-notes/11111111-1111-1111-1111-111111111111/post","status":403,"duration_ms":2,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574588506,"service":"erp-api","module":"http","correlation_id":"01a19960-5050-7001-962a-b58c1d3cb9e5","action":"request","method":"POST","path":"/api/v1/purchasing/debit-notes/11111111-1111-1111-1111-111111111111/cancel","status":403,"duration_ms":10,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574588519,"service":"erp-api","module":"http","correlation_id":"01a19960-505f-7000-b816-f831c487c9f5","action":"request","method":"POST","path":"/api/v1/purchasing/payments/11111111-1111-1111-1111-111111111111/reallocate","status":403,"duration_ms":8,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574588523,"service":"erp-api","module":"http","correlation_id":"01a19960-5068-7000-9be7-36916ee5e616","action":"request","method":"POST","path":"/api/v1/purchasing/reconciliation/grni-check","status":403,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574588528,"service":"erp-api","module":"http","correlation_id":"01a19960-506c-7001-9993-2e181547ba11","action":"request","method":"POST","path":"/api/v1/sales/quotations","status":403,"duration_ms":4,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574588533,"service":"erp-api","module":"http","correlation_id":"01a19960-5071-7001-acec-9065fe0c542e","action":"request","method":"POST","path":"/api/v1/sales/quotations/11111111-1111-1111-1111-111111111111/send","status":403,"duration_ms":4,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574588537,"service":"erp-api","module":"http","correlation_id":"01a19960-5076-7000-9558-3f40e1ee7fa4","action":"request","method":"POST","path":"/api/v1/sales/quotations/11111111-1111-1111-1111-111111111111/accept","status":403,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574588542,"service":"erp-api","module":"http","correlation_id":"01a19960-507b-7000-acca-c617e56ae575","action":"request","method":"POST","path":"/api/v1/sales/quotations/11111111-1111-1111-1111-111111111111/convert","status":403,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574588547,"service":"erp-api","module":"http","correlation_id":"01a19960-507f-7001-97a5-6c15970c9313","action":"request","method":"POST","path":"/api/v1/sales/quotations/11111111-1111-1111-1111-111111111111/reject","status":403,"duration_ms":4,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574588551,"service":"erp-api","module":"http","correlation_id":"01a19960-5084-7000-9db6-faece35db3de","action":"request","method":"POST","path":"/api/v1/sales/quotations/11111111-1111-1111-1111-111111111111/cancel","status":403,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574588556,"service":"erp-api","module":"http","correlation_id":"01a19960-5089-7000-a4f9-5d60cbca6d42","action":"request","method":"POST","path":"/api/v1/sales/quotations/sweep-expired","status":403,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574588561,"service":"erp-api","module":"http","correlation_id":"01a19960-508e-7000-9f20-95d9e1378914","action":"request","method":"POST","path":"/api/v1/sales/sales-orders","status":403,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574588565,"service":"erp-api","module":"http","correlation_id":"01a19960-5092-7000-bb3e-3b2402237e72","action":"request","method":"POST","path":"/api/v1/sales/sales-orders/11111111-1111-1111-1111-111111111111/submit","status":403,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574588573,"service":"erp-api","module":"http","correlation_id":"01a19960-5096-7000-9f05-863b1e6c2fab","action":"request","method":"POST","path":"/api/v1/sales/sales-orders/11111111-1111-1111-1111-111111111111/approve","status":403,"duration_ms":7,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574588577,"service":"erp-api","module":"http","correlation_id":"01a19960-509e-7000-a7fa-4c30af01c660","action":"request","method":"POST","path":"/api/v1/sales/sales-orders/11111111-1111-1111-1111-111111111111/issue","status":403,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574588583,"service":"erp-api","module":"http","correlation_id":"01a19960-50a2-7000-8856-d61ff918cf55","action":"request","method":"POST","path":"/api/v1/sales/sales-orders/11111111-1111-1111-1111-111111111111/close","status":403,"duration_ms":5,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574588587,"service":"erp-api","module":"http","correlation_id":"01a19960-50a8-7000-9ad2-7f4c20ac091e","action":"request","method":"POST","path":"/api/v1/sales/sales-orders/11111111-1111-1111-1111-111111111111/cancel","status":403,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574588591,"service":"erp-api","module":"http","correlation_id":"01a19960-50ac-7000-8995-e7310fab68ed","action":"request","method":"POST","path":"/api/v1/sales/delivery-notes","status":403,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574588595,"service":"erp-api","module":"http","correlation_id":"01a19960-50b0-7000-bb80-aa7350be7642","action":"request","method":"POST","path":"/api/v1/sales/delivery-notes/11111111-1111-1111-1111-111111111111/post","status":403,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574588599,"service":"erp-api","module":"http","correlation_id":"01a19960-50b4-7000-90f8-13d87d1f3f6c","action":"request","method":"POST","path":"/api/v1/sales/delivery-notes/11111111-1111-1111-1111-111111111111/convert-to-invoice","status":403,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574588603,"service":"erp-api","module":"http","correlation_id":"01a19960-50b8-7000-aa45-b6b53418800d","action":"request","method":"POST","path":"/api/v1/sales/delivery-notes/11111111-1111-1111-1111-111111111111/cancel","status":403,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574588612,"service":"erp-api","module":"http","correlation_id":"01a19960-50bc-7000-bbf1-15e601453a95","action":"request","method":"POST","path":"/api/v1/sales/sales-invoices","status":403,"duration_ms":8,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574588616,"service":"erp-api","module":"http","correlation_id":"01a19960-50c5-7000-950f-4aa76370b991","action":"request","method":"POST","path":"/api/v1/sales/sales-invoices/11111111-1111-1111-1111-111111111111/submit","status":403,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574588620,"service":"erp-api","module":"http","correlation_id":"01a19960-50c9-7001-847d-5ab82f81f4d5","action":"request","method":"POST","path":"/api/v1/sales/sales-invoices/11111111-1111-1111-1111-111111111111/approve","status":403,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574588624,"service":"erp-api","module":"http","correlation_id":"01a19960-50cd-7001-95ca-a8122f58f64f","action":"request","method":"POST","path":"/api/v1/sales/sales-invoices/11111111-1111-1111-1111-111111111111/post","status":403,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574588628,"service":"erp-api","module":"http","correlation_id":"01a19960-50d1-7001-ac26-40065f14a458","action":"request","method":"POST","path":"/api/v1/sales/sales-invoices/11111111-1111-1111-1111-111111111111/cancel","status":403,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574588643,"service":"erp-api","module":"http","correlation_id":"01a19960-50d5-7000-94fb-0522ba0a4b8e","action":"request","method":"POST","path":"/api/v1/sales/credit-notes","status":403,"duration_ms":14,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574588648,"service":"erp-api","module":"http","correlation_id":"01a19960-50e4-7001-bb3a-57c07f9f1c7a","action":"request","method":"POST","path":"/api/v1/sales/credit-notes/11111111-1111-1111-1111-111111111111/submit","status":403,"duration_ms":4,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574588654,"service":"erp-api","module":"http","correlation_id":"01a19960-50ea-7000-ae17-0ea6859d3133","action":"request","method":"POST","path":"/api/v1/sales/credit-notes/11111111-1111-1111-1111-111111111111/approve","status":403,"duration_ms":4,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574588658,"service":"erp-api","module":"http","correlation_id":"01a19960-50ef-7000-8b72-aa028e666b09","action":"request","method":"POST","path":"/api/v1/sales/credit-notes/11111111-1111-1111-1111-111111111111/post","status":403,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574588662,"service":"erp-api","module":"http","correlation_id":"01a19960-50f3-7001-b710-557b97a16516","action":"request","method":"POST","path":"/api/v1/sales/credit-notes/11111111-1111-1111-1111-111111111111/cancel","status":403,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574588666,"service":"erp-api","module":"http","correlation_id":"01a19960-50f7-7001-ab01-295e1e3580d9","action":"request","method":"POST","path":"/api/v1/sales/receipts/11111111-1111-1111-1111-111111111111/reallocate","status":403,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574588671,"service":"erp-api","module":"http","correlation_id":"01a19960-50fc-7000-9c21-b74a34ba4c0f","action":"request","method":"POST","path":"/api/v1/sales/partners/11111111-1111-1111-1111-111111111111/credit-check","status":403,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574588675,"service":"erp-api","module":"http","correlation_id":"01a19960-5100-7000-aa7c-efa338f03409","action":"request","method":"POST","path":"/api/v1/partners/partners/11111111-1111-1111-1111-111111111111/credit-check","status":403,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574588679,"service":"erp-api","module":"http","correlation_id":"01a19960-5104-7001-8663-9ad528a1eb8a","action":"request","method":"POST","path":"/api/v1/sales/reps","status":403,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574588683,"service":"erp-api","module":"http","correlation_id":"01a19960-5108-7001-adb5-a44a40fe8728","action":"request","method":"POST","path":"/api/v1/sales/reps/11111111-1111-1111-1111-111111111111/activate","status":403,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574588688,"service":"erp-api","module":"http","correlation_id":"01a19960-510c-7001-ab2b-5e7c9c3f2f3e","action":"request","method":"POST","path":"/api/v1/sales/reps/11111111-1111-1111-1111-111111111111/deactivate","status":403,"duration_ms":4,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574588692,"service":"erp-api","module":"http","correlation_id":"01a19960-5111-7000-b112-41abe74c71b1","action":"request","method":"POST","path":"/api/v1/sales/jobs/invoice-overdue/run-scan","status":403,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574588697,"service":"erp-api","module":"http","correlation_id":"01a19960-5116-7000-a6a7-ecd8c56952d8","action":"request","method":"POST","path":"/api/v1/tenancy/branches","status":403,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574588703,"service":"erp-api","module":"http","correlation_id":"01a19960-511a-7000-9b4e-9c0ee3b6fba9","action":"request","method":"GET","path":"/api/v1/tenancy/subscriptions","status":200,"duration_ms":5,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574588712,"service":"erp-api","module":"http","correlation_id":"01a19960-5120-7000-bc6c-31ad61e76450","action":"request","method":"GET","path":"/api/v1/tenancy/usage","status":200,"duration_ms":8,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574588716,"service":"erp-api","module":"http","correlation_id":"01a19960-5129-7000-80c2-81637e36b168","action":"request","method":"GET","path":"/api/v1/tenancy/entitlements","status":200,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574588720,"service":"erp-api","module":"http","correlation_id":"01a19960-512d-7000-af88-8f46fe0a7bcb","action":"request","method":"GET","path":"/api/v1/tenancy/subscriptions","status":403,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574588723,"service":"erp-api","module":"http","correlation_id":"01a19960-5130-7000-9a74-ab6b7a04547b","action":"request","method":"GET","path":"/api/v1/tenancy/usage","status":403,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574588727,"service":"erp-api","module":"http","correlation_id":"01a19960-5134-7000-b2aa-f690f7970c6e","action":"request","method":"GET","path":"/api/v1/tenancy/entitlements","status":200,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574588732,"service":"erp-api","module":"http","correlation_id":"01a19960-5138-7000-99e4-fbdaf407bbdc","action":"request","method":"GET","path":"/api/v1/reporting/reports","status":200,"duration_ms":4,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574588746,"service":"erp-api","module":"http","correlation_id":"01a19960-513e-7000-bb21-559dafeb3b57","action":"request","method":"POST","path":"/api/v1/reporting/report-runs","status":200,"duration_ms":12,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574588752,"service":"erp-api","module":"http","correlation_id":"01a19960-514b-7000-ac4a-41a143e1aff4","action":"request","method":"POST","path":"/api/v1/reporting/report-runs/11111111-1111-1111-1111-111111111111/exports","status":404,"duration_ms":5,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574588756,"service":"erp-api","module":"http","correlation_id":"01a19960-5151-7000-ab2d-d3c5e4c37c62","action":"request","method":"GET","path":"/api/v1/notifications","status":200,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574588760,"service":"erp-api","module":"http","correlation_id":"01a19960-5155-7000-8876-782c1b65bffc","action":"request","method":"PATCH","path":"/api/v1/notifications/01a19960-4bdb-7000-a6a4-4c6ff50297a2/read","status":200,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574588764,"service":"erp-api","module":"http","correlation_id":"01a19960-5159-7000-aa5f-df71d03a84d1","action":"request","method":"PUT","path":"/api/v1/notifications/preferences","status":200,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574588772,"service":"erp-api","module":"http","correlation_id":"01a19960-515d-7001-ba79-424d09fce52b","action":"request","method":"POST","path":"/api/v1/tenancy/subscriptions/change-plan","status":200,"duration_ms":7,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574588776,"service":"erp-api","module":"http","correlation_id":"01a19960-5165-7000-8425-e57481788d97","action":"request","method":"POST","path":"/api/v1/tenancy/branches","status":403,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574588781,"service":"erp-api","module":"jobs","action":"boss-stopped","msg":"pg-boss queue client stopped"}
@erp/api:test:db:  ✓ src/__db__/billing/readonly-sweep.db.spec.ts (6 tests) 1912ms
@erp/api:test:db:    ✓ read-only grace sweep (T5) > every state-changing registered route returns 403 tenancy/subscription-read-only  1015ms
@erp/api:test:db:  ✓ src/__db__/reporting/asof.spec.ts (2 tests) 1338ms
@erp/api:test:db:    ✓ as-of freeze (posted_at cutoff) > entries posted AFTER the freeze never leak into the as-of snapshot  1250ms
@erp/api:test:db:  ✓ src/__db__/migrations.db.spec.ts (7 tests) 1436ms
@erp/api:test:db:    ✓ migration state > re-apply (regression shape) is a no-op: drizzle-kit migrate skips applied entries  1179ms
@erp/api:test:db:  ✓ src/__db__/master-data-perf.db.spec.ts (3 tests) 1000ms
@erp/api:test:db: {"level":30,"time":1793574593038,"service":"erp-api","module":"jobs","action":"boss-started","msg":"pg-boss queue client started"}
@erp/api:test:db: {"level":30,"time":1793574593060,"service":"erp-api","module":"notifications","template":"login_notification","correlation_id":"01a19960-240c-7000-8da6-e8a12a98d4b9","msg":"email delivered"}
@erp/api:test:db: {"level":30,"time":1793574593216,"service":"erp-api","module":"http","correlation_id":"01a19960-621b-7000-a389-d8ebeb942d2b","action":"request","method":"POST","path":"/api/v1/identity/sessions","status":200,"duration_ms":165,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574593385,"service":"erp-api","module":"http","correlation_id":"01a19960-62c3-7000-8fa7-8a961eb215cc","action":"request","method":"POST","path":"/api/v1/identity/sessions","status":401,"duration_ms":166,"msg":"request completed"}
@erp/api:test:db: {"level":40,"time":1793574593388,"service":"erp-api","module":"identity","email_hash":"63bc7e40b1ca","msg":"login attempt for unknown email"}
@erp/api:test:db: {"level":30,"time":1793574593388,"service":"erp-api","module":"http","correlation_id":"01a19960-636b-7000-8b27-f48c6e3ee8bb","action":"request","method":"POST","path":"/api/v1/identity/sessions","status":401,"duration_ms":1,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574593552,"service":"erp-api","module":"http","correlation_id":"01a19960-636e-7000-9b34-e8d593613f16","action":"request","method":"POST","path":"/api/v1/identity/sessions","status":200,"duration_ms":162,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574593555,"service":"erp-api","module":"http","correlation_id":"01a19960-6412-7000-9bc4-eeec3c58e47b","action":"request","method":"GET","path":"/api/v1/identity/users","status":401,"duration_ms":1,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574593573,"service":"erp-api","module":"http","correlation_id":"01a19960-6420-7000-8dfb-cfb4b05ed804","action":"request","method":"GET","path":"/api/v1/identity/users","status":403,"duration_ms":5,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574593587,"service":"erp-api","module":"http","correlation_id":"01a19960-642d-7000-bb44-a7c15f7aa25a","action":"request","method":"GET","path":"/api/v1/identity/users","status":200,"duration_ms":6,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574593593,"service":"erp-api","module":"http","correlation_id":"01a19960-6435-7000-8c8f-9a7fd003fff7","action":"request","method":"GET","path":"/api/v1/identity/sessions/current","status":200,"duration_ms":4,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574593600,"service":"erp-api","module":"http","correlation_id":"01a19960-643b-7000-9f0b-730a1d16a52c","action":"request","method":"POST","path":"/api/v1/identity/sessions/switch-tenant","status":404,"duration_ms":4,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574593607,"service":"erp-api","module":"http","correlation_id":"01a19960-6441-7000-86db-10aafb0eff7f","action":"request","method":"GET","path":"/api/v1/audit/events","status":200,"duration_ms":6,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574593612,"service":"erp-api","module":"http","correlation_id":"01a19960-6448-7000-b636-c2ea816f1351","action":"request","method":"GET","path":"/api/v1/audit/events","status":403,"duration_ms":4,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574593616,"service":"erp-api","module":"http","correlation_id":"01a19960-644d-7000-9e38-256edce8214c","action":"request","method":"POST","path":"/api/v1/identity/invitations","status":422,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574593764,"service":"erp-api","module":"http","correlation_id":"01a19960-6451-7000-833a-fd995ec5859f","action":"request","method":"POST","path":"/api/v1/identity/sessions","status":200,"duration_ms":147,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574593771,"service":"erp-api","module":"http","correlation_id":"01a19960-64e5-7000-b9f3-967ed2bb3540","action":"request","method":"DELETE","path":"/api/v1/identity/sessions/current","status":200,"duration_ms":6,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574593774,"service":"erp-api","module":"http","correlation_id":"01a19960-64ec-7000-b428-d30d9b5c5512","action":"request","method":"GET","path":"/api/v1/identity/sessions/current","status":401,"duration_ms":2,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574593782,"service":"erp-api","module":"http","correlation_id":"01a19960-64f0-7000-b359-4a74dd6937df","action":"request","method":"POST","path":"/api/v1/identity/mfa/totp/enroll","status":200,"duration_ms":6,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574593791,"service":"erp-api","module":"http","correlation_id":"01a19960-64f8-7000-9ed7-7624492e8ec9","action":"request","method":"POST","path":"/api/v1/identity/mfa/totp/verify","status":200,"duration_ms":7,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574593951,"service":"erp-api","module":"http","correlation_id":"01a19960-6500-7000-bf2c-124df468a29d","action":"request","method":"POST","path":"/api/v1/identity/sessions","status":423,"duration_ms":159,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574593959,"service":"erp-api","module":"http","correlation_id":"01a19960-65a1-7000-9050-8fd76539c18b","action":"request","method":"POST","path":"/api/v1/identity/password-resets","status":200,"duration_ms":6,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574593961,"service":"erp-api","module":"identity","email_domain":"exist.test","msg":"reset requested for unknown email"}
@erp/api:test:db: {"level":30,"time":1793574593962,"service":"erp-api","module":"http","correlation_id":"01a19960-65a8-7001-8cb4-82f27ecbe7da","action":"request","method":"POST","path":"/api/v1/identity/password-resets","status":200,"duration_ms":2,"msg":"request completed"}
@erp/api:test:db:  ✓ src/__db__/identity-http.db.spec.ts (12 tests) 1326ms
@erp/api:test:db:    ✓ login surface (public) > issues a session token with the data envelope; wrong password is a uniform 401  347ms
@erp/api:test:db: {"level":30,"time":1793574593966,"service":"erp-api","module":"jobs","action":"boss-stopped","msg":"pg-boss queue client stopped"}
@erp/api:test:db:  ✓ src/__db__/reporting/render.spec.ts (2 tests) 1373ms
@erp/api:test:db:  ✓ src/__db__/purchasing/ap.spec.ts (12 tests) 1044ms
@erp/api:test:db:    ✓ RC-02/RC-03 — AP subledger = AP_CONTROL exact, drift detected > RC-02: 20 randomized AP operations reconcile exactly (OK run)  497ms
@erp/api:test:db: {"level":30,"time":1793574596529,"service":"erp-api","module":"jobs","action":"boss-started","msg":"pg-boss queue client started"}
@erp/api:test:db: {"level":30,"time":1793574596905,"service":"erp-api","module":"jobs","action":"boss-started","msg":"pg-boss queue client started"}
@erp/api:test:db: {"level":30,"time":1793574596915,"service":"erp-api","module":"notifications","template":"login_notification","correlation_id":"01a19960-24a6-7000-9db0-a9bf7fb2afce","msg":"email delivered"}
@erp/api:test:db: {"level":30,"time":1793574597086,"service":"erp-api","module":"http","correlation_id":"01a19960-7135-7000-adb5-41f97a871801","action":"request","method":"POST","path":"/api/v1/identity/sessions","status":200,"duration_ms":169,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574597256,"service":"erp-api","module":"http","correlation_id":"01a19960-71e1-7000-ab23-83157c84951b","action":"request","method":"POST","path":"/api/v1/identity/sessions","status":200,"duration_ms":167,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574597291,"service":"erp-api","module":"http","correlation_id":"01a19960-72a6-7000-9cae-a56be8eb4164","action":"request","method":"GET","path":"/api/v1/notifications/unread-count","status":200,"duration_ms":5,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574597296,"service":"erp-api","module":"http","correlation_id":"01a19960-72ac-7000-af66-1d1c2d87f2a5","action":"request","method":"GET","path":"/api/v1/notifications?limit=50","status":200,"duration_ms":4,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574597301,"service":"erp-api","module":"http","correlation_id":"01a19960-72b2-7000-b451-bceb93ac361c","action":"request","method":"PATCH","path":"/api/v1/notifications/01a19960-728c-7000-a86e-acc29eafd7d7/read","status":200,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574597306,"service":"erp-api","module":"http","correlation_id":"01a19960-72b6-7000-8673-8252119975d6","action":"request","method":"GET","path":"/api/v1/notifications/unread-count","status":200,"duration_ms":4,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574597311,"service":"erp-api","module":"http","correlation_id":"01a19960-72bb-7000-87eb-8925d146421c","action":"request","method":"PATCH","path":"/api/v1/notifications/01a19960-728c-7000-a86e-acc29eafd7d7/read","status":200,"duration_ms":4,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574597317,"service":"erp-api","module":"http","correlation_id":"01a19960-72c1-7000-9c35-84e1b656a242","action":"request","method":"PUT","path":"/api/v1/notifications/preferences","status":200,"duration_ms":4,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574597323,"service":"erp-api","module":"http","correlation_id":"01a19960-72c6-7000-9184-0551107f3dae","action":"request","method":"GET","path":"/api/v1/notifications/preferences","status":200,"duration_ms":5,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574597329,"service":"erp-api","module":"http","correlation_id":"01a19960-72ce-7000-bbc7-9110b2a93139","action":"request","method":"GET","path":"/api/v1/notifications?limit=50","status":200,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574597334,"service":"erp-api","module":"http","correlation_id":"01a19960-72d3-7000-ba16-0e396d2a616f","action":"request","method":"GET","path":"/api/v1/notifications/unread-count","status":200,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574597339,"service":"erp-api","module":"http","correlation_id":"01a19960-72d7-7000-b18f-c4afec564a76","action":"request","method":"GET","path":"/api/v1/notifications?unread=true&limit=50","status":200,"duration_ms":4,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574597341,"service":"erp-api","module":"jobs","action":"boss-stopped","msg":"pg-boss queue client stopped"}
@erp/api:test:db:  ✓ src/__db__/notifications/inbox.db.spec.ts (6 tests) 826ms
@erp/api:test:db: {"level":30,"time":1793574597589,"service":"erp-api","module":"tenancy-registration","tenant_id":"01a19960-73aa-7000-a7c4-ab7c557580a1","country":"SA","msg":"tenant registered via public flow"}
@erp/api:test:db: {"level":30,"time":1793574597855,"service":"erp-api","module":"tenancy-registration","tenant_id":"01a19960-74ba-7000-a926-c0e572a9dc81","country":"YE","msg":"tenant registered via public flow"}
@erp/api:test:db: {"level":30,"time":1793574598077,"service":"erp-api","module":"tenancy-registration","tenant_id":"01a19960-759c-7000-8153-73233a244a29","country":"SA","msg":"tenant registered via public flow"}
@erp/api:test:db:  ✓ src/__db__/tenancy-provisioning.db.spec.ts (4 tests) 796ms
@erp/api:test:db: {"level":30,"time":1793574598433,"service":"erp-api","module":"jobs","action":"boss-started","msg":"pg-boss queue client started"}
@erp/api:test:db: {"level":30,"time":1793574598463,"service":"erp-api","module":"notifications","template":"login_notification","correlation_id":"01a19960-254b-7000-b309-95034748eab1","msg":"email delivered"}
@erp/api:test:db: {"level":30,"time":1793574598625,"service":"erp-api","module":"http","correlation_id":"01a19960-7729-7000-8ec2-8055cc783d36","action":"request","method":"POST","path":"/api/v1/identity/sessions","status":200,"duration_ms":184,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574598789,"service":"erp-api","module":"http","correlation_id":"01a19960-77e3-7000-a986-39125fac0619","action":"request","method":"POST","path":"/api/v1/identity/sessions","status":200,"duration_ms":162,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574598804,"service":"erp-api","module":"http","correlation_id":"01a19960-7887-7000-ba21-098d2e2efa97","action":"request","method":"POST","path":"/api/v1/partners/partners","status":200,"duration_ms":13,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574598813,"service":"erp-api","module":"http","correlation_id":"01a19960-7895-7000-99af-646464231f5a","action":"request","method":"GET","path":"/api/v1/partners/partners","status":200,"duration_ms":8,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574598817,"service":"erp-api","module":"http","correlation_id":"01a19960-789e-7000-9b89-2c6e9cb2a54b","action":"request","method":"POST","path":"/api/v1/partners/partners","status":403,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574598823,"service":"erp-api","module":"http","correlation_id":"01a19960-78a3-7000-8ca0-fd28b9a65dc6","action":"request","method":"POST","path":"/api/v1/items/import-jobs","status":403,"duration_ms":4,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574598826,"service":"erp-api","module":"http","correlation_id":"01a19960-78a8-7000-be6e-2ed5abd8e29a","action":"request","method":"POST","path":"/api/v1/partners/partners","status":422,"duration_ms":1,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574598852,"service":"erp-api","module":"http","correlation_id":"01a19960-78b4-7000-ab60-840359ab4542","action":"request","method":"POST","path":"/api/v1/partners/partners","status":404,"duration_ms":16,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574598876,"service":"erp-api","module":"http","correlation_id":"01a19960-78d6-7000-94d2-bd8fcb1bdd3c","action":"request","method":"PATCH","path":"/api/v1/partners/partners/01a19960-7891-7000-afee-ee42b6cb0be0","status":404,"duration_ms":6,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574598888,"service":"erp-api","module":"http","correlation_id":"01a19960-78e4-7000-9117-b7398b5275bd","action":"request","method":"GET","path":"/api/v1/partners/partners/01a19960-78e3-7000-9ca0-d1d6987e50d6","status":404,"duration_ms":4,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574598896,"service":"erp-api","module":"http","correlation_id":"01a19960-78e9-7000-8267-da994c8c75f7","action":"request","method":"GET","path":"/api/v1/partners/partners/01a19960-7631-7003-8d99-9103abf55700","status":404,"duration_ms":7,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574598903,"service":"erp-api","module":"http","correlation_id":"01a19960-78f2-7000-9daf-8c221d0171a0","action":"request","method":"GET","path":"/api/v1/partners/partners","status":200,"duration_ms":5,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574598909,"service":"erp-api","module":"http","correlation_id":"01a19960-78f8-7000-94f7-f644fd1e8580","action":"request","method":"GET","path":"/api/v1/items/uoms","status":200,"duration_ms":5,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574598914,"service":"erp-api","module":"http","correlation_id":"01a19960-78fe-7000-bfc7-b309d62aefb3","action":"request","method":"GET","path":"/api/v1/partners/credit-terms","status":200,"duration_ms":4,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574598922,"service":"erp-api","module":"http","correlation_id":"01a19960-7904-7000-8d56-1cc7c1682388","action":"request","method":"POST","path":"/api/v1/partners/partners","status":200,"duration_ms":6,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574598929,"service":"erp-api","module":"http","correlation_id":"01a19960-790b-7000-9823-f867c1a10144","action":"request","method":"POST","path":"/api/v1/partners/partners","status":200,"duration_ms":6,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574598936,"service":"erp-api","module":"http","correlation_id":"01a19960-7912-7000-a436-a4a4b10539b0","action":"request","method":"POST","path":"/api/v1/partners/partners","status":200,"duration_ms":6,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574598944,"service":"erp-api","module":"http","correlation_id":"01a19960-7919-7000-81bb-013da68c4ab3","action":"request","method":"POST","path":"/api/v1/partners/partners","status":200,"duration_ms":7,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574598952,"service":"erp-api","module":"http","correlation_id":"01a19960-7921-7000-a443-8426bae60647","action":"request","method":"POST","path":"/api/v1/partners/partners","status":200,"duration_ms":6,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574598957,"service":"erp-api","module":"http","correlation_id":"01a19960-7928-7000-ad7e-d5c8faf351b6","action":"request","method":"GET","path":"/api/v1/partners/partners?limit=3","status":200,"duration_ms":4,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574598962,"service":"erp-api","module":"http","correlation_id":"01a19960-792e-7000-a80c-2c775947b62d","action":"request","method":"GET","path":"/api/v1/partners/partners?limit=3&cursor=eyJvZmZzZXQiOjN9","status":200,"duration_ms":4,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574598967,"service":"erp-api","module":"http","correlation_id":"01a19960-7934-7000-a5de-b46be94d5596","action":"request","method":"GET","path":"/api/v1/partners/search?q=%D8%A7%D9%84%D8%B9%D8%A7%D9%84%D9%85%D9%8A%D8%A9","status":200,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574598984,"service":"erp-api","module":"http","correlation_id":"01a19960-7940-7000-bb87-dace0b52254f","action":"request","method":"POST","path":"/api/v1/items/items","status":200,"duration_ms":8,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574598991,"service":"erp-api","module":"http","correlation_id":"01a19960-7949-7001-bf8c-3947b57fee8c","action":"request","method":"POST","path":"/api/v1/items/resolve-price","status":200,"duration_ms":6,"msg":"request completed"}
@erp/api:test:db:  ✓ src/__db__/master-data-http.db.spec.ts (10 tests) 813ms
@erp/api:test:db: {"level":30,"time":1793574598996,"service":"erp-api","module":"jobs","action":"boss-stopped","msg":"pg-boss queue client stopped"}
@erp/api:test:db: stdout | src/__db__/accounting/posting-smoke.local.spec.ts > PHASE-007 posting smoke (k6-equivalent, smoke tier) > posts under 5 concurrent workers measure p95 < 500ms with zero failures
@erp/api:test:db: [posting-smoke] n=100 p50=29.7ms p95=63.6ms max=93.6ms failures=0
@erp/api:test:db: 
@erp/api:test:db:  ✓ src/__db__/accounting/posting-smoke.local.spec.ts (1 test) 804ms
@erp/api:test:db:    ✓ PHASE-007 posting smoke (k6-equivalent, smoke tier) > posts under 5 concurrent workers measure p95 < 500ms with zero failures  803ms
@erp/api:test:db: {"level":30,"time":1793574599876,"service":"erp-api","module":"jobs","action":"boss-started","msg":"pg-boss queue client started"}
@erp/api:test:db: {"level":30,"time":1793574600132,"service":"erp-api","module":"billing-subscriptions","invoice":"BI-2026-0001","paid_via":"provider_webhook","msg":"subscription activated"}
@erp/api:test:db: {"level":30,"time":1793574600160,"service":"erp-api","module":"jobs","action":"boss-started","msg":"pg-boss queue client started"}
@erp/api:test:db: {"level":30,"time":1793574600168,"service":"erp-api","module":"notifications","template":"login_notification","correlation_id":"01a19960-25e9-7000-a8c6-98bd6ef5f509","msg":"email delivered"}
@erp/api:test:db: {"level":30,"time":1793574600350,"service":"erp-api","module":"http","correlation_id":"01a19960-7de7-7000-b834-13ddbce29d80","action":"request","method":"POST","path":"/api/v1/identity/sessions","status":200,"duration_ms":183,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574600421,"service":"erp-api","module":"http","correlation_id":"01a19960-7ed4-7000-8ba7-afb1b2bee850","action":"request","method":"POST","path":"/api/v1/identity/invitations","status":422,"duration_ms":17,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574600433,"service":"erp-api","module":"http","correlation_id":"01a19960-7ee7-7000-82a0-f6af8e3d8ddd","action":"request","method":"GET","path":"/api/v1/tenancy/usage","status":200,"duration_ms":10,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574600439,"service":"erp-api","module":"http","correlation_id":"01a19960-7ef3-7000-8576-07c20d9804ce","action":"request","method":"GET","path":"/api/v1/tenancy/subscriptions","status":200,"duration_ms":4,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574600447,"service":"erp-api","module":"http","correlation_id":"01a19960-7ef9-7000-a396-0def01322ea7","action":"request","method":"POST","path":"/api/v1/tenancy/branches","status":200,"duration_ms":6,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574600454,"service":"erp-api","module":"http","correlation_id":"01a19960-7f01-7000-84e9-6246ff9248cf","action":"request","method":"POST","path":"/api/v1/tenancy/branches","status":200,"duration_ms":5,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574600460,"service":"erp-api","module":"http","correlation_id":"01a19960-7f07-7001-bbc7-f8da35a6a60e","action":"request","method":"POST","path":"/api/v1/tenancy/branches","status":200,"duration_ms":5,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574600465,"service":"erp-api","module":"http","correlation_id":"01a19960-7f0d-7001-bbb3-b7d83832e307","action":"request","method":"POST","path":"/api/v1/tenancy/branches","status":422,"duration_ms":4,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574600472,"service":"erp-api","module":"http","correlation_id":"01a19960-7f13-7000-8d04-b19b4c667e34","action":"request","method":"GET","path":"/api/v1/tenancy/branches","status":200,"duration_ms":5,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574600486,"service":"erp-api","module":"http","correlation_id":"01a19960-7f19-7000-be65-1316be3714bf","action":"request","method":"POST","path":"/api/v1/inventory/warehouses","status":201,"duration_ms":13,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574600495,"service":"erp-api","module":"http","correlation_id":"01a19960-7f28-7000-b5bd-0046cb7e6eab","action":"request","method":"POST","path":"/api/v1/inventory/warehouses","status":201,"duration_ms":7,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574600503,"service":"erp-api","module":"http","correlation_id":"01a19960-7f30-7000-ae37-a548633d3d81","action":"request","method":"POST","path":"/api/v1/inventory/warehouses","status":201,"duration_ms":7,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574600510,"service":"erp-api","module":"http","correlation_id":"01a19960-7f38-7000-b829-19b8ce925bda","action":"request","method":"POST","path":"/api/v1/inventory/warehouses","status":201,"duration_ms":6,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574600518,"service":"erp-api","module":"http","correlation_id":"01a19960-7f3f-7000-b128-a3261af661b4","action":"request","method":"POST","path":"/api/v1/inventory/warehouses","status":201,"duration_ms":7,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574600525,"service":"erp-api","module":"http","correlation_id":"01a19960-7f47-7001-abfd-076ee51c548f","action":"request","method":"POST","path":"/api/v1/inventory/warehouses","status":201,"duration_ms":6,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574600529,"service":"erp-api","module":"http","correlation_id":"01a19960-7f4e-7000-a837-bd9fa812f9bd","action":"request","method":"POST","path":"/api/v1/inventory/warehouses","status":422,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574600575,"service":"erp-api","module":"billing-subscriptions","invoice":"BI-2026-0001","paid_via":"provider_webhook","msg":"subscription activated"}
@erp/api:test:db: {"level":30,"time":1793574600597,"service":"erp-api","module":"jobs","action":"boss-stopped","msg":"pg-boss queue client stopped"}
@erp/api:test:db:  ✓ src/__db__/billing/usage-limits.db.spec.ts (8 tests) 734ms
@erp/api:test:db:  ✓ src/__db__/sales/golden.spec.ts (10 tests) 551ms
@erp/api:test:db: {"level":30,"time":1793574601433,"service":"erp-api","module":"tenancy-registration","tenant_id":"01a19960-82b9-7000-9f11-d1a656d84753","country":"SA","msg":"tenant registered via public flow"}
@erp/api:test:db: {"level":30,"time":1793574601620,"service":"erp-api","module":"tenancy-registration","tenant_id":"01a19960-8378-7000-a675-2a1bacc3ac83","country":"YE","msg":"tenant registered via public flow"}
@erp/api:test:db: {"level":40,"time":1793574601643,"service":"erp-api","module":"tenancy-lifecycle","tenant_id":"01a19960-82b9-7000-9f11-d1a656d84753","killed_sessions":1,"msg":"tenant suspended"}
@erp/api:test:db: {"level":40,"time":1793574601684,"service":"erp-api","module":"tenancy-lifecycle","tenant_id":"01a19960-82b9-7000-9f11-d1a656d84753","killed_sessions":0,"msg":"tenant suspended"}
@erp/api:test:db: {"level":40,"time":1793574601824,"service":"erp-api","module":"tenancy-lifecycle","tenant_id":"01a19960-8378-7000-a675-2a1bacc3ac83","killed_sessions":0,"msg":"tenant suspended"}
@erp/api:test:db:  ✓ src/__db__/platform-lifecycle.db.spec.ts (16 tests) 597ms
@erp/api:test:db: 2026-11-01 23:10:01.876 UTC [3130] ERROR:  duplicate key value violates unique constraint "uq_journal_entries_tenant_source_op"
@erp/api:test:db: 2026-11-01 23:10:01.876 UTC [3130] STATEMENT:  
@erp/api:test:db: 	    INSERT INTO journal_entries (id, tenant_id, entry_no, entry_date, fiscal_period_id, currency_code,
@erp/api:test:db: 	                                 exchange_rate, status, source_type, source_id, operation,
@erp/api:test:db: 	                                 reversal_of_id, description, description_ar, post_reason, posted_by)
@erp/api:test:db: 	    VALUES ($1, erp.current_tenant_id(), $2, $3,
@erp/api:test:db: 	            $4, $5, $6, 'POSTED',
@erp/api:test:db: 	            $7, $8, $9, $10,
@erp/api:test:db: 	            $11, $12,
@erp/api:test:db: 	            $13, $14)
@erp/api:test:db: 	    RETURNING id, entry_no AS "entryNo", entry_date AS "entryDate",
@erp/api:test:db: 	  fiscal_period_id AS "fiscalPeriodId", currency_code AS "currencyCode", exchange_rate AS "exchangeRate",
@erp/api:test:db: 	  status, source_type AS "sourceType", source_id AS "sourceId", operation,
@erp/api:test:db: 	  reversal_of_id AS "reversalOfId", reversed_by_id AS "reversedById",
@erp/api:test:db: 	  description, description_ar AS "descriptionAr", post_reason AS "postReason",
@erp/api:test:db: 	  posted_at AS "postedAt", posted_by AS "postedBy"
@erp/api:test:db: 	  
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:10:02.349 UTC [3163] ERROR:  PERIOD_LOCKED: entry date falls in a LOCKED fiscal period
@erp/api:test:db: 2026-11-01 23:10:02.349 UTC [3163] CONTEXT:  PL/pgSQL function erp.journal_entry_period_check() line 9 at RAISE
@erp/api:test:db: 2026-11-01 23:10:02.349 UTC [3163] STATEMENT:  commit
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:10:02.350 UTC [3163] WARNING:  there is no transaction in progress
@erp/api:test:db: 
@erp/api:test:db:  ✓ src/__db__/accounting/concurrency/concurrency.spec.ts (4 tests) 523ms
@erp/api:test:db:    ✓ CC-03 — sequence numbering race (50 parallel posts) > 50 unique official numbers, no gaps/collisions, no deadlocks  459ms
@erp/api:test:db:  ✓ src/__db__/treasury/golden.spec.ts (14 tests) 512ms
@erp/api:test:db: {"level":30,"time":1793574603116,"service":"erp-api","module":"tenancy-registration","tenant_id":"01a19960-894f-7000-a49d-58d067ff7438","country":"SA","msg":"tenant registered via public flow"}
@erp/api:test:db: {"level":30,"time":1793574603278,"service":"erp-api","module":"tenancy-registration","tenant_id":"01a19960-89ed-7000-9696-33dc0d733efd","country":"AE","msg":"tenant registered via public flow"}
@erp/api:test:db:  ✓ src/__db__/entitlements.db.spec.ts (11 tests) 389ms
@erp/api:test:db: {"level":30,"time":1793574603371,"service":"erp-api","module":"jobs","action":"boss-started","msg":"pg-boss queue client started"}
@erp/api:test:db: {"level":30,"time":1793574603463,"service":"erp-api","module":"billing-subscriptions","invoice":"BI-2026-0001","paid_via":"provider_webhook","msg":"subscription activated"}
@erp/api:test:db: {"level":40,"time":1793574603534,"service":"erp-api","module":"billing-subscriptions","tenant_id":"44444444-4444-4444-4444-444444444444","invoice":"BI-2026-0002","msg":"billing grace entered"}
@erp/api:test:db: {"level":40,"time":1793574603571,"service":"erp-api","module":"tenancy-lifecycle","tenant_id":"44444444-4444-4444-4444-444444444444","killed_sessions":0,"msg":"tenant suspended"}
@erp/api:test:db: {"level":30,"time":1793574603619,"service":"erp-api","module":"billing-subscriptions","invoice":"BI-2026-0002","paid_via":"manual_recorded","msg":"subscription activated"}
@erp/api:test:db: {"level":30,"time":1793574603729,"service":"erp-api","module":"jobs","action":"boss-stopped","msg":"pg-boss queue client stopped"}
@erp/api:test:db:  ✓ src/__db__/billing/lifecycle.db.spec.ts (9 tests) 376ms
@erp/api:test:db:  ✓ src/__db__/purchasing/golden.spec.ts (10 tests) 365ms
@erp/api:test:db:  ✓ src/__db__/accounting/golden/golden.spec.ts (8 tests) 335ms
@erp/api:test:db: 2026-11-01 23:10:04.722 UTC [3197] ERROR:  permission denied for table tax_document_summaries
@erp/api:test:db: 2026-11-01 23:10:04.722 UTC [3197] STATEMENT:  UPDATE tax_document_summaries SET tax_amount = 28 WHERE tenant_id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:10:04.790 UTC [3202] ERROR:  permission denied for table jurisdictions
@erp/api:test:db: 2026-11-01 23:10:04.790 UTC [3202] STATEMENT:  INSERT INTO jurisdictions (id, country_code, country_name, country_name_ar, currency_code, minor_units, vat_status, pack_version, descriptor, source_ref)
@erp/api:test:db: 	       VALUES ('99999999-0000-4000-8000-000000000001', 'ZZ', 'X', 'س', 'SAR', 2, 'NO_VAT', '1', '{}', 'x')
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:10:04.790 UTC [3202] ERROR:  permission denied for table jurisdictions
@erp/api:test:db: 2026-11-01 23:10:04.790 UTC [3202] STATEMENT:  UPDATE jurisdictions SET pack_version = '9' WHERE country_code = 'SA'
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:10:04.791 UTC [3202] ERROR:  permission denied for table jurisdiction_tax_rates
@erp/api:test:db: 2026-11-01 23:10:04.791 UTC [3202] STATEMENT:  DELETE FROM jurisdiction_tax_rates WHERE rate = 15
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:10:04.792 UTC [3202] ERROR:  permission denied for table tax_treatments
@erp/api:test:db: 2026-11-01 23:10:04.792 UTC [3202] STATEMENT:  UPDATE tax_treatments SET name = 'X' WHERE key = 'EXEMPT'
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:10:04.793 UTC [3202] ERROR:  permission denied for table tax_treatments
@erp/api:test:db: 2026-11-01 23:10:04.793 UTC [3202] STATEMENT:  INSERT INTO tax_treatments (key, name, name_ar, taxable, sort_order) VALUES ('X', 'X', 'س', true, 9)
@erp/api:test:db: 
@erp/api:test:db:  ✓ src/__db__/tax/vat-return.spec.ts (13 tests) 278ms
@erp/api:test:db: 2026-11-01 23:10:05.121 UTC [3213] ERROR:  permission denied for table cash_movements
@erp/api:test:db: 2026-11-01 23:10:05.121 UTC [3213] STATEMENT:  UPDATE cash_movements SET amount = 999 WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:10:05.122 UTC [3213] ERROR:  permission denied for table cash_movements
@erp/api:test:db: 2026-11-01 23:10:05.122 UTC [3213] STATEMENT:  DELETE FROM cash_movements WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:10:05.129 UTC [3214] ERROR:  cash_movements are append-only (INV-019): UPDATE on row 01a19960-90f6-7000-8d57-3f6c720cebf6 is forbidden
@erp/api:test:db: 2026-11-01 23:10:05.129 UTC [3214] CONTEXT:  PL/pgSQL function erp.cash_movements_guard() line 3 at RAISE
@erp/api:test:db: 2026-11-01 23:10:05.129 UTC [3214] STATEMENT:  UPDATE cash_movements SET amount = 999 WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db:  ✓ src/__db__/treasury/invariants.spec.ts (7 tests) 291ms
@erp/api:test:db:  ✓ src/__db__/inventory/golden.spec.ts (9 tests) 256ms
@erp/api:test:db:  ✓ src/__db__/tax/pack-eg.spec.ts (10 tests) 194ms
@erp/api:test:db:  ✓ src/__db__/tax/pack-om.spec.ts (10 tests) 189ms
@erp/api:test:db: {"level":30,"time":1793574605853,"service":"erp-api","module":"jobs","action":"boss-started","msg":"pg-boss queue client started"}
@erp/api:test:db: {"level":30,"time":1793574605966,"service":"erp-api","module":"jobs","action":"boss-started","msg":"pg-boss queue client started"}
@erp/api:test:db: {"level":30,"time":1793574605972,"service":"erp-api","module":"notifications","template":"login_notification","correlation_id":"01a19960-2689-7000-95fc-b12dc0053f83","msg":"email delivered"}
@erp/api:test:db: {"level":30,"time":1793574605982,"service":"erp-api","module":"http","correlation_id":"01a19960-949d-7000-b2d4-d891a221f5c4","action":"request","method":"POST","path":"/api/v1/platform/billing/webhook","status":400,"duration_ms":1,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574605988,"service":"erp-api","module":"http","correlation_id":"01a19960-94a3-7000-9716-98a7c073379f","action":"request","method":"POST","path":"/api/v1/platform/billing/webhook","status":400,"duration_ms":1,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574606032,"service":"erp-api","module":"billing-subscriptions","invoice":"BI-2026-0003","paid_via":"provider_webhook","msg":"subscription activated"}
@erp/api:test:db: {"level":30,"time":1793574606033,"service":"erp-api","module":"http","correlation_id":"01a19960-94a8-7000-90d4-b15486c4748b","action":"request","method":"POST","path":"/api/v1/platform/billing/webhook","status":200,"duration_ms":41,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574606041,"service":"erp-api","module":"http","correlation_id":"01a19960-94d7-7000-8a08-03bb588729b1","action":"request","method":"POST","path":"/api/v1/platform/billing/webhook","status":200,"duration_ms":2,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574606045,"service":"erp-api","module":"http","correlation_id":"01a19960-94dc-7000-bd45-52a8fa7a36c3","action":"request","method":"POST","path":"/api/v1/platform/billing/webhook","status":404,"duration_ms":1,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793574606089,"service":"erp-api","module":"billing-subscriptions","invoice":"BI-2026-0001","paid_via":"manual_recorded","msg":"subscription activated"}
@erp/api:test:db: {"level":30,"time":1793574606120,"service":"erp-api","module":"jobs","action":"boss-stopped","msg":"pg-boss queue client stopped"}
@erp/api:test:db:  ✓ src/__db__/billing/webhook-http.db.spec.ts (7 tests) 278ms
@erp/api:test:db:  ✓ src/__db__/tax/pack-ae.spec.ts (10 tests) 214ms
@erp/api:test:db:  ✓ src/__db__/purchasing/landed-costs.spec.ts (3 tests) 150ms
@erp/api:test:db:  ✓ src/__db__/treasury/treasury-rules.spec.ts (7 tests) 184ms
@erp/api:test:db:  ✓ src/__db__/tax/pack-jo.spec.ts (10 tests) 183ms
@erp/api:test:db:  ✓ src/__db__/tax/pack-bh.spec.ts (10 tests) 186ms
@erp/api:test:db:  ✓ src/__db__/purchasing/matching.spec.ts (7 tests) 198ms
@erp/api:test:db: 2026-11-01 23:10:07.454 UTC [3262] ERROR:  PERIOD_LOCKED: entry date falls in a LOCKED fiscal period
@erp/api:test:db: 2026-11-01 23:10:07.454 UTC [3262] CONTEXT:  PL/pgSQL function erp.journal_entry_period_check() line 9 at RAISE
@erp/api:test:db: 2026-11-01 23:10:07.454 UTC [3262] STATEMENT:  COMMIT
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:10:07.537 UTC [3264] ERROR:  duplicate key value violates unique constraint "uq_number_assignments_scope_number"
@erp/api:test:db: 2026-11-01 23:10:07.537 UTC [3264] DETAIL:  Key (tenant_id, doc_type, COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'::uuid), number)=(33333333-3333-3333-3333-333333333333, probe_doc, 00000000-0000-0000-0000-000000000000, PRB-2026-000001) already exists.
@erp/api:test:db: 2026-11-01 23:10:07.537 UTC [3264] STATEMENT:  INSERT INTO number_assignments (id, tenant_id, doc_type, period_key, number, value)
@erp/api:test:db: 	         VALUES ($1, $2, 'probe_doc', '2026', $3, 999)
@erp/api:test:db: 
@erp/api:test:db:  ✓ src/__db__/accounting/invariants/INV-011-022.spec.ts (8 tests) 149ms
@erp/api:test:db:  ✓ src/__db__/inventory/method-switch.spec.ts (3 tests) 150ms
@erp/api:test:db:  ✓ src/__db__/inventory/counts.spec.ts (4 tests) 129ms
@erp/api:test:db:  ✓ src/__db__/inventory/tracking.spec.ts (6 tests) 156ms
@erp/api:test:db:  ✓ src/__db__/inventory/valuation-ledger.spec.ts (6 tests) 162ms
@erp/api:test:db: 2026-11-01 23:10:08.333 UTC [3268] ERROR:  permission denied for table journal_lines
@erp/api:test:db: 2026-11-01 23:10:08.333 UTC [3268] STATEMENT:  UPDATE journal_lines SET amount = 999 WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:10:08.335 UTC [3268] ERROR:  permission denied for table journal_entries
@erp/api:test:db: 2026-11-01 23:10:08.335 UTC [3268] STATEMENT:  DELETE FROM journal_entries WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:10:08.336 UTC [3268] ERROR:  permission denied for table journal_entries
@erp/api:test:db: 2026-11-01 23:10:08.336 UTC [3268] STATEMENT:  UPDATE journal_entries SET description = 'hacked' WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:10:08.357 UTC [3269] ERROR:  journal_entries are append-only (INV-003): only the reversal link (status→REVERSED, reversed_by_id) may change
@erp/api:test:db: 2026-11-01 23:10:08.357 UTC [3269] CONTEXT:  PL/pgSQL function erp.journal_entries_guard() line 28 at RAISE
@erp/api:test:db: 2026-11-01 23:10:08.357 UTC [3269] STATEMENT:  UPDATE journal_entries SET status = 'REVERSED', version = version + 1 WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db:  ✓ src/__db__/accounting/invariants/INV-001-009.spec.ts (16 tests) 205ms
@erp/api:test:db:  ✓ src/__db__/accounting/periods/periods.spec.ts (5 tests) 168ms
@erp/api:test:db:  ✓ src/__db__/tax/pack-sa.spec.ts (10 tests) 116ms
@erp/api:test:db:  ✓ src/__db__/reporting/exports.spec.ts (4 tests) 122ms
@erp/api:test:db:  ✓ src/__db__/master-data-flows.db.spec.ts (14 tests) 137ms
@erp/api:test:db: 2026-11-01 23:10:09.277 UTC [3288] ERROR:  stock_moves are append-only (INV-010): DELETE on row 0bad0bad-0000-4000-8000-000000000001 is forbidden
@erp/api:test:db: 2026-11-01 23:10:09.277 UTC [3288] CONTEXT:  PL/pgSQL function erp.stock_moves_guard() line 3 at RAISE
@erp/api:test:db: 2026-11-01 23:10:09.277 UTC [3288] STATEMENT:  DELETE FROM stock_moves WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db:  ✓ src/__db__/inventory/recon.spec.ts (3 tests) 176ms
@erp/api:test:db: 2026-11-01 23:10:09.433 UTC [3292] ERROR:  duplicate key value violates unique constraint "uq_journal_entries_tenant_source_op"
@erp/api:test:db: 2026-11-01 23:10:09.433 UTC [3292] STATEMENT:  
@erp/api:test:db: 	    INSERT INTO journal_entries (id, tenant_id, entry_no, entry_date, fiscal_period_id, currency_code,
@erp/api:test:db: 	                                 exchange_rate, status, source_type, source_id, operation,
@erp/api:test:db: 	                                 reversal_of_id, description, description_ar, post_reason, posted_by)
@erp/api:test:db: 	    VALUES ($1, erp.current_tenant_id(), $2, $3,
@erp/api:test:db: 	            $4, $5, $6, 'POSTED',
@erp/api:test:db: 	            $7, $8, $9, $10,
@erp/api:test:db: 	            $11, $12,
@erp/api:test:db: 	            $13, $14)
@erp/api:test:db: 	    RETURNING id, entry_no AS "entryNo", entry_date AS "entryDate",
@erp/api:test:db: 	  fiscal_period_id AS "fiscalPeriodId", currency_code AS "currencyCode", exchange_rate AS "exchangeRate",
@erp/api:test:db: 	  status, source_type AS "sourceType", source_id AS "sourceId", operation,
@erp/api:test:db: 	  reversal_of_id AS "reversalOfId", reversed_by_id AS "reversedById",
@erp/api:test:db: 	  description, description_ar AS "descriptionAr", post_reason AS "postReason",
@erp/api:test:db: 	  posted_at AS "postedAt", posted_by AS "postedBy"
@erp/api:test:db: 	  
@erp/api:test:db: 
@erp/api:test:db:  ✓ src/__db__/purchasing/operations.spec.ts (9 tests) 117ms
@erp/api:test:db:  ✓ src/__db__/treasury/bank-rec.spec.ts (11 tests) 119ms
@erp/api:test:db: 2026-11-01 23:10:09.621 UTC [3296] ERROR:  new row violates row-level security policy for table "audit_events"
@erp/api:test:db: 2026-11-01 23:10:09.621 UTC [3296] STATEMENT:  INSERT INTO audit_events (id, tenant_id, action, entity_type, entity_id)
@erp/api:test:db: 	         VALUES ('aaaaaaaa-3333-4333-8333-333333333333', $1, 'forged.created', 'x', $1)
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:10:09.635 UTC [3298] ERROR:  permission denied for table audit_events
@erp/api:test:db: 2026-11-01 23:10:09.635 UTC [3298] STATEMENT:  DELETE FROM audit_events WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:10:09.650 UTC [3300] ERROR:  permission denied for table audit_events
@erp/api:test:db: 2026-11-01 23:10:09.650 UTC [3300] STATEMENT:  UPDATE audit_events SET action = 'hacked' WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:10:09.650 UTC [3300] ERROR:  permission denied for table audit_events
@erp/api:test:db: 2026-11-01 23:10:09.650 UTC [3300] STATEMENT:  DELETE FROM audit_events WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:10:09.657 UTC [3301] ERROR:  audit_events are append-only (INV-003 substrate): UPDATE prohibited
@erp/api:test:db: 2026-11-01 23:10:09.657 UTC [3301] CONTEXT:  PL/pgSQL function erp.audit_events_guard() line 3 at RAISE
@erp/api:test:db: 2026-11-01 23:10:09.657 UTC [3301] STATEMENT:  UPDATE audit_events SET action = 'hacked' WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:10:09.658 UTC [3301] ERROR:  audit_events are append-only (INV-003 substrate): DELETE prohibited
@erp/api:test:db: 2026-11-01 23:10:09.658 UTC [3301] CONTEXT:  PL/pgSQL function erp.audit_events_guard() line 3 at RAISE
@erp/api:test:db: 2026-11-01 23:10:09.658 UTC [3301] STATEMENT:  DELETE FROM audit_events WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:10:09.675 UTC [3303] ERROR:  insert or update on table "_infra_probe_child" violates foreign key constraint "fk__infra_probe_tenant"
@erp/api:test:db: 2026-11-01 23:10:09.675 UTC [3303] DETAIL:  Key (probe_id, tenant_id)=(bbbbbbbb-1111-4111-8111-111111111111, 22222222-2222-2222-2222-222222222222) is not present in table "_infra_probe".
@erp/api:test:db: 2026-11-01 23:10:09.675 UTC [3303] STATEMENT:  INSERT INTO _infra_probe_child (id, probe_id, tenant_id)
@erp/api:test:db: 	         VALUES ('cccccccc-2222-4222-8222-222222222222', $1, $2)
@erp/api:test:db: 
@erp/api:test:db:  ✓ src/__db__/rls-attacks.db.spec.ts (9 tests) 99ms
@erp/api:test:db: 2026-11-01 23:10:09.744 UTC [3311] ERROR:  new row violates row-level security policy for table "audit_events"
@erp/api:test:db: 2026-11-01 23:10:09.744 UTC [3311] STATEMENT:  INSERT INTO audit_events (id, tenant_id, action, entity_type, entity_id, via_platform_admin)
@erp/api:test:db: 	         VALUES ('cccccccc-9000-4000-8000-000000000009', $1, 'forge.tenant', 'tenant', $1, true)
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:10:09.750 UTC [3312] ERROR:  new row violates row-level security policy for table "audit_events"
@erp/api:test:db: 2026-11-01 23:10:09.750 UTC [3312] STATEMENT:  INSERT INTO audit_events (id, tenant_id, action, entity_type, entity_id, via_platform_admin)
@erp/api:test:db: 	         VALUES ('cccccccc-9000-4000-8000-00000000000a', NULL, 'forge.platform', 'tenant', $1, true)
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:10:09.757 UTC [3313] ERROR:  new row violates row-level security policy for table "plans"
@erp/api:test:db: 2026-11-01 23:10:09.757 UTC [3313] STATEMENT:  INSERT INTO plans (id, key, name, name_ar, price_amount, currency_code, limits, feature_keys)
@erp/api:test:db: 	         VALUES ('31111111-0000-4000-8000-00000000000f', 'rogue', 'Rogue', 'م rogue', 0, 'SAR',
@erp/api:test:db: 	                 '{}'::jsonb, ARRAY['platform.registration'])
@erp/api:test:db: 
@erp/api:test:db:  ✓ src/__db__/isolation/platform-isolation.db.spec.ts (12 tests) 90ms
@erp/api:test:db:  ✓ src/__db__/tax/pack-qa.spec.ts (3 tests) 83ms
@erp/api:test:db:  ✓ src/__db__/reporting/runs.spec.ts (5 tests) 90ms
@erp/api:test:db:  ✓ src/__db__/tax/pack-ye.spec.ts (3 tests) 76ms
@erp/api:test:db:  ✓ src/__db__/tax/pack-iq.spec.ts (3 tests) 78ms
@erp/api:test:db:  ✓ src/__db__/accounting/gl-perf.db.spec.ts (3 tests) 80ms
@erp/api:test:db:  ✓ src/__db__/tax/pack-kw.spec.ts (3 tests) 90ms
@erp/api:test:db:  ✓ src/__db__/reporting/dashboard.db.spec.ts (7 tests) 40ms
@erp/api:test:db:  ✓ src/__db__/reporting/golden.spec.ts (6 tests) 55ms
@erp/api:test:db:  ✓ src/__db__/tax/spoof.spec.ts (5 tests) 28ms
@erp/api:test:db:  ✓ src/__db__/treasury/spoof.spec.ts (5 tests) 27ms
@erp/api:test:db:  ✓ src/__db__/files.db.spec.ts (4 tests) 23ms
@erp/api:test:db: {"level":30,"time":1793574610608,"service":"erp-api","module":"jobs","action":"boss-started","msg":"pg-boss queue client started"}
@erp/api:test:db: {"level":30,"time":1793574610622,"service":"erp-api","module":"jobs","action":"boss-stopped","msg":"pg-boss queue client stopped"}
@erp/api:test:db:  ✓ src/__db__/readiness.db.spec.ts (4 tests) 22ms
@erp/api:test:db:  ✓ src/__db__/tenant-context.db.spec.ts (4 tests) 14ms
@erp/api:test:db: 
@erp/api:test:db:  Test Files  69 passed (69)
@erp/api:test:db:       Tests  1153 passed (1153)
@erp/api:test:db:    Start at  23:09:01
@erp/api:test:db:    Duration  69.24s (transform 2.39s, setup 0ms, collect 4.67s, tests 61.12s, environment 0ms, prepare 54ms)
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:10:10.656 UTC [2078] LOG:  received fast shutdown request
@erp/api:test:db: 2026-11-01 23:10:10.656 UTC [2078] LOG:  aborting any active transactions
@erp/api:test:db: 2026-11-01 23:10:10.656 UTC [3337] FATAL:  terminating connection due to administrator command
@erp/api:test:db: 2026-11-01 23:10:10.656 UTC [2815] FATAL:  terminating connection due to administrator command
@erp/api:test:db: 2026-11-01 23:10:10.657 UTC [2173] FATAL:  terminating connection due to administrator command
@erp/api:test:db: 2026-11-01 23:10:10.659 UTC [2171] FATAL:  terminating connection due to administrator command
@erp/api:test:db: 2026-11-01 23:10:10.660 UTC [2078] LOG:  background worker "logical replication launcher" (PID 2084) exited with exit code 1
@erp/api:test:db: 2026-11-01 23:10:10.664 UTC [2079] LOG:  shutting down
@erp/api:test:db: 2026-11-01 23:10:10.664 UTC [2079] LOG:  checkpoint starting: shutdown immediate
@erp/api:test:db: 
@erp/api:test:db: (node:2137) DeprecationWarning: Client.activeQuery is deprecated and will be removed in pg@9.0
@erp/api:test:db: (node:2137) DeprecationWarning: Client.queryQueue is deprecated and will be removed in pg@9.0.
@erp/api:test:db: 2026-11-01 23:10:10.733 UTC [2079] LOG:  checkpoint complete: wrote 14354 buffers (87.6%); 0 WAL file(s) added, 0 removed, 14 recycled; write=0.066 s, sync=0.003 s, total=0.070 s; sync files=1295, longest=0.001 s, average=0.000 s; distance=226757 kB, estimate=226757 kB; lsn=0/F250020, redo lsn=0/F250020
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 23:10:10.756 UTC [2078] LOG:  database system is shut down
@erp/api:test:db: 

 Tasks:    1 successful, 1 total
Cached:    0 cached, 1 total
  Time:    1m10.285s 

STEP 6 EXIT 0

=== build ===

> erp-platform@0.1.0 build /home/z/my-project/extracted_phase013
> turbo run build


   • turbo 2.11.10
   • Packages in scope: @erp/api, @erp/config, @erp/contracts, @erp/domain-core, @erp/ui, @erp/web
   • Running build in 6 packages
   • Remote caching disabled

@erp/domain-core:build: cache hit, replaying logs 8984482349f7d203
@erp/domain-core:build: 
@erp/domain-core:build: > @erp/domain-core@0.1.0 build /home/z/my-project/extracted_phase013/packages/domain-core
@erp/domain-core:build: > tsc --noEmit -p tsconfig.json
@erp/domain-core:build: 
@erp/contracts:build: cache hit, replaying logs 194152092d642aec
@erp/contracts:build: 
@erp/contracts:build: > @erp/contracts@0.1.0 build /home/z/my-project/extracted_phase013/packages/contracts
@erp/contracts:build: > tsc --noEmit -p tsconfig.json
@erp/contracts:build: 
@erp/ui:build: cache miss, executing 170759ffa3e11013
@erp/ui:build: 
@erp/ui:build: > @erp/ui@1.0.0 build /home/z/my-project/extracted_phase013/packages/ui
@erp/ui:build: > tsc --noEmit -p tsconfig.json
@erp/ui:build: 
@erp/web:build: cache miss, executing 69da6ff405548244
@erp/api:build: cache miss, executing 95aca31af8330cb7
@erp/web:build: 
@erp/web:build: > @erp/web@0.1.0 build /home/z/my-project/extracted_phase013/apps/web
@erp/web:build: > next build
@erp/web:build: 
@erp/api:build: 
@erp/api:build: > @erp/api@0.1.0 build /home/z/my-project/extracted_phase013/apps/api
@erp/api:build: > tsc --noEmit -p tsconfig.json
@erp/api:build: 
@erp/web:build: ▲ Next.js 16.4.3 (Turbopack)
@erp/web:build: ✓ Running next.config.ts took 249ms
@erp/web:build: 
@erp/web:build: ⚠ The "middleware" file convention is deprecated. Please use "proxy" instead.
@erp/web:build: 
@erp/web:build:   To migrate automatically, run:
@erp/web:build:   npx @next/codemod@canary middleware-to-proxy .
@erp/web:build: 
@erp/web:build:   Learn more: https://nextjs.org/docs/messages/middleware-to-proxy
@erp/web:build:   Creating an optimized production build ...
@erp/web:build: ✓ Compiled successfully in 11.0s
@erp/web:build:   Running TypeScript ...
@erp/web:build:   Finished TypeScript in 9.5s ...
@erp/web:build:   Collecting page data using 1 worker ...
@erp/web:build:   Generating static pages using 1 worker (0/132) ...
@erp/web:build:   Generating static pages using 1 worker (33/132) 
@erp/web:build:   Generating static pages using 1 worker (66/132) 
@erp/web:build:   Generating static pages using 1 worker (99/132) 
@erp/web:build: ✓ Generating static pages using 1 worker (132/132) in 613ms
@erp/web:build:   Finalizing page optimization ...
@erp/web:build: 
@erp/web:build: Route (app)
@erp/web:build: ┌ ○ /_not-found
@erp/web:build: ├ ƒ /[locale]
@erp/web:build: ├ ƒ /[locale]/accept-invitation
@erp/web:build: ├ ƒ /[locale]/accounting/accounts
@erp/web:build: ├ ƒ /[locale]/accounting/approvals
@erp/web:build: ├ ƒ /[locale]/accounting/gl
@erp/web:build: ├ ƒ /[locale]/accounting/journals
@erp/web:build: ├ ƒ /[locale]/accounting/journals/[id]
@erp/web:build: ├ ƒ /[locale]/accounting/journals/new
@erp/web:build: ├ ƒ /[locale]/accounting/periods
@erp/web:build: ├ ƒ /[locale]/accounting/rates
@erp/web:build: ├ ƒ /[locale]/billing
@erp/web:build: ├ ƒ /[locale]/branches
@erp/web:build: ├ ƒ /[locale]/checkout
@erp/web:build: ├ ƒ /[locale]/dashboard
@erp/web:build: ├   /[locale]/forgot-password
@erp/web:build: │ ├ ● /ar/forgot-password
@erp/web:build: │ └ ● /en/forgot-password
@erp/web:build: ├ ƒ /[locale]/inventory/counting
@erp/web:build: ├ ƒ /[locale]/inventory/import
@erp/web:build: ├ ƒ /[locale]/inventory/items
@erp/web:build: ├ ƒ /[locale]/inventory/items/[id]
@erp/web:build: ├ ƒ /[locale]/inventory/items/new
@erp/web:build: ├ ƒ /[locale]/inventory/moves
@erp/web:build: ├ ƒ /[locale]/inventory/price-lists
@erp/web:build: ├ ƒ /[locale]/inventory/stock
@erp/web:build: ├ ƒ /[locale]/inventory/transfers
@erp/web:build: ├ ƒ /[locale]/inventory/warehouses
@erp/web:build: ├ ƒ /[locale]/login
@erp/web:build: ├ ƒ /[locale]/mfa
@erp/web:build: ├ ƒ /[locale]/notifications
@erp/web:build: ├ ƒ /[locale]/onboarding
@erp/web:build: ├ ƒ /[locale]/opening-balances
@erp/web:build: ├ ƒ /[locale]/partners
@erp/web:build: ├ ƒ /[locale]/partners/[id]
@erp/web:build: ├ ƒ /[locale]/partners/new
@erp/web:build: ├ ƒ /[locale]/platform
@erp/web:build: ├ ƒ /[locale]/platform/audit
@erp/web:build: ├ ƒ /[locale]/platform/tenants/[id]
@erp/web:build: ├ ƒ /[locale]/pricing
@erp/web:build: ├ ƒ /[locale]/purchasing/ap
@erp/web:build: ├ ƒ /[locale]/purchasing/debit-notes
@erp/web:build: ├ ƒ /[locale]/purchasing/invoices
@erp/web:build: ├ ƒ /[locale]/purchasing/orders
@erp/web:build: ├ ƒ /[locale]/purchasing/receipts
@erp/web:build: ├ ƒ /[locale]/register
@erp/web:build: ├ ƒ /[locale]/reports
@erp/web:build: ├ ƒ /[locale]/reports/vat-return
@erp/web:build: ├ ƒ /[locale]/roles
@erp/web:build: ├ ƒ /[locale]/sales/ar
@erp/web:build: ├ ƒ /[locale]/sales/credit-notes
@erp/web:build: ├ ƒ /[locale]/sales/deliveries
@erp/web:build: ├ ƒ /[locale]/sales/invoices
@erp/web:build: ├ ƒ /[locale]/sales/quotes
@erp/web:build: ├ ƒ /[locale]/sessions
@erp/web:build: ├ ƒ /[locale]/settings
@erp/web:build: ├ ƒ /[locale]/settings/password
@erp/web:build: ├ ƒ /[locale]/settings/tax/codes
@erp/web:build: ├ ƒ /[locale]/settings/tax/packs
@erp/web:build: ├ ƒ /[locale]/settings/tax/registrations
@erp/web:build: ├ ƒ /[locale]/support-sessions
@erp/web:build: ├ ƒ /[locale]/treasury/accounts
@erp/web:build: ├ ƒ /[locale]/treasury/accounts/[id]
@erp/web:build: ├ ƒ /[locale]/treasury/bank-rec
@erp/web:build: ├ ƒ /[locale]/treasury/expenses
@erp/web:build: ├ ƒ /[locale]/treasury/payments
@erp/web:build: ├ ƒ /[locale]/treasury/payments/[id]
@erp/web:build: ├ ƒ /[locale]/treasury/payments/new
@erp/web:build: ├ ƒ /[locale]/treasury/receipts
@erp/web:build: ├ ƒ /[locale]/treasury/receipts/[id]
@erp/web:build: ├ ƒ /[locale]/treasury/receipts/new
@erp/web:build: ├ ƒ /[locale]/treasury/shifts
@erp/web:build: ├ ƒ /[locale]/treasury/transfers
@erp/web:build: ├ ƒ /[locale]/users
@erp/web:build: ├ ƒ /api/bff/[...path]
@erp/web:build: ├ ƒ /api/bff/session
@erp/web:build: └ ƒ /api/bff/session/accept
@erp/web:build: 
@erp/web:build: 
@erp/web:build: ƒ Proxy (Middleware)
@erp/web:build: 
@erp/web:build: ○  (Static)   prerendered as static content
@erp/web:build: ●  (SSG)      prerendered as static HTML (uses generateStaticParams)
@erp/web:build: ƒ  (Dynamic)  server-rendered on demand
@erp/web:build: 

 Tasks:    5 successful, 5 total
Cached:    2 cached, 5 total
  Time:    29.985s 

 WARNING  no output files found for task @erp/api#build. Please check your `outputs` key in `turbo.json`
 WARNING  no output files found for task @erp/ui#build. Please check your `outputs` key in `turbo.json`
STEP 7 EXIT 0

=== design-token contrast gate (16) ===

> erp-platform@0.1.0 check:token-contrast /home/z/my-project/extracted_phase013
> tsx scripts/check-token-contrast.ts

== design-token contrast gate (DESIGN_TOKENS §16) ==
PASS  gray-900 on white                           17.74:1  (need ≥ 4.5:1 — body text)
PASS  gray-600 on white                            7.56:1  (need ≥ 4.5:1 — secondary text)
PASS  gray-500 on white                            4.83:1  (need ≥ 4.5:1 — secondary text (borderline — keep))
PASS  primary-600 on white                         5.47:1  (need ≥ 4.5:1 — text · 3:1 UI)
PASS  success-700 on white                         5.02:1  (need ≥ 4.5:1 — POSTED)
PASS  warning-700 on white                         5.02:1  (need ≥ 4.5:1 — PENDING_APPROVAL)
PASS  danger-700 on white                          6.47:1  (need ≥ 4.5:1 — errors / REVERSED)
WARN  danger-700 on white: computed 6.47 vs documented ~5.9 — token drift needs a decision record if intended
PASS  info-700 on white                             6.7:1  (need ≥ 4.5:1 — DRAFT / hints)
WARN  info-700 on white: computed 6.7 vs documented ~6.3 — token drift needs a decision record if intended
PASS  white on primary-600                         5.47:1  (need ≥ 4.5:1 — primary buttons)
PASS  success tint text on tint bg                 6.49:1  (need ≥ 4.5:1 — POSTED badge)
PASS  warning tint text on tint bg                 6.37:1  (need ≥ 4.5:1 — PENDING badge)
PASS  danger tint text on tint bg                   6.8:1  (need ≥ 4.5:1 — error badge)
PASS  info tint text on tint bg                    7.15:1  (need ≥ 4.5:1 — DRAFT badge)
PASS  success-info tint text on tint bg            6.49:1  (need ≥ 4.5:1 — APPROVED badge)
PASS  finance-negative on white                    6.47:1  (need ≥ 4.5:1 — negative amounts)
EXEMPT gray-400 placeholder on white  2.54:1  (ok (exempt, inactive))

all §16 pairs pass the AA floor.
STEP 8 EXIT 0

=== i18n key parity + negative proof ===

> erp-platform@0.1.0 check:i18n-parity /home/z/my-project/extracted_phase013
> tsx scripts/check-i18n-parity.ts

== i18n key parity: ar=1723 keys, en=1723 keys ==
ar/en catalogs at 100% key parity; no empty values.
STEP 9 EXIT 0

=== ui catalog coverage (export == row) ===

> erp-platform@0.1.0 check:ui-catalog /home/z/my-project/extracted_phase013
> tsx scripts/check-ui-catalog-coverage.ts

== ui catalog coverage: 37 component exports ↔ 60 catalog rows ==
export↔row parity green.
STEP 10 EXIT 0

=== design-system harness (storybook visual/axe/coverage/perf) ===

> erp-platform@0.1.0 test:visual-harness-run /home/z/my-project/extracted_phase013
> pnpm --filter @erp/ui test:harness


> @erp/ui@1.0.0 test:harness /home/z/my-project/extracted_phase013/packages/ui
> pnpm build:storybook && pnpm test:visual && pnpm test:perf


> @erp/ui@1.0.0 build:storybook /home/z/my-project/extracted_phase013/packages/ui
> storybook build --test --output-dir dist-storybook


┌  Building storybook v10.6.5
│
◇  Cleaning outputDir: dist-storybook
│
◇  Loading presets
│
◇  Building manager..
│
●  Building open services..
│
●  Building preview..
│  Vite vite v7.3.7 building client environment for production...
│  Vite transforming...
│
▲  Vite src/patterns/journal-entry-grid.tsx (1:0): Error when using
│  sourcemap for reporting an error: Can't resolve original location of
│  error.
│
▲  Vite src/patterns/journal-entry-grid.tsx (1:0): Module level
│  directives cause errors when bundled, "use client" in
│  "src/patterns/journal-entry-grid.tsx" was ignored.
│
▲  Vite src/patterns/approvals-queue.tsx (1:0): Error when using
│  sourcemap for reporting an error: Can't resolve original location of
│  error.
│
▲  Vite src/patterns/approvals-queue.tsx (1:0): Module level directives
│  cause errors when bundled, "use client" in
│  "src/patterns/approvals-queue.tsx" was ignored.
│
▲  Vite src/patterns/item-picker.tsx (1:0): Error when using sourcemap
│  for reporting an error: Can't resolve original location of error.
│
▲  Vite src/patterns/item-picker.tsx (1:0): Module level directives cause
│  errors when bundled, "use client" in "src/patterns/item-picker.tsx"
│  was ignored.
│
▲  Vite src/patterns/money-summary-bar.tsx (1:0): Error when using
│  sourcemap for reporting an error: Can't resolve original location of
│  error.
│
▲  Vite src/patterns/money-summary-bar.tsx (1:0): Module level directives
│  cause errors when bundled, "use client" in
│  "src/patterns/money-summary-bar.tsx" was ignored.
│
▲  Vite src/patterns/partner-picker.tsx (1:0): Error when using sourcemap
│  for reporting an error: Can't resolve original location of error.
│
▲  Vite src/patterns/partner-picker.tsx (1:0): Module level directives
│  cause errors when bundled, "use client" in
│  "src/patterns/partner-picker.tsx" was ignored.
│
▲  Vite src/patterns/shift-panel.tsx (1:0): Error when using sourcemap
│  for reporting an error: Can't resolve original location of error.
│
▲  Vite src/patterns/shift-panel.tsx (1:0): Module level directives cause
│  errors when bundled, "use client" in "src/patterns/shift-panel.tsx"
│  was ignored.
│
▲  Vite src/hooks/use-partner-balance.ts (1:0): Error when using
│  sourcemap for reporting an error: Can't resolve original location of
│  error.
│
▲  Vite src/hooks/use-partner-balance.ts (1:0): Module level directives
│  cause errors when bundled, "use client" in
│  "src/hooks/use-partner-balance.ts" was ignored.
│
▲  Vite src/components/button.tsx (1:0): Error when using sourcemap for
│  reporting an error: Can't resolve original location of error.
│
▲  Vite src/components/button.tsx (1:0): Module level directives cause
│  errors when bundled, "use client" in "src/components/button.tsx" was
│  ignored.
│
▲  Vite src/components/states.tsx (1:0): Error when using sourcemap for
│  reporting an error: Can't resolve original location of error.
│
▲  Vite src/components/states.tsx (1:0): Module level directives cause
│  errors when bundled, "use client" in "src/components/states.tsx" was
│  ignored.
│
▲  Vite src/components/data-table/data-table.tsx (1:0): Error when using
│  sourcemap for reporting an error: Can't resolve original location of
│  error.
│
▲  Vite src/components/data-table/data-table.tsx (1:0): Module level
│  directives cause errors when bundled, "use client" in
│  "src/components/data-table/data-table.tsx" was ignored.
│
▲  Vite src/hooks/use-item-pricing.ts (1:0): Error when using sourcemap
│  for reporting an error: Can't resolve original location of error.
│
▲  Vite src/hooks/use-item-pricing.ts (1:0): Module level directives
│  cause errors when bundled, "use client" in
│  "src/hooks/use-item-pricing.ts" was ignored.
│
▲  Vite src/components/overlays.tsx (1:0): Error when using sourcemap for
│  reporting an error: Can't resolve original location of error.
│
▲  Vite src/components/overlays.tsx (1:0): Module level directives cause
│  errors when bundled, "use client" in "src/components/overlays.tsx" was
│  ignored.
│
▲  Vite src/components/toast.tsx (1:0): Error when using sourcemap for
│  reporting an error: Can't resolve original location of error.
│
▲  Vite src/components/toast.tsx (1:0): Module level directives cause
│  errors when bundled, "use client" in "src/components/toast.tsx" was
│  ignored.
│
▲  Vite src/components/input.tsx (1:0): Error when using sourcemap for
│  reporting an error: Can't resolve original location of error.
│
▲  Vite src/components/input.tsx (1:0): Module level directives cause
│  errors when bundled, "use client" in "src/components/input.tsx" was
│  ignored.
│
▲  Vite src/components/controls.tsx (1:0): Error when using sourcemap for
│  reporting an error: Can't resolve original location of error.
│
▲  Vite src/components/controls.tsx (1:0): Module level directives cause
│  errors when bundled, "use client" in "src/components/controls.tsx" was
│  ignored.
│
▲  Vite src/components/badge.tsx (1:0): Error when using sourcemap for
│  reporting an error: Can't resolve original location of error.
│
▲  Vite src/components/badge.tsx (1:0): Module level directives cause
│  errors when bundled, "use client" in "src/components/badge.tsx" was
│  ignored.
│
▲  Vite src/components/shell.tsx (1:0): Error when using sourcemap for
│  reporting an error: Can't resolve original location of error.
│
▲  Vite src/components/shell.tsx (1:0): Module level directives cause
│  errors when bundled, "use client" in "src/components/shell.tsx" was
│  ignored.
│
▲  Vite src/components/date-picker.tsx (1:0): Error when using sourcemap
│  for reporting an error: Can't resolve original location of error.
│
▲  Vite src/components/date-picker.tsx (1:0): Module level directives
│  cause errors when bundled, "use client" in
│  "src/components/date-picker.tsx" was ignored.
│
▲  Vite src/components/money-input.tsx (1:0): Error when using sourcemap
│  for reporting an error: Can't resolve original location of error.
│
▲  Vite src/components/money-input.tsx (1:0): Module level directives
│  cause errors when bundled, "use client" in
│  "src/components/money-input.tsx" was ignored.
│
▲  Vite src/primitives/popover.tsx (1:0): Error when using sourcemap for
│  reporting an error: Can't resolve original location of error.
│
▲  Vite src/primitives/popover.tsx (1:0): Module level directives cause
│  errors when bundled, "use client" in "src/primitives/popover.tsx" was
│  ignored.
│
▲  Vite src/primitives/dropdown.tsx (1:0): Error when using sourcemap for
│  reporting an error: Can't resolve original location of error.
│
▲  Vite src/primitives/dropdown.tsx (1:0): Module level directives cause
│  errors when bundled, "use client" in "src/primitives/dropdown.tsx" was
│  ignored.
│
▲  Vite src/primitives/radio.tsx (1:0): Error when using sourcemap for
│  reporting an error: Can't resolve original location of error.
│
▲  Vite src/primitives/radio.tsx (1:0): Module level directives cause
│  errors when bundled, "use client" in "src/primitives/radio.tsx" was
│  ignored.
│
▲  Vite src/primitives/select.tsx (1:0): Error when using sourcemap for
│  reporting an error: Can't resolve original location of error.
│
▲  Vite src/primitives/select.tsx (1:0): Module level directives cause
│  errors when bundled, "use client" in "src/primitives/select.tsx" was
│  ignored.
│
▲  Vite src/primitives/checkbox.tsx (1:0): Error when using sourcemap for
│  reporting an error: Can't resolve original location of error.
│
▲  Vite src/primitives/checkbox.tsx (1:0): Module level directives cause
│  errors when bundled, "use client" in "src/primitives/checkbox.tsx" was
│  ignored.
│
▲  Vite src/primitives/dialog.tsx (1:0): Error when using sourcemap for
│  reporting an error: Can't resolve original location of error.
│
▲  Vite src/primitives/dialog.tsx (1:0): Module level directives cause
│  errors when bundled, "use client" in "src/primitives/dialog.tsx" was
│  ignored.
│
▲  Vite src/primitives/switch.tsx (1:0): Error when using sourcemap for
│  reporting an error: Can't resolve original location of error.
│
▲  Vite src/primitives/switch.tsx (1:0): Module level directives cause
│  errors when bundled, "use client" in "src/primitives/switch.tsx" was
│  ignored.
│
▲  Vite src/primitives/combobox.tsx (1:0): Error when using sourcemap for
│  reporting an error: Can't resolve original location of error.
│
▲  Vite src/primitives/combobox.tsx (1:0): Module level directives cause
│  errors when bundled, "use client" in "src/primitives/combobox.tsx" was
│  ignored.
│
▲  Vite src/primitives/tabs.tsx (1:0): Error when using sourcemap for
│  reporting an error: Can't resolve original location of error.
│
▲  Vite src/primitives/tabs.tsx (1:0): Module level directives cause
│  errors when bundled, "use client" in "src/primitives/tabs.tsx" was
│  ignored.
│
▲  Vite src/primitives/drawer.tsx (1:0): Error when using sourcemap for
│  reporting an error: Can't resolve original location of error.
│
▲  Vite src/primitives/drawer.tsx (1:0): Module level directives cause
│  errors when bundled, "use client" in "src/primitives/drawer.tsx" was
│  ignored.
│
▲  Vite src/primitives/tooltip.tsx (1:0): Error when using sourcemap for
│  reporting an error: Can't resolve original location of error.
│
▲  Vite src/primitives/tooltip.tsx (1:0): Module level directives cause
│  errors when bundled, "use client" in "src/primitives/tooltip.tsx" was
│  ignored.
│
●  Copying static files: public at dist-storybook
│
▲  Vite
│  ../../node_modules/.pnpm/@radix-ui+react-popover@1.3.1_@types+react-dom@19.3.0_@types+react@19.3.0__@types+react@19.3._rxegc4hnzisv7vnucx3luvnlte/node_modules/@radix-ui/react-popover/dist/index.mjs
│  (1:0): Module level directives cause errors when bundled, "use client"
│  in
│  "../../node_modules/.pnpm/@radix-ui+react-popover@1.3.1_@types+react-dom@19.3.0_@types+react@19.3.0__@types+react@19.3._rxegc4hnzisv7vnucx3luvnlte/node_modules/@radix-ui/react-popover/dist/index.mjs"
│  was ignored.
│
▲  Vite
│  ../../node_modules/.pnpm/@radix-ui+react-dropdown-menu@2.2.1_@types+react-dom@19.3.0_@types+react@19.3.0__@types+react_xxm5e7tmvfqi4v2pshf6swmjk4/node_modules/@radix-ui/react-dropdown-menu/dist/index.mjs
│  (1:0): Module level directives cause errors when bundled, "use client"
│  in
│  "../../node_modules/.pnpm/@radix-ui+react-dropdown-menu@2.2.1_@types+react-dom@19.3.0_@types+react@19.3.0__@types+react_xxm5e7tmvfqi4v2pshf6swmjk4/node_modules/@radix-ui/react-dropdown-menu/dist/index.mjs"
│  was ignored.
│
▲  Vite
│  ../../node_modules/.pnpm/@radix-ui+react-radio-group@1.5.1_@types+react-dom@19.3.0_@types+react@19.3.0__@types+react@1_5eprdutbftqztliknbj4763vpi/node_modules/@radix-ui/react-radio-group/dist/index.mjs
│  (1:0): Module level directives cause errors when bundled, "use client"
│  in
│  "../../node_modules/.pnpm/@radix-ui+react-radio-group@1.5.1_@types+react-dom@19.3.0_@types+react@19.3.0__@types+react@1_5eprdutbftqztliknbj4763vpi/node_modules/@radix-ui/react-radio-group/dist/index.mjs"
│  was ignored.
│
▲  Vite
│  ../../node_modules/.pnpm/@radix-ui+react-select@2.4.1_@types+react-dom@19.3.0_@types+react@19.3.0__@types+react@19.3.0_yar4myjlpy34qrfuktrecfzh2u/node_modules/@radix-ui/react-select/dist/index.mjs
│  (1:0): Module level directives cause errors when bundled, "use client"
│  in
│  "../../node_modules/.pnpm/@radix-ui+react-select@2.4.1_@types+react-dom@19.3.0_@types+react@19.3.0__@types+react@19.3.0_yar4myjlpy34qrfuktrecfzh2u/node_modules/@radix-ui/react-select/dist/index.mjs"
│  was ignored.
│
▲  Vite
│  ../../node_modules/.pnpm/@radix-ui+react-checkbox@1.4.1_@types+react-dom@19.3.0_@types+react@19.3.0__@types+react@19.3_dhgndujzrxsfhqsrokka2y2dty/node_modules/@radix-ui/react-checkbox/dist/index.mjs
│  (1:0): Module level directives cause errors when bundled, "use client"
│  in
│  "../../node_modules/.pnpm/@radix-ui+react-checkbox@1.4.1_@types+react-dom@19.3.0_@types+react@19.3.0__@types+react@19.3_dhgndujzrxsfhqsrokka2y2dty/node_modules/@radix-ui/react-checkbox/dist/index.mjs"
│  was ignored.
│
▲  Vite
│  ../../node_modules/.pnpm/@radix-ui+react-dialog@1.3.1_@types+react-dom@19.3.0_@types+react@19.3.0__@types+react@19.3.0_nws3m2szymkno7ofwtzycspriu/node_modules/@radix-ui/react-dialog/dist/index.mjs
│  (1:0): Module level directives cause errors when bundled, "use client"
│  in
│  "../../node_modules/.pnpm/@radix-ui+react-dialog@1.3.1_@types+react-dom@19.3.0_@types+react@19.3.0__@types+react@19.3.0_nws3m2szymkno7ofwtzycspriu/node_modules/@radix-ui/react-dialog/dist/index.mjs"
│  was ignored.
│
▲  Vite
│  ../../node_modules/.pnpm/@radix-ui+react-switch@1.4.1_@types+react-dom@19.3.0_@types+react@19.3.0__@types+react@19.3.0_k46wyhpqnfezrsfgxjidrio2o4/node_modules/@radix-ui/react-switch/dist/index.mjs
│  (1:0): Module level directives cause errors when bundled, "use client"
│  in
│  "../../node_modules/.pnpm/@radix-ui+react-switch@1.4.1_@types+react-dom@19.3.0_@types+react@19.3.0__@types+react@19.3.0_k46wyhpqnfezrsfgxjidrio2o4/node_modules/@radix-ui/react-switch/dist/index.mjs"
│  was ignored.
│
▲  Vite
│  ../../node_modules/.pnpm/@radix-ui+react-tabs@1.2.1_@types+react-dom@19.3.0_@types+react@19.3.0__@types+react@19.3.0_r_puc5pxotum6p2y2tcdnpidtoti/node_modules/@radix-ui/react-tabs/dist/index.mjs
│  (1:0): Module level directives cause errors when bundled, "use client"
│  in
│  "../../node_modules/.pnpm/@radix-ui+react-tabs@1.2.1_@types+react-dom@19.3.0_@types+react@19.3.0__@types+react@19.3.0_r_puc5pxotum6p2y2tcdnpidtoti/node_modules/@radix-ui/react-tabs/dist/index.mjs"
│  was ignored.
│
▲  Vite
│  ../../node_modules/.pnpm/@radix-ui+react-tooltip@1.4.1_@types+react-dom@19.3.0_@types+react@19.3.0__@types+react@19.3._xzrwmhtxvg6axoqmxmbnxquore/node_modules/@radix-ui/react-tooltip/dist/index.mjs
│  (1:0): Module level directives cause errors when bundled, "use client"
│  in
│  "../../node_modules/.pnpm/@radix-ui+react-tooltip@1.4.1_@types+react-dom@19.3.0_@types+react@19.3.0__@types+react@19.3._xzrwmhtxvg6axoqmxmbnxquore/node_modules/@radix-ui/react-tooltip/dist/index.mjs"
│  was ignored.
│
▲  Vite
│  ../../node_modules/.pnpm/@radix-ui+react-focus-guards@1.2.0_@types+react@19.3.0_react@19.3.1/node_modules/@radix-ui/react-focus-guards/dist/index.mjs
│  (1:0): Module level directives cause errors when bundled, "use client"
│  in
│  "../../node_modules/.pnpm/@radix-ui+react-focus-guards@1.2.0_@types+react@19.3.0_react@19.3.1/node_modules/@radix-ui/react-focus-guards/dist/index.mjs"
│  was ignored.
│
▲  Vite
│  ../../node_modules/.pnpm/@radix-ui+react-dismissable-layer@1.2.1_@types+react-dom@19.3.0_@types+react@19.3.0__@types+r_6i7f2kisf3lbeld57snkxqk4ei/node_modules/@radix-ui/react-dismissable-layer/dist/index.mjs
│  (1:0): Module level directives cause errors when bundled, "use client"
│  in
│  "../../node_modules/.pnpm/@radix-ui+react-dismissable-layer@1.2.1_@types+react-dom@19.3.0_@types+react@19.3.0__@types+r_6i7f2kisf3lbeld57snkxqk4ei/node_modules/@radix-ui/react-dismissable-layer/dist/index.mjs"
│  was ignored.
│
▲  Vite
│  ../../node_modules/.pnpm/@radix-ui+react-focus-scope@1.3.1_@types+react-dom@19.3.0_@types+react@19.3.0__@types+react@1_55uec7htcwj72cnzr5rjcj7k6q/node_modules/@radix-ui/react-focus-scope/dist/index.mjs
│  (1:0): Module level directives cause errors when bundled, "use client"
│  in
│  "../../node_modules/.pnpm/@radix-ui+react-focus-scope@1.3.1_@types+react-dom@19.3.0_@types+react@19.3.0__@types+react@1_55uec7htcwj72cnzr5rjcj7k6q/node_modules/@radix-ui/react-focus-scope/dist/index.mjs"
│  was ignored.
│
▲  Vite
│  ../../node_modules/.pnpm/@radix-ui+react-popper@1.4.0_@types+react-dom@19.3.0_@types+react@19.3.0__@types+react@19.3.0_4bv4ucqgzkjgfbxanprxdzoozu/node_modules/@radix-ui/react-popper/dist/index.mjs
│  (1:0): Module level directives cause errors when bundled, "use client"
│  in
│  "../../node_modules/.pnpm/@radix-ui+react-popper@1.4.0_@types+react-dom@19.3.0_@types+react@19.3.0__@types+react@19.3.0_4bv4ucqgzkjgfbxanprxdzoozu/node_modules/@radix-ui/react-popper/dist/index.mjs"
│  was ignored.
│
▲  Vite
│  ../../node_modules/.pnpm/@radix-ui+react-portal@1.2.0_@types+react-dom@19.3.0_@types+react@19.3.0__@types+react@19.3.0_nccyaa7sgzbykcwvtuwcktpwzu/node_modules/@radix-ui/react-portal/dist/index.mjs
│  (1:0): Module level directives cause errors when bundled, "use client"
│  in
│  "../../node_modules/.pnpm/@radix-ui+react-portal@1.2.0_@types+react-dom@19.3.0_@types+react@19.3.0__@types+react@19.3.0_nccyaa7sgzbykcwvtuwcktpwzu/node_modules/@radix-ui/react-portal/dist/index.mjs"
│  was ignored.
│
▲  Vite
│  ../../node_modules/.pnpm/@radix-ui+react-presence@1.1.11_@types+react-dom@19.3.0_@types+react@19.3.0__@types+react@19._omslmu2xf2j5osdlwfmawglnxy/node_modules/@radix-ui/react-presence/dist/index.mjs
│  (1:0): Module level directives cause errors when bundled, "use client"
│  in
│  "../../node_modules/.pnpm/@radix-ui+react-presence@1.1.11_@types+react-dom@19.3.0_@types+react@19.3.0__@types+react@19._omslmu2xf2j5osdlwfmawglnxy/node_modules/@radix-ui/react-presence/dist/index.mjs"
│  was ignored.
│
▲  Vite
│  ../../node_modules/.pnpm/@radix-ui+react-primitive@2.2.0_@types+react-dom@19.3.0_@types+react@19.3.0__@types+react@19._5qhonman6qsvfzzscypybjljxm/node_modules/@radix-ui/react-primitive/dist/index.mjs
│  (1:0): Module level directives cause errors when bundled, "use client"
│  in
│  "../../node_modules/.pnpm/@radix-ui+react-primitive@2.2.0_@types+react-dom@19.3.0_@types+react@19.3.0__@types+react@19._5qhonman6qsvfzzscypybjljxm/node_modules/@radix-ui/react-primitive/dist/index.mjs"
│  was ignored.
│
▲  Vite
│  ../../node_modules/.pnpm/@radix-ui+react-menu@2.2.1_@types+react-dom@19.3.0_@types+react@19.3.0__@types+react@19.3.0_r_ly4265ahvip4e22uqjqsfs6say/node_modules/@radix-ui/react-menu/dist/index.mjs
│  (1:0): Module level directives cause errors when bundled, "use client"
│  in
│  "../../node_modules/.pnpm/@radix-ui+react-menu@2.2.1_@types+react-dom@19.3.0_@types+react@19.3.0__@types+react@19.3.0_r_ly4265ahvip4e22uqjqsfs6say/node_modules/@radix-ui/react-menu/dist/index.mjs"
│  was ignored.
│
▲  Vite
│  ../../node_modules/.pnpm/@radix-ui+react-roving-focus@1.2.1_@types+react-dom@19.3.0_@types+react@19.3.0__@types+react@_doinun3bsdmers2xbggiqhwmjy/node_modules/@radix-ui/react-roving-focus/dist/index.mjs
│  (1:0): Module level directives cause errors when bundled, "use client"
│  in
│  "../../node_modules/.pnpm/@radix-ui+react-roving-focus@1.2.1_@types+react-dom@19.3.0_@types+react@19.3.0__@types+react@_doinun3bsdmers2xbggiqhwmjy/node_modules/@radix-ui/react-roving-focus/dist/index.mjs"
│  was ignored.
│
▲  Vite
│  ../../node_modules/.pnpm/@radix-ui+react-direction@1.2.0_@types+react@19.3.0_react@19.3.1/node_modules/@radix-ui/react-direction/dist/index.mjs
│  (1:0): Module level directives cause errors when bundled, "use client"
│  in
│  "../../node_modules/.pnpm/@radix-ui+react-direction@1.2.0_@types+react@19.3.0_react@19.3.1/node_modules/@radix-ui/react-direction/dist/index.mjs"
│  was ignored.
│
▲  Vite
│  ../../node_modules/.pnpm/@radix-ui+react-collection@1.2.0_@types+react-dom@19.3.0_@types+react@19.3.0__@types+react@19_uoaxrhgzxpicw5nsl73w5smpwe/node_modules/@radix-ui/react-collection/dist/index.mjs
│  (1:0): Module level directives cause errors when bundled, "use client"
│  in
│  "../../node_modules/.pnpm/@radix-ui+react-collection@1.2.0_@types+react-dom@19.3.0_@types+react@19.3.0__@types+react@19_uoaxrhgzxpicw5nsl73w5smpwe/node_modules/@radix-ui/react-collection/dist/index.mjs"
│  was ignored.
│
▲  Vite
│  ../../node_modules/.pnpm/@radix-ui+react-visually-hidden@1.2.13_@types+react-dom@19.3.0_@types+react@19.3.0__@types+re_4xkx2ijddredx7dqfd5sqp3wlq/node_modules/@radix-ui/react-visually-hidden/dist/index.mjs
│  (1:0): Module level directives cause errors when bundled, "use client"
│  in
│  "../../node_modules/.pnpm/@radix-ui+react-visually-hidden@1.2.13_@types+react-dom@19.3.0_@types+react@19.3.0__@types+re_4xkx2ijddredx7dqfd5sqp3wlq/node_modules/@radix-ui/react-visually-hidden/dist/index.mjs"
│  was ignored.
│
▲  Vite
│  ../../node_modules/.pnpm/@radix-ui+react-arrow@1.1.17_@types+react-dom@19.3.0_@types+react@19.3.0__@types+react@19.3.0_y4nk53dyk6ylud6uhlwlrelfvu/node_modules/@radix-ui/react-arrow/dist/index.mjs
│  (1:0): Module level directives cause errors when bundled, "use client"
│  in
│  "../../node_modules/.pnpm/@radix-ui+react-arrow@1.1.17_@types+react-dom@19.3.0_@types+react@19.3.0__@types+react@19.3.0_y4nk53dyk6ylud6uhlwlrelfvu/node_modules/@radix-ui/react-arrow/dist/index.mjs"
│  was ignored.
│
▲  Vite
│  ../../node_modules/.pnpm/zod@4.6.7/node_modules/zod/v4/core/regexes.js
│  (74:0): A comment

│  "/** Anchors a pattern source. The interpolation lives here rather
│  than at the call site because
│  * esbuild will not drop a `@__PURE__` call whose own argument
│  interpolates a variable, but it
│  * will drop `anchor(dateSource)`. Keeping it inline pinned `date` into
│  every bundle. */"

│  in
│  "../../node_modules/.pnpm/zod@4.6.7/node_modules/zod/v4/core/regexes.js"
│  contains an annotation that Rollup cannot interpret due to the
│  position of the comment. The comment will be removed to avoid issues.
│
▲  Vite
│  ../../node_modules/.pnpm/zod@4.6.7/node_modules/zod/v4/core/util.js
│  (400:0): A comment

│  "// Wrapped in a `@__PURE__` IIFE: esbuild never tree-shakes a
│  top-level initializer that contains a member access on `Number`, so
│  the bare object literal survived into every bundle."

│  in
│  "../../node_modules/.pnpm/zod@4.6.7/node_modules/zod/v4/core/util.js"
│  contains an annotation that Rollup cannot interpret due to the
│  position of the comment. The comment will be removed to avoid issues.
│  Vite ✓ 1943 modules transformed.
│  Vite rendering chunks...
│  Vite dist-storybook/assets/inter-vietnamese-400-normal-DMkecbls.woff2
│  4.97 kB
│  Vite
│  dist-storybook/assets/ibm-plex-sans-arabic-latin-ext-700-normal-C7GcWn11.woff
│  5.08 kB
│  Vite dist-storybook/assets/inter-vietnamese-600-normal-Cc8MFFhd.woff2
│  5.10 kB
│  Vite
│  dist-storybook/assets/ibm-plex-sans-arabic-latin-ext-400-normal-BeVLg08x.woff
│  5.10 kB
│  Vite dist-storybook/assets/inter-vietnamese-700-normal-DlLaEgI2.woff2
│  5.10 kB
│  Vite dist-storybook/assets/inter-vietnamese-500-normal-DOriooB6.woff2
│  5.11 kB
│  Vite
│  dist-storybook/assets/ibm-plex-sans-arabic-latin-ext-500-normal-eJxPnL1P.woff
│  5.12 kB
│  Vite
│  dist-storybook/assets/ibm-plex-sans-arabic-latin-ext-600-normal-DT29Q8HW.woff
│  5.12 kB
│  Vite dist-storybook/assets/inter-greek-ext-400-normal-DGGRlc-M.woff2
│  5.26 kB
│  Vite dist-storybook/assets/inter-greek-ext-500-normal-C4iEst2y.woff2
│  5.43 kB
│  Vite dist-storybook/assets/inter-greek-ext-600-normal-DRtmH8MT.woff2
│  5.43 kB
│  Vite dist-storybook/assets/inter-greek-ext-700-normal-qfdV9bQt.woff2
│  5.44 kB
│  Vite
│  dist-storybook/assets/ibm-plex-mono-vietnamese-500-normal-C8zxqsMH.woff
│  5.62 kB
│  Vite
│  dist-storybook/assets/ibm-plex-mono-vietnamese-400-normal-DDuiU_S-.woff
│  5.62 kB
│  Vite
│  dist-storybook/assets/ibm-plex-mono-cyrillic-ext-500-normal-BIfNGwUT.woff
│  5.77 kB
│  Vite
│  dist-storybook/assets/ibm-plex-mono-cyrillic-ext-400-normal-DMdlQ8Kv.woff
│  5.82 kB
│  Vite
│  dist-storybook/assets/ibm-plex-mono-vietnamese-400-normal-BulugwFq.woff2
│  5.87 kB
│  Vite
│  dist-storybook/assets/ibm-plex-mono-vietnamese-500-normal-DZ4AoWbu.woff2
│  6.04 kB
│  Vite dist-storybook/assets/inter-vietnamese-400-normal-Bbgyi5SW.woff
│  6.50 kB
│  Vite
│  dist-storybook/assets/ibm-plex-sans-arabic-latin-ext-500-normal-Ck_W4G78.woff2
│  6.54 kB
│  Vite
│  dist-storybook/assets/ibm-plex-sans-arabic-latin-ext-700-normal-BSbyEp0V.woff2
│  6.56 kB
│  Vite dist-storybook/assets/inter-vietnamese-500-normal-mJboJaSs.woff
│  6.60 kB
│  Vite dist-storybook/assets/inter-vietnamese-700-normal-BZaoP0fm.woff
│  6.63 kB
│  Vite dist-storybook/assets/inter-vietnamese-600-normal-BuLX-rYi.woff
│  6.64 kB
│  Vite
│  dist-storybook/assets/ibm-plex-sans-arabic-latin-ext-400-normal-BpLfq-63.woff2
│  6.66 kB
│  Vite
│  dist-storybook/assets/ibm-plex-sans-arabic-latin-ext-600-normal-DjDAeNQD.woff2
│  6.68 kB
│  Vite
│  dist-storybook/assets/ibm-plex-mono-cyrillic-ext-400-normal-xuaO2J-f.woff2
│  6.91 kB
│  Vite
│  dist-storybook/assets/ibm-plex-mono-cyrillic-ext-500-normal-BqneJy0T.woff2
│  6.97 kB
│  Vite dist-storybook/assets/inter-greek-ext-400-normal-KugGGMne.woff
│  7.06 kB
│  Vite dist-storybook/assets/inter-greek-ext-500-normal-2j5mBUwD.woff
│  7.19 kB
│  Vite
│  dist-storybook/assets/ibm-plex-mono-cyrillic-400-normal-CEL4l2ZJ.woff
│  7.20 kB
│  Vite
│  dist-storybook/assets/ibm-plex-mono-cyrillic-500-normal-Ael50iVv.woff
│  7.21 kB
│  Vite dist-storybook/assets/inter-greek-ext-600-normal-B8X0CLgF.woff
│  7.21 kB
│  Vite dist-storybook/assets/inter-greek-ext-700-normal-BoQ6DsYi.woff
│  7.22 kB
│  Vite dist-storybook/assets/inter-cyrillic-400-normal-obahsSVq.woff2
│  7.71 kB
│  Vite dist-storybook/assets/inter-greek-400-normal-B4URO6DV.woff2
│  7.78 kB
│  Vite dist-storybook/assets/inter-cyrillic-500-normal-BasfLYem.woff2
│  7.90 kB
│  Vite dist-storybook/assets/inter-cyrillic-700-normal-CjBOestx.woff2
│  7.90 kB
│  Vite dist-storybook/assets/inter-greek-500-normal-BIZE56-Y.woff2
│  7.92 kB
│  Vite dist-storybook/assets/inter-greek-700-normal-C3JjAnD8.woff2
│  7.92 kB
│  Vite dist-storybook/assets/inter-greek-600-normal-plRanbMR.woff2
│  7.94 kB
│  Vite dist-storybook/assets/inter-cyrillic-600-normal-CWCymEST.woff2
│  7.97 kB
│  Vite
│  dist-storybook/assets/ibm-plex-mono-cyrillic-400-normal-BSMlKf0J.woff2
│  8.36 kB
│  Vite
│  dist-storybook/assets/ibm-plex-mono-cyrillic-500-normal-Bq9vWWag.woff2
│  8.46 kB
│  Vite dist-storybook/assets/inter-cyrillic-400-normal-HOLc17fK.woff
│  9.78 kB
│  Vite dist-storybook/assets/inter-cyrillic-700-normal-DrXBdSj3.woff
│  9.91 kB
│  Vite dist-storybook/assets/inter-greek-400-normal-q2sYcFCs.woff
│  9.92 kB
│  Vite dist-storybook/assets/inter-cyrillic-600-normal-4D_pXhcN.woff
│  9.94 kB
│  Vite dist-storybook/assets/inter-cyrillic-500-normal-CxZf_p3X.woff
│  9.94 kB
│  Vite dist-storybook/assets/inter-greek-500-normal-Xzm54t5V.woff
│  9.98 kB
│  Vite dist-storybook/assets/inter-greek-700-normal-BUv2fZ6O.woff
│  9.98 kB
│  Vite dist-storybook/assets/inter-greek-600-normal-BZpKdvQh.woff
│  10.03 kB
│  Vite
│  dist-storybook/assets/inter-cyrillic-ext-400-normal-BQZuk6qB.woff2
│  10.23 kB
│  Vite
│  dist-storybook/assets/inter-cyrillic-ext-500-normal-B0yAr1jD.woff2
│  10.43 kB
│  Vite
│  dist-storybook/assets/inter-cyrillic-ext-600-normal-Dfes3d0z.woff2
│  10.48 kB
│  Vite
│  dist-storybook/assets/inter-cyrillic-ext-700-normal-BjwYoWNd.woff2
│  10.50 kB
│  Vite
│  dist-storybook/assets/ibm-plex-mono-latin-ext-400-normal-D3D2R8hC.woff
│  11.77 kB
│  Vite
│  dist-storybook/assets/ibm-plex-mono-latin-ext-500-normal-CZ70TYgx.woff
│  11.77 kB
│  Vite
│  dist-storybook/assets/ibm-plex-mono-latin-400-normal-CvHOgSBP.woff
│  13.14 kB
│  Vite
│  dist-storybook/assets/ibm-plex-mono-latin-500-normal-CB9ihrfo.woff
│  13.16 kB
│  Vite dist-storybook/assets/inter-cyrillic-ext-400-normal-DQukG94-.woff
│  13.34 kB
│  Vite
│  dist-storybook/assets/ibm-plex-mono-latin-ext-400-normal-BmRBH3aV.woff2
│  13.35 kB
│  Vite dist-storybook/assets/inter-cyrillic-ext-700-normal-LO58E6JB.woff
│  13.41 kB
│  Vite
│  dist-storybook/assets/ibm-plex-mono-latin-ext-500-normal-CAhNIIs5.woff2
│  13.43 kB
│  Vite dist-storybook/assets/inter-cyrillic-ext-500-normal-BmqWE9Dz.woff
│  13.45 kB
│  Vite dist-storybook/assets/inter-cyrillic-ext-600-normal-Bcila6Z-.woff
│  13.46 kB
│  Vite
│  dist-storybook/assets/ibm-plex-mono-latin-400-normal-DMJ8VG8y.woff2
│  14.71 kB
│  Vite
│  dist-storybook/assets/ibm-plex-mono-latin-500-normal-DSY6xOcd.woff2
│  14.89 kB
│  Vite
│  dist-storybook/assets/ibm-plex-sans-arabic-latin-400-normal-CFZh1unN.woff
│  17.51 kB
│  Vite
│  dist-storybook/assets/ibm-plex-sans-arabic-latin-700-normal-Cl4F7CZR.woff
│  17.78 kB
│  Vite
│  dist-storybook/assets/ibm-plex-sans-arabic-latin-500-normal-BletK1Hp.woff
│  18.64 kB
│  Vite dist-storybook/iframe.html
│  18.85 kB
│  Vite
│  dist-storybook/assets/ibm-plex-sans-arabic-latin-600-normal-Dk5eISD_.woff
│  18.88 kB
│  Vite
│  dist-storybook/assets/ibm-plex-sans-arabic-latin-400-normal-Bo5KPYvw.woff2
│  19.16 kB
│  Vite
│  dist-storybook/assets/ibm-plex-sans-arabic-latin-700-normal-BzSf6GNr.woff2
│  19.50 kB
│  Vite
│  dist-storybook/assets/ibm-plex-sans-arabic-latin-500-normal-Cd6jVIg7.woff2
│  20.09 kB
│  Vite
│  dist-storybook/assets/ibm-plex-sans-arabic-latin-600-normal-KrqB56Mw.woff2
│  20.50 kB
│  Vite dist-storybook/assets/inter-latin-400-normal-C38fXH4l.woff2
│  23.66 kB
│  Vite dist-storybook/assets/inter-latin-500-normal-Cerq10X2.woff2
│  24.27 kB
│  Vite dist-storybook/assets/inter-latin-700-normal-Yt3aPRUw.woff2
│  24.36 kB
│  Vite dist-storybook/assets/inter-latin-600-normal-LgqL8muc.woff2
│  24.45 kB
│  Vite dist-storybook/assets/inter-latin-400-normal-CyCys3Eg.woff
│  30.70 kB
│  Vite dist-storybook/assets/inter-latin-600-normal-CiBQ2DWP.woff
│  31.26 kB
│  Vite dist-storybook/assets/inter-latin-500-normal-BL9OpVg8.woff
│  31.28 kB
│  Vite dist-storybook/assets/inter-latin-700-normal-BLAVimhd.woff
│  31.32 kB
│  Vite dist-storybook/assets/inter-latin-ext-400-normal-C1nco2VV.woff2
│  35.00 kB
│  Vite dist-storybook/assets/inter-latin-ext-500-normal-CV4jyFjo.woff2
│  36.02 kB
│  Vite dist-storybook/assets/inter-latin-ext-700-normal-Ca8adRJv.woff2
│  36.24 kB
│  Vite dist-storybook/assets/inter-latin-ext-600-normal-D2bJ5OIk.woff2
│  36.26 kB
│  Vite
│  dist-storybook/assets/ibm-plex-sans-arabic-arabic-400-normal-CyU-ddYS.woff2
│  42.85 kB
│  Vite
│  dist-storybook/assets/ibm-plex-sans-arabic-arabic-400-normal-EA1o-u_Q.woff
│  44.14 kB
│  Vite
│  dist-storybook/assets/ibm-plex-sans-arabic-arabic-700-normal-DrtBj6UE.woff2
│  44.28 kB
│  Vite
│  dist-storybook/assets/ibm-plex-sans-arabic-arabic-700-normal-9rXc6cUL.woff
│  44.36 kB
│  Vite
│  dist-storybook/assets/ibm-plex-sans-arabic-arabic-500-normal-C4MQITzh.woff2
│  45.30 kB
│  Vite
│  dist-storybook/assets/ibm-plex-sans-arabic-arabic-600-normal-0pRdybE_.woff2
│  45.69 kB
│  Vite
│  dist-storybook/assets/ibm-plex-sans-arabic-arabic-600-normal-MJZ0liF5.woff
│  46.78 kB
│  Vite
│  dist-storybook/assets/ibm-plex-sans-arabic-arabic-500-normal-DPXcppbm.woff
│  46.92 kB
│  Vite dist-storybook/assets/inter-latin-ext-400-normal-77YHD8bZ.woff
│  47.56 kB
│  Vite dist-storybook/assets/inter-latin-ext-500-normal-BxGbmqWO.woff
│  48.49 kB
│  Vite dist-storybook/assets/inter-latin-ext-700-normal-TidjK2hL.woff
│  48.63 kB
│  Vite dist-storybook/assets/inter-latin-ext-600-normal-CIVaiw4L.woff
│  48.67 kB
│  Vite dist-storybook/assets/iframe-C7mfVxXM.css
│  72.94 kB
│  Vite dist-storybook/assets/exact-decimal-BzhQq6aO.js
│  0.49 kB
│  Vite dist-storybook/assets/partner-picker-BuciKAqR.js
│  0.66 kB
│  Vite dist-storybook/assets/partner-picker.stories-MV4hZ4uZ.js
│  1.20 kB
│  Vite dist-storybook/assets/preload-helper-PPVm8Dsz.js
│  1.23 kB
│  Vite dist-storybook/assets/item-picker.stories-DHe4Sy_g.js
│  1.52 kB
│  Vite dist-storybook/assets/index-kiMulN9W.js
│  3.97 kB
│  Vite dist-storybook/assets/treasury-patterns.stories-CvDjX5dS.js
│  9.02 kB
│  Vite dist-storybook/assets/accounting-patterns.stories-BwAwYCeg.js
│  13.52 kB
│  Vite dist-storybook/assets/badge-DxvC_YIS.js
│  14.46 kB
│  Vite dist-storybook/assets/money-input-DKjWTdUo.js
│  20.84 kB
│  Vite dist-storybook/vite-inject-mocker-entry.js
│  28.11 kB
│  Vite dist-storybook/assets/input-mE98G-an.js
│  34.43 kB
│  Vite dist-storybook/assets/catalog.stories-CStj7b_C.js
│  78.15 kB
│  Vite dist-storybook/assets/controls-og611Xar.js
│  122.66 kB
│  Vite dist-storybook/assets/react-18-DJRyqmfd.js
│  209.75 kB
│  Vite dist-storybook/assets/iframe-LWOPaKpK.js
│  1,137.64 kB
│
▲  Vite
│  (!) Some chunks are larger than 500 kB after minification. Consider:
│  - Using dynamic import() to code-split the application
│  - Use build.rollupOptions.output.manualChunks to improve chunking:
│  ]8;;https://rollupjs.org/configuration-options/#output-manualchunkshttps://rollupjs.org/configuration-options/#output-manualchunks]8;;
│  - Adjust chunk size limit for this warning via
│  build.chunkSizeWarningLimit.
│  Vite ✓ built in 8.25s
│
◇  Output directory:
│  /home/z/my-project/extracted_phase013/packages/ui/dist-storybook
│
└  Storybook build completed successfully


> @erp/ui@1.0.0 test:visual /home/z/my-project/extracted_phase013/packages/ui
> playwright test

[WebServer] (node:3820) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
[WebServer] (Use `node --trace-warnings ...` to show where the warning was created)

Running 16 tests using 2 workers

(node:3832) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:3833) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
  ✓   2 [chromium] › tests/security/bidi-payloads.spec.ts:34:3 › S-03 bidi/XSS payload neutralization › bidi override control characters cannot spoof adjacent labels (799ms)
  ✓   1 [chromium] › tests/security/bidi-payloads.spec.ts:20:3 › S-03 bidi/XSS payload neutralization › HTML/script payloads render as literal text — never execute (801ms)
  ✓   4 [chromium] › tests/security/bidi-payloads.spec.ts:64:3 › S-03 bidi/XSS payload neutralization › money payload cannot inject markup into the amount field (645ms)

  ✓   5 [chromium] › tests/security/bidi-payloads.spec.ts:71:1 › no dangerouslySetInnerHTML anywhere in the design system (static proof) (6ms)
  ✓   3 [chromium] › tests/security/bidi-payloads.spec.ts:46:3 › S-03 bidi/XSS payload neutralization › legit mixed-script values are isolated (dir=ltr + unicode-bidi isolate) (675ms)
  ✓   7 [chromium] › tests/visual/visual.spec.ts:137:3 › geometry invariants (RTL §10 / VISUAL_TESTING §4) › sidebar sits at the start edge in both directions (1.2s)
  ✓   8 [chromium] › tests/visual/visual.spec.ts:154:3 › geometry invariants (RTL §10 / VISUAL_TESTING §4) › amount digits identical across locales (never mirrored) (939ms)
  ✓   9 [chromium] › tests/visual/visual.spec.ts:166:3 › geometry invariants (RTL §10 / VISUAL_TESTING §4) › breadcrumb separator mirrors with direction (973ms)
  ✓  10 [chromium] › tests/visual/visual.spec.ts:181:3 › coverage check (both directions mandatory) › every non-excluded story has ar AND en baselines (2ms)
  ✓  11 [chromium] › tests/visual/visual.spec.ts:68:5 › visual regression — AR+EN, threshold 0 › all stories render + screenshot — ar (24.8s)
  ✓  12 [chromium] › tests/visual/visual.spec.ts:68:5 › visual regression — AR+EN, threshold 0 › all stories render + screenshot — en (24.7s)
  ✓  13 [chromium] › tests/visual/visual.spec.ts:89:3 › visual regression — AR+EN, threshold 0 › comfortable density companions (7.0s)
  ✓  14 [chromium] › tests/visual/visual.spec.ts:104:5 › visual regression — AR+EN, threshold 0 › archetype viewports 390 — ar + en (1.1s)
  ✓  15 [chromium] › tests/visual/visual.spec.ts:104:5 › visual regression — AR+EN, threshold 0 › archetype viewports 1024 — ar + en (1.1s)
  ✓  16 [chromium] › tests/visual/visual.spec.ts:104:5 › visual regression — AR+EN, threshold 0 › archetype viewports 1280 — ar + en (1.2s)
  ✓   6 [chromium] › tests/visual/visual.spec.ts:119:3 › axe — 0 violations per story (inside the visual harness) › axe clean on every story, both directions (1.5m)

  16 passed (1.5m)

> @erp/ui@1.0.0 test:perf /home/z/my-project/extracted_phase013/packages/ui
> playwright test -c playwright.perf.config.ts

[WebServer] (node:5167) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
[WebServer] (Use `node --trace-warnings ...` to show where the warning was created)

Running 1 test using 1 worker

(node:5179) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
floor=16.57ms table=18.42ms overhead=1.85ms (interleaved best-of-3)
  ✓  1 tests/perf/data-table-perf.spec.ts:55:1 › 10,000-row scroll: virtualization overhead isolated + 60fps where the floor allows (34.2s)

  1 passed (35.0s)
STEP 11 EXIT 0

=== web secure-headers/CSP probe (8) ===

> erp-platform@0.1.0 test:web-security /home/z/my-project/extracted_phase013
> pnpm --filter @erp/web build && pnpm --filter @erp/web exec playwright test -c playwright.probe.config.ts


> @erp/web@0.1.0 build /home/z/my-project/extracted_phase013/apps/web
> next build

▲ Next.js 16.4.3 (Turbopack)
✓ Running next.config.ts took 32ms

⚠ The "middleware" file convention is deprecated. Please use "proxy" instead.

  To migrate automatically, run:
  npx @next/codemod@canary middleware-to-proxy .

  Learn more: https://nextjs.org/docs/messages/middleware-to-proxy
  Creating an optimized production build ...
✓ Compiled successfully in 6.3s
  Running TypeScript ...
  Finished TypeScript in 9.2s ...
  Collecting page data using 1 worker ...
  Generating static pages using 1 worker (0/132) ...
  Generating static pages using 1 worker (33/132) 
  Generating static pages using 1 worker (66/132) 
  Generating static pages using 1 worker (99/132) 
✓ Generating static pages using 1 worker (132/132) in 611ms
  Finalizing page optimization ...

Route (app)
┌ ○ /_not-found
├ ƒ /[locale]
├ ƒ /[locale]/accept-invitation
├ ƒ /[locale]/accounting/accounts
├ ƒ /[locale]/accounting/approvals
├ ƒ /[locale]/accounting/gl
├ ƒ /[locale]/accounting/journals
├ ƒ /[locale]/accounting/journals/[id]
├ ƒ /[locale]/accounting/journals/new
├ ƒ /[locale]/accounting/periods
├ ƒ /[locale]/accounting/rates
├ ƒ /[locale]/billing
├ ƒ /[locale]/branches
├ ƒ /[locale]/checkout
├ ƒ /[locale]/dashboard
├   /[locale]/forgot-password
│ ├ ● /ar/forgot-password
│ └ ● /en/forgot-password
├ ƒ /[locale]/inventory/counting
├ ƒ /[locale]/inventory/import
├ ƒ /[locale]/inventory/items
├ ƒ /[locale]/inventory/items/[id]
├ ƒ /[locale]/inventory/items/new
├ ƒ /[locale]/inventory/moves
├ ƒ /[locale]/inventory/price-lists
├ ƒ /[locale]/inventory/stock
├ ƒ /[locale]/inventory/transfers
├ ƒ /[locale]/inventory/warehouses
├ ƒ /[locale]/login
├ ƒ /[locale]/mfa
├ ƒ /[locale]/notifications
├ ƒ /[locale]/onboarding
├ ƒ /[locale]/opening-balances
├ ƒ /[locale]/partners
├ ƒ /[locale]/partners/[id]
├ ƒ /[locale]/partners/new
├ ƒ /[locale]/platform
├ ƒ /[locale]/platform/audit
├ ƒ /[locale]/platform/tenants/[id]
├ ƒ /[locale]/pricing
├ ƒ /[locale]/purchasing/ap
├ ƒ /[locale]/purchasing/debit-notes
├ ƒ /[locale]/purchasing/invoices
├ ƒ /[locale]/purchasing/orders
├ ƒ /[locale]/purchasing/receipts
├ ƒ /[locale]/register
├ ƒ /[locale]/reports
├ ƒ /[locale]/reports/vat-return
├ ƒ /[locale]/roles
├ ƒ /[locale]/sales/ar
├ ƒ /[locale]/sales/credit-notes
├ ƒ /[locale]/sales/deliveries
├ ƒ /[locale]/sales/invoices
├ ƒ /[locale]/sales/quotes
├ ƒ /[locale]/sessions
├ ƒ /[locale]/settings
├ ƒ /[locale]/settings/password
├ ƒ /[locale]/settings/tax/codes
├ ƒ /[locale]/settings/tax/packs
├ ƒ /[locale]/settings/tax/registrations
├ ƒ /[locale]/support-sessions
├ ƒ /[locale]/treasury/accounts
├ ƒ /[locale]/treasury/accounts/[id]
├ ƒ /[locale]/treasury/bank-rec
├ ƒ /[locale]/treasury/expenses
├ ƒ /[locale]/treasury/payments
├ ƒ /[locale]/treasury/payments/[id]
├ ƒ /[locale]/treasury/payments/new
├ ƒ /[locale]/treasury/receipts
├ ƒ /[locale]/treasury/receipts/[id]
├ ƒ /[locale]/treasury/receipts/new
├ ƒ /[locale]/treasury/shifts
├ ƒ /[locale]/treasury/transfers
├ ƒ /[locale]/users
├ ƒ /api/bff/[...path]
├ ƒ /api/bff/session
└ ƒ /api/bff/session/accept


ƒ Proxy (Middleware)

○  (Static)   prerendered as static content
●  (SSG)      prerendered as static HTML (uses generateStaticParams)
ƒ  (Dynamic)  server-rendered on demand

[WebServer] (node:5411) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
[WebServer] (Use `node --trace-warnings ...` to show where the warning was created)
[WebServer] (node:5423) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
[WebServer] (Use `node --trace-warnings ...` to show where the warning was created)

Running 4 tests using 1 worker

(node:5442) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
  ✓  1 tests/security/headers-csp.spec.ts:15:7 › secure headers probe › document routes carry the full §8 header set (268ms)
  ✓  2 tests/security/headers-csp.spec.ts:37:7 › secure headers probe › per-request nonces rotate and scripts reference them (44ms)
  ✓  3 tests/security/headers-csp.spec.ts:47:7 › secure headers probe › no third-party assets are referenced (SRI n/a assertion) (20ms)
  ✓  4 tests/security/headers-csp.spec.ts:55:7 › secure headers probe › nonce'd document actually executes its scripts (CSP not breaking the app) (313ms)

  4 passed (2.3s)
STEP 12 EXIT 0

=== docs validation (29 checks) ===

> erp-platform@0.1.0 docs:validate /home/z/my-project/extracted_phase013
> python3 scripts/validate_docs.py

PASS  1a. all relative links resolve
PASS  1b. 13 extracted manifests parse with industry.* ids
PASS  2. phase refs within 001-034 and canon client labels (desktop=021/android=022)
PASS  3a. DEF-001 per-type money patterns present (API_CONVENTIONS §7)
PASS  3b. DEF-001 ADR-0009 corrected (blanket 1,8 regex gone from money line)
PASS  3c. DEF-004 enums registered (VAT_PLANNED_EINVOICING + FAILED)
PASS  3d. DEF-007 permission keys follow ownership (sales.receipts / purchasing.payments in matrix)
PASS  3e. DEF-007 no residual treasury.receipts./treasury.payments. permission keys
PASS  3f. DEF-006 no residual CASH_BANK purpose key (outside the defect-log descriptions)
PASS  3g. DEF-006 OPENING_EQUITY purpose registered
PASS  3h. DEF-008 canonical machine ids in template index
PASS  3i. DEF-009 validation-report count corrected
PASS  3j. DEF-010 deferred balance trigger present
PASS  3k. CD-05 marketing rule present
PASS  3l. CD-04 login idempotency exclusion present
PASS  3m. CD-10 status badge binding present
PASS  3n. CD-03 tafqit present
PASS  3o. CD-01 effect-matrix gate present
PASS  3p. CD-11 costing-picking decoupling present
PASS  3q. AD-17 ADR-0017 present and indexed
PASS  4a. authoritative consolidated documents exist
PASS  4b. ADR set 0001..0018 complete
PASS  4c. 34 phase documents present
INFO  total markdown files under docs/: 258
PASS  4d. EXPANSION_REGISTER present with ED-01..ED-19
PASS  4e. six v2.0 modules present in FEATURE_CATALOG
PASS  4f. v2.0 entities present in ENTITY_CATALOG
PASS  4g. v2.0 decision records + ADR-0018 present and indexed
PASS  4h. PHASE-026..034 present with 8 canonical headings
PASS  4i. v2.0 cross-references registered (G-21..32, INV-023..26, BR-041..056, reports, perms, nav)

29/29 checks passed.
STEP 13 EXIT 0

=== negative boundary meta-test ===

> erp-platform@0.1.0 boundary:negative-test /home/z/my-project/extracted_phase013
> bash scripts/ci/negative-boundary-test.sh

[negative-boundary-test] linting deliberate violation with --no-ignore...

/home/z/my-project/extracted_phase013/apps/web/app/__boundary-violations__/violation.fixture.ts
  10:27  error  apps-web importing apps-api violates docs/architecture/DEPENDENCY_RULES.md  boundaries/element-types

✖ 1 problem (1 error, 0 warnings)

PASS: ESLint exited 1 on the violating fixture (expected failure).
      Boundary enforcement is active (DEPENDENCY_RULES.md §3).
STEP 14 EXIT 0

=== negative erp-ui lint meta-test ===
NEGATIVE-UI-RULES: all four rules fail their fixtures (proof complete)
STEP 15 EXIT 0

=== i18n key parity (ar/en) re-check ===

> erp-platform@0.1.0 check:i18n-parity /home/z/my-project/extracted_phase013
> tsx scripts/check-i18n-parity.ts

== i18n key parity: ar=1723 keys, en=1723 keys ==
ar/en catalogs at 100% key parity; no empty values.
STEP 16 EXIT 0

=== negative i18n parity meta-test ===
NEGATIVE-I18N: parity checker fails its drifting fixture (proof complete)
STEP 17 EXIT 0
=== FINAL: 17/17 steps green ===
```

## 2. NFR-006 MVP-candidate measurements (standalone run)

```
[mvp-candidate] T-01 document-list p95=33ms (n=20, 100k rows) budget=500ms
[mvp-candidate] T-02 posting p95=10ms (n=30) budget=300ms
[mvp-candidate] T-04 interactive-report compute p95=14ms (n=4, 4 contract families) budget=2000ms; cached re-run p95=0ms
[mvp-candidate] T-06 login+shell(ar) p95=156ms (n=5) budget=1500ms
[mvp-candidate] T-06 login+shell(en) p95=160ms (n=5) budget=1500ms
[mvp-candidate] T-07 5xx=0/62 (rate 0.000%) budget<0.1%
 Test Files  1 passed (1)
      Tests  5 passed (5)
```

## 3. Backup-restore drill record (runbook §8)

```
=== RESTORE DRILL RECORD (BACKUP_RESTORE_RUNBOOK §8) ===
date:                    2026-11-01T22:58:51.047Z
environment:             embedded PostgreSQL 16 (sandbox — the standing local-substitute tier)
restore point:           pg_dump custom-format artifact of the migrated+seeded database
dump size:               707 KiB
time-to-dump:            0.1s
time-to-restore (RTO):   0.7s (budget 4h: GREEN)
data-loss window (RPO):  0 rows — no writes between dump and drop (dump-restore drill; PITR is the managed tier)
invariant smoke a-f:     ALL GREEN
row-count parity:        GREEN (5/5 tables identical)
total wall time:         3.1s
verdict:                 DRILL PASSED
========================================================
```
