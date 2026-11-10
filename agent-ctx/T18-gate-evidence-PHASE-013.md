
> erp-platform@0.1.0 gate:local /home/z/erp-platform
> bash scripts/ci/local-gate.sh


=== typecheck ===

> erp-platform@0.1.0 typecheck /home/z/erp-platform
> turbo run typecheck


   • turbo 2.11.10
   • Packages in scope: @erp/api, @erp/config, @erp/contracts, @erp/domain-core, @erp/ui, @erp/web
   • Running typecheck in 6 packages
   • Remote caching disabled

@erp/api:typecheck: cache hit, replaying logs c672a6c692097a78
@erp/api:typecheck: 
@erp/api:typecheck: > @erp/api@0.1.0 typecheck /home/z/erp-platform/apps/api
@erp/api:typecheck: > tsc --noEmit -p tsconfig.json
@erp/api:typecheck: 
@erp/contracts:typecheck: cache hit, replaying logs a82236ca78e66ad7
@erp/contracts:typecheck: 
@erp/contracts:typecheck: > @erp/contracts@0.1.0 typecheck /home/z/erp-platform/packages/contracts
@erp/contracts:typecheck: > tsc --noEmit -p tsconfig.json
@erp/contracts:typecheck: 
@erp/web:typecheck: cache hit, replaying logs 2412692dbd37a360
@erp/web:typecheck: 
@erp/web:typecheck: > @erp/web@0.1.0 typecheck /home/z/erp-platform/apps/web
@erp/web:typecheck: > tsc --noEmit -p tsconfig.json
@erp/web:typecheck: 
@erp/ui:typecheck: cache miss, executing 0275d88e8c761725
@erp/domain-core:typecheck: cache hit, replaying logs 9196b67e80bd4067
@erp/domain-core:typecheck: 
@erp/domain-core:typecheck: > @erp/domain-core@0.1.0 typecheck /home/z/erp-platform/packages/domain-core
@erp/domain-core:typecheck: > tsc --noEmit -p tsconfig.json
@erp/domain-core:typecheck: 
@erp/ui:typecheck: 
@erp/ui:typecheck: > @erp/ui@1.0.0 typecheck /home/z/erp-platform/packages/ui
@erp/ui:typecheck: > tsc --noEmit -p tsconfig.json
@erp/ui:typecheck: 

 Tasks:    5 successful, 5 total
Cached:    4 cached, 5 total
  Time:    4.679s 


=== lint (incl. module boundaries) ===

> erp-platform@0.1.0 lint /home/z/erp-platform
> turbo run lint


   • turbo 2.11.10
   • Packages in scope: @erp/api, @erp/config, @erp/contracts, @erp/domain-core, @erp/ui, @erp/web
   • Running lint in 6 packages
   • Remote caching disabled

@erp/ui:lint: cache hit, replaying logs 0826080040d14da5
@erp/ui:lint: 
@erp/ui:lint: > @erp/ui@1.0.0 lint /home/z/erp-platform/packages/ui
@erp/ui:lint: > eslint .
@erp/ui:lint: 
@erp/web:lint: cache hit, replaying logs 99d644350792e2cf
@erp/web:lint: 
@erp/web:lint: > @erp/web@0.1.0 lint /home/z/erp-platform/apps/web
@erp/web:lint: > eslint .
@erp/web:lint: 
@erp/api:lint: cache hit, replaying logs 66ff27e2b0c9bd08
@erp/api:lint: 
@erp/api:lint: > @erp/api@0.1.0 lint /home/z/erp-platform/apps/api
@erp/api:lint: > eslint .
@erp/api:lint: 
@erp/contracts:lint: cache hit, replaying logs bd5e82b2dcda94ac
@erp/contracts:lint: 
@erp/contracts:lint: > @erp/contracts@0.1.0 lint /home/z/erp-platform/packages/contracts
@erp/contracts:lint: > eslint .
@erp/contracts:lint: 
@erp/domain-core:lint: cache hit, replaying logs 062796cca035fa58
@erp/domain-core:lint: 
@erp/domain-core:lint: > @erp/domain-core@0.1.0 lint /home/z/erp-platform/packages/domain-core
@erp/domain-core:lint: > eslint .
@erp/domain-core:lint: 

 Tasks:    5 successful, 5 total
Cached:    5 cached, 5 total
  Time:    33ms >>> FULL TURBO


=== lint:depcruise (dependency graph rules) ===

> erp-platform@0.1.0 lint:depcruise /home/z/erp-platform
> dependency-cruiser apps packages --config .dependency-cruiser.cjs


✔ no dependency violations found (1298 modules, 4684 dependencies cruised)


=== permissions docs-drift (seed ↔ AUTHORIZATION_MATRIX) ===

> erp-platform@0.1.0 check:permissions-drift /home/z/erp-platform
> tsx scripts/check-permissions-drift.ts

[permissions-drift] OK — matrix 224 keys, seed 224 keys

=== unit + property tests ===

> erp-platform@0.1.0 test /home/z/erp-platform
> turbo run test


   • turbo 2.11.10
   • Packages in scope: @erp/api, @erp/config, @erp/contracts, @erp/domain-core, @erp/ui, @erp/web
   • Running test in 6 packages
   • Remote caching disabled

@erp/api:test: cache miss, executing d525508049ae0c7d
@erp/ui:test: cache miss, executing 04d89bb77033e731
@erp/domain-core:test: cache miss, executing 84c578c3aaf9f8ff
@erp/contracts:test: cache miss, executing afcba8811fab9583
@erp/contracts:test: 
@erp/contracts:test: > @erp/contracts@0.1.0 test /home/z/erp-platform/packages/contracts
@erp/contracts:test: > vitest run
@erp/contracts:test: 
@erp/domain-core:test: 
@erp/domain-core:test: > @erp/domain-core@0.1.0 test /home/z/erp-platform/packages/domain-core
@erp/domain-core:test: > vitest run
@erp/domain-core:test: 
@erp/api:test: 
@erp/api:test: > @erp/api@0.1.0 test /home/z/erp-platform/apps/api
@erp/api:test: > vitest run
@erp/api:test: 
@erp/ui:test: 
@erp/ui:test: > @erp/ui@1.0.0 test /home/z/erp-platform/packages/ui
@erp/ui:test: > vitest run
@erp/ui:test: 
@erp/contracts:test: 
@erp/contracts:test:  RUN  v3.2.7 /home/z/erp-platform/packages/contracts
@erp/contracts:test: 
@erp/ui:test: 
@erp/ui:test:  RUN  v3.2.7 /home/z/erp-platform/packages/ui
@erp/ui:test: 
@erp/domain-core:test: 
@erp/domain-core:test:  RUN  v3.2.7 /home/z/erp-platform/packages/domain-core
@erp/domain-core:test: 
@erp/api:test: 
@erp/api:test:  RUN  v3.2.7 /home/z/erp-platform/apps/api
@erp/api:test: 
@erp/contracts:test:  ✓ src/__tests__/contracts.test.ts (11 tests) 24ms
@erp/contracts:test: 
@erp/contracts:test:  Test Files  1 passed (1)
@erp/contracts:test:       Tests  11 passed (11)
@erp/contracts:test:    Start at  00:54:59
@erp/contracts:test:    Duration  1.17s (transform 274ms, setup 0ms, collect 477ms, tests 24ms, environment 0ms, prepare 136ms)
@erp/contracts:test: 
@erp/domain-core:test:  ✓ src/__tests__/money.test.ts (11 tests) 46ms
@erp/api:test:  ✓ src/modules/inventory/domain/valuation/valuation.spec.ts (12 tests) 262ms
@erp/domain-core:test:  ✓ src/__tests__/property.test.ts (6 tests) 202ms
@erp/domain-core:test:  ✓ src/__tests__/quantity-rate.test.ts (7 tests) 11ms
@erp/domain-core:test:  ✓ src/__tests__/calendar-date.test.ts (6 tests) 18ms
@erp/domain-core:test:  ✓ src/__tests__/uuidv7.test.ts (4 tests) 97ms
@erp/domain-core:test:  ✓ src/__tests__/result-errors.test.ts (4 tests) 6ms
@erp/domain-core:test: 
@erp/domain-core:test:  Test Files  6 passed (6)
@erp/domain-core:test:       Tests  38 passed (38)
@erp/domain-core:test:    Start at  00:54:59
@erp/domain-core:test:    Duration  4.26s (transform 424ms, setup 0ms, collect 919ms, tests 379ms, environment 1ms, prepare 1.15s)
@erp/domain-core:test: 
@erp/ui:test:  ✓ src/utils/__tests__/components.test.tsx (17 tests) 942ms
@erp/api:test:  ✓ src/modules/reporting/__tests__/reporting-unit.spec.ts (42 tests) 200ms
@erp/ui:test:  ✓ src/utils/__tests__/behavior.test.ts (21 tests) 22ms
@erp/api:test:  ✓ src/modules/accounting/domain/property.spec.ts (5 tests) 191ms
@erp/ui:test:  ✓ src/tokens/__tests__/tokens.test.ts (4 tests) 28ms
@erp/ui:test: 
@erp/ui:test:  Test Files  3 passed (3)
@erp/ui:test:       Tests  42 passed (42)
@erp/ui:test:    Start at  00:54:59
@erp/ui:test:    Duration  7.17s (transform 631ms, setup 0ms, collect 2.41s, tests 993ms, environment 2.56s, prepare 386ms)
@erp/ui:test: 
@erp/api:test:  ✓ src/modules/identity/infrastructure/permissions-drift.spec.ts (5 tests) 19ms
@erp/api:test:  ✓ src/infra/db/migrations.spec.ts (4 tests) 11ms
@erp/api:test:  ✓ src/modules/reporting/__tests__/print-templates.spec.ts (8 tests) 11ms
@erp/api:test:  ✓ src/health/health.controller.spec.ts (4 tests) 10ms
@erp/api:test:  ✓ src/modules/accounting/domain/posting-engine/posting-engine.spec.ts (17 tests) 9ms
@erp/api:test:  ✓ src/modules/identity/domain/identity-unit.spec.ts (9 tests) 7ms
@erp/api:test:  ✓ src/modules/files/application/files.service.spec.ts (5 tests) 6ms
@erp/api:test:  ✓ src/modules/identity/domain/totp.spec.ts (7 tests) 5ms
@erp/api:test:  ✓ src/modules/notifications/application/templates.spec.ts (8 tests) 7ms
@erp/api:test:  ✓ src/modules/audit/application/audit.service.spec.ts (4 tests) 5ms
@erp/api:test: {"level":30,"time":1793494510207,"service":"erp-api","module":"http","correlation_id":"01a1949a-6a7e-7000-9d30-d4ec83a375dd","action":"request","method":"GET","path":"/health/live","status":200,"duration_ms":0,"msg":"request completed"}
@erp/api:test: {"level":30,"time":1793494510208,"service":"erp-api","module":"http","correlation_id":"aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee","action":"request","method":"GET","path":"/health/live","status":200,"duration_ms":0,"msg":"request completed"}
@erp/api:test: {"level":30,"time":1793494510209,"service":"erp-api","module":"http","correlation_id":"01a1949a-6a81-7000-ab69-351ef774a82b","action":"request","method":"GET","path":"/health/live","status":200,"duration_ms":0,"msg":"request completed"}
@erp/api:test:  ✓ src/infra/observability/request-id.middleware.spec.ts (3 tests) 5ms
@erp/api:test:  ✓ src/config/env.spec.ts (3 tests) 5ms
@erp/api:test:  ✓ src/infra/db/tenant-context.spec.ts (3 tests) 3ms
@erp/api:test:  ✓ src/infra/observability/request-context.spec.ts (3 tests) 4ms
@erp/api:test: 
@erp/api:test:  Test Files  17 passed (17)
@erp/api:test:       Tests  142 passed (142)
@erp/api:test:    Start at  00:54:59
@erp/api:test:    Duration  12.10s (transform 1.45s, setup 0ms, collect 7.01s, tests 760ms, environment 4ms, prepare 1.45s)
@erp/api:test: 

 Tasks:    4 successful, 4 total
Cached:    0 cached, 4 total
  Time:    14.337s 


=== db suite (embedded PostgreSQL 16: RLS attacks, identity flows, jobs, files, readiness) ===

> erp-platform@0.1.0 test:db /home/z/erp-platform
> turbo run test:db


   • turbo 2.11.10
   • Packages in scope: @erp/api, @erp/config, @erp/contracts, @erp/domain-core, @erp/ui, @erp/web
   • Running test:db in 6 packages
   • Remote caching disabled

@erp/api:test:db: cache bypass, force executing 74d9d74c5317b9ac
@erp/api:test:db: 
@erp/api:test:db: > @erp/api@0.1.0 test:db /home/z/erp-platform/apps/api
@erp/api:test:db: > vitest run --config vitest.db.config.ts
@erp/api:test:db: 
@erp/api:test:db: 
@erp/api:test:db:  RUN  v3.2.7 /home/z/erp-platform/apps/api
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
@erp/api:test:db: 
@erp/api:test:db: creating directory /tmp/erp-api-testdb ... ok
@erp/api:test:db: creating subdirectories ... 
@erp/api:test:db: ok
@erp/api:test:db: 
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
@erp/api:test:db: 
@erp/api:test:db: Success. You can now start the database server using:
@erp/api:test:db: 
@erp/api:test:db:     '/home/z/erp-platform/node_modules/.pnpm/@embedded-postgres+linux-x64@16.14.0-beta.17/node_modules/@embedded-postgres/linux-x64/native/bin/pg_ctl' -D /tmp/erp-api-testdb -l logfile start
@erp/api:test:db: 
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:13.611 UTC [29826] LOG:  starting PostgreSQL 16.14 on x86_64-pc-linux-gnu, compiled by gcc (Ubuntu 7.5.0-3ubuntu1~18.04) 7.5.0, 64-bit
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:13.611 UTC [29826] LOG:  listening on IPv6 address "::1", port 43755
@erp/api:test:db: 2026-11-01 00:55:13.611 UTC [29826] LOG:  listening on IPv4 address "127.0.0.1", port 43755
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:13.611 UTC [29826] LOG:  listening on Unix socket "/tmp/.s.PGSQL.43755"
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:13.612 UTC [29829] LOG:  database system was shut down at 2026-11-01 00:55:13 UTC
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:13.613 UTC [29826] LOG:  database system is ready to accept connections
@erp/api:test:db: 
@erp/api:test:db: {"level":30,"time":1793494516388,"service":"erp-api","module":"jobs","action":"boss-started","msg":"pg-boss queue client started"}
@erp/api:test:db: {"level":30,"time":1793494518399,"service":"erp-api","module":"notifications","template":"invitation","msg":"email delivered"}
@erp/api:test:db: {"level":30,"time":1793494520397,"service":"erp-api","module":"notifications","template":"password_reset","msg":"email delivered"}
@erp/api:test:db: {"level":30,"time":1793494522397,"service":"erp-api","module":"notifications","template":"login_notification","msg":"email delivered"}
@erp/api:test:db: {"level":30,"time":1793494523252,"service":"erp-api","module":"jobs","action":"boss-stopped","msg":"pg-boss queue client stopped"}
@erp/api:test:db:  ✓ src/__db__/notifications-email.db.spec.ts (5 tests) 6896ms
@erp/api:test:db:    ✓ email adapter (real SMTP session + pg-boss idempotency) > renders + delivers the AR invitation with the accept link through the queue  2025ms
@erp/api:test:db:    ✓ email adapter (real SMTP session + pg-boss idempotency) > delivers the EN password reset (30-minute wording + link)  2008ms
@erp/api:test:db:    ✓ email adapter (real SMTP session + pg-boss idempotency) > duplicate enqueue of the same logical email sends exactly once (idempotent handler)  2811ms
@erp/api:test:db:  ✓ src/__db__/inventory/operations.spec.ts (6 tests) 4985ms
@erp/api:test:db:    ✓ CC-04 — the stock-issue race on the last units > two concurrent issues of the last units: one wins, one fails INSUFFICIENT_STOCK  337ms
@erp/api:test:db:    ✓ T-01 — movement ledger + stock queries perf smoke (seeded 100k moves) > indexed queries stay within the local smoke budget at 100k rows  4353ms
@erp/api:test:db: {"level":30,"time":1793494531001,"service":"erp-api","module":"jobs","action":"boss-started","msg":"pg-boss queue client started"}
@erp/api:test:db: {"level":30,"time":1793494531221,"service":"erp-api","module":"http","correlation_id":"01a1949a-bc03-7000-9468-f995e0e751ba","action":"request","method":"POST","path":"/api/v1/identity/sessions","status":200,"duration_ms":146,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793494531286,"service":"erp-api","module":"http","correlation_id":"01a1949a-bcb8-7000-aedb-d3997cfdee19","action":"request","method":"POST","path":"/api/v1/items/import-jobs","status":200,"duration_ms":30,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793494531304,"service":"erp-api","module":"http","correlation_id":"01a1949a-bce2-7000-912e-9b0f4ea12729","action":"request","method":"POST","path":"/api/v1/items/import-jobs","status":200,"duration_ms":6,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793494531320,"service":"erp-api","module":"http","correlation_id":"01a1949a-bceb-7000-887a-a6bb6cc24c5c","action":"request","method":"POST","path":"/api/v1/items/import-jobs/01a1949a-bcc3-7000-9381-2271dfd171dd/commit","status":200,"duration_ms":13,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793494531330,"service":"erp-api","module":"http","correlation_id":"01a1949a-bcf9-7000-9f7d-2ec3fa42049a","action":"request","method":"GET","path":"/api/v1/items/import-jobs/01a1949a-bcc3-7000-9381-2271dfd171dd","status":200,"duration_ms":9,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793494531589,"service":"erp-api","module":"http","correlation_id":"01a1949a-bdff-7000-a80f-a8e8c3eea228","action":"request","method":"GET","path":"/api/v1/items/import-jobs/01a1949a-bcc3-7000-9381-2271dfd171dd","status":200,"duration_ms":6,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793494531846,"service":"erp-api","module":"http","correlation_id":"01a1949a-bf00-7000-9e22-1c4b041ab270","action":"request","method":"GET","path":"/api/v1/items/import-jobs/01a1949a-bcc3-7000-9381-2271dfd171dd","status":200,"duration_ms":6,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793494532102,"service":"erp-api","module":"http","correlation_id":"01a1949a-c001-7000-b24d-3960cf61574c","action":"request","method":"GET","path":"/api/v1/items/import-jobs/01a1949a-bcc3-7000-9381-2271dfd171dd","status":200,"duration_ms":5,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793494532360,"service":"erp-api","module":"http","correlation_id":"01a1949a-c103-7000-a5d3-793292a259ea","action":"request","method":"GET","path":"/api/v1/items/import-jobs/01a1949a-bcc3-7000-9381-2271dfd171dd","status":200,"duration_ms":5,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793494532618,"service":"erp-api","module":"http","correlation_id":"01a1949a-c204-7000-9b84-96c5278bfe89","action":"request","method":"GET","path":"/api/v1/items/import-jobs/01a1949a-bcc3-7000-9381-2271dfd171dd","status":200,"duration_ms":6,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793494532875,"service":"erp-api","module":"http","correlation_id":"01a1949a-c306-7000-ab4b-13b684762cc7","action":"request","method":"GET","path":"/api/v1/items/import-jobs/01a1949a-bcc3-7000-9381-2271dfd171dd","status":200,"duration_ms":5,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793494533004,"service":"erp-api","module":"notifications","template":"login_notification","correlation_id":"01a1949a-bc03-7000-9468-f995e0e751ba","msg":"email delivered"}
@erp/api:test:db: {"level":30,"time":1793494533132,"service":"erp-api","module":"http","correlation_id":"01a1949a-c407-7000-835d-663642f22319","action":"request","method":"GET","path":"/api/v1/items/import-jobs/01a1949a-bcc3-7000-9381-2271dfd171dd","status":200,"duration_ms":5,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793494533140,"service":"erp-api","module":"http","correlation_id":"01a1949a-c40e-7000-839e-8bae10fb45f3","action":"request","method":"POST","path":"/api/v1/items/import-jobs/01a1949a-bcc3-7000-9381-2271dfd171dd/commit","status":200,"duration_ms":5,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793494533160,"service":"erp-api","module":"http","correlation_id":"01a1949a-c415-7000-bc1b-ef3ad917c2e9","action":"request","method":"POST","path":"/api/v1/items/import-jobs","status":200,"duration_ms":19,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793494533192,"service":"erp-api","module":"http","correlation_id":"01a1949a-c430-7000-a465-8dc36399e044","action":"request","method":"POST","path":"/api/v1/items/import-jobs","status":422,"duration_ms":24,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793494533261,"service":"erp-api","module":"http","correlation_id":"01a1949a-c46b-7000-a9cf-33cffe5e91e6","action":"request","method":"POST","path":"/api/v1/items/import-jobs","status":200,"duration_ms":34,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793494533271,"service":"erp-api","module":"http","correlation_id":"01a1949a-c48f-7000-82b9-10cffce7e9f6","action":"request","method":"POST","path":"/api/v1/items/import-jobs/01a1949a-c46e-7000-b30f-1165b1a5673c/commit","status":200,"duration_ms":8,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793494533277,"service":"erp-api","module":"http","correlation_id":"01a1949a-c498-7000-aa39-2361dc572339","action":"request","method":"GET","path":"/api/v1/items/import-jobs/01a1949a-c46e-7000-b30f-1165b1a5673c","status":200,"duration_ms":5,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793494533535,"service":"erp-api","module":"http","correlation_id":"01a1949a-c599-7000-b09b-e7265540eecc","action":"request","method":"GET","path":"/api/v1/items/import-jobs/01a1949a-c46e-7000-b30f-1165b1a5673c","status":200,"duration_ms":6,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793494533791,"service":"erp-api","module":"http","correlation_id":"01a1949a-c69a-7000-93b7-00a52d3748dd","action":"request","method":"GET","path":"/api/v1/items/import-jobs/01a1949a-c46e-7000-b30f-1165b1a5673c","status":200,"duration_ms":5,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793494534048,"service":"erp-api","module":"http","correlation_id":"01a1949a-c79c-7000-8b04-f5d2c29aba93","action":"request","method":"GET","path":"/api/v1/items/import-jobs/01a1949a-c46e-7000-b30f-1165b1a5673c","status":200,"duration_ms":4,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793494534305,"service":"erp-api","module":"http","correlation_id":"01a1949a-c89c-7000-a0f0-ab3b2334f533","action":"request","method":"GET","path":"/api/v1/items/import-jobs/01a1949a-c46e-7000-b30f-1165b1a5673c","status":200,"duration_ms":5,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793494534564,"service":"erp-api","module":"http","correlation_id":"01a1949a-c99e-7000-9345-89792827b1b5","action":"request","method":"GET","path":"/api/v1/items/import-jobs/01a1949a-c46e-7000-b30f-1165b1a5673c","status":200,"duration_ms":6,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793494534821,"service":"erp-api","module":"http","correlation_id":"01a1949a-caa0-7000-8df7-32c199d2702a","action":"request","method":"GET","path":"/api/v1/items/import-jobs/01a1949a-c46e-7000-b30f-1165b1a5673c","status":200,"duration_ms":4,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793494535078,"service":"erp-api","module":"http","correlation_id":"01a1949a-cba2-7000-9f54-09f305acf800","action":"request","method":"GET","path":"/api/v1/items/import-jobs/01a1949a-c46e-7000-b30f-1165b1a5673c","status":200,"duration_ms":4,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793494535111,"service":"erp-api","module":"http","correlation_id":"01a1949a-cbb1-7000-9cc8-f10e22eb2079","action":"request","method":"POST","path":"/api/v1/items/export-jobs","status":200,"duration_ms":22,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793494535121,"service":"erp-api","module":"jobs","action":"boss-stopped","msg":"pg-boss queue client stopped"}
@erp/api:test:db:  ✓ src/__db__/import-export.db.spec.ts (4 tests) 4454ms
@erp/api:test:db:    ✓ PHASE-006 import/export engine > dry-run preview: row errors, duplicates, Arabic round-trip — all without writing  1935ms
@erp/api:test:db:    ✓ PHASE-006 import/export engine > XLSX import round-trips Arabic headers and content  1895ms
@erp/api:test:db: {"level":40,"time":1793494536132,"service":"erp-api","module":"identity","user_id":"01a1949a-cd8b-7000-a0bc-9a8d55d27ac2","msg":"temporary lockout engaged (R-01)"}
@erp/api:test:db: {"level":40,"time":1793494536257,"service":"erp-api","module":"identity","email_hash":"405489a6a8e8","msg":"login attempt for unknown email"}
@erp/api:test:db: {"level":40,"time":1793494536505,"service":"erp-api","module":"identity","email_hash":"fe90e9be6563","msg":"login attempt for unknown email"}
@erp/api:test:db: {"level":40,"time":1793494536506,"service":"erp-api","module":"identity","email_hash":"236f1b9d195a","msg":"login attempt for unknown email"}
@erp/api:test:db: {"level":40,"time":1793494536506,"service":"erp-api","module":"identity","email_hash":"0b62835181c6","msg":"login attempt for unknown email"}
@erp/api:test:db: {"level":40,"time":1793494536507,"service":"erp-api","module":"identity","email_hash":"1c3ae17b41ed","msg":"login attempt for unknown email"}
@erp/api:test:db: {"level":40,"time":1793494536507,"service":"erp-api","module":"identity","email_hash":"f794a635dbba","msg":"login attempt for unknown email"}
@erp/api:test:db: {"level":40,"time":1793494536507,"service":"erp-api","module":"identity","email_hash":"a0a18e76e0be","msg":"login attempt for unknown email"}
@erp/api:test:db: {"level":40,"time":1793494536508,"service":"erp-api","module":"identity","email_hash":"6411faf0d2b7","msg":"login attempt for unknown email"}
@erp/api:test:db: {"level":40,"time":1793494536508,"service":"erp-api","module":"identity","email_hash":"3bea867b9b16","msg":"login attempt for unknown email"}
@erp/api:test:db: {"level":40,"time":1793494536508,"service":"erp-api","module":"identity","email_hash":"3b789b5ed688","msg":"login attempt for unknown email"}
@erp/api:test:db: {"level":40,"time":1793494536509,"service":"erp-api","module":"identity","email_hash":"2b71691224f2","msg":"login attempt for unknown email"}
@erp/api:test:db: {"level":30,"time":1793494537415,"service":"erp-api","module":"identity","user_id":"01a1949a-d44e-7000-8667-abbd4f1fba11","msg":"password reset consumed; all sessions revoked"}
@erp/api:test:db:  ✓ src/__db__/identity-flows.db.spec.ts (21 tests) 4135ms
@erp/api:test:db:    ✓ login + progressive lockout (R-01, R-02, acceptance 1/2) > progressive lockout: N failures → temporary lock, never permanent; counters reset on success (R-01)  818ms
@erp/api:test:db:    ✓ TOTP MFA (M-06, M-07, acceptance 3) > enroll → verify confirms; same-code replay rejected; recovery codes single-use  500ms
@erp/api:test:db: 2026-11-01 00:55:39.591 UTC [29986] ERROR:  new row violates row-level security policy for table "audit_events"
@erp/api:test:db: 2026-11-01 00:55:39.591 UTC [29986] STATEMENT:  INSERT INTO audit_events (id, tenant_id, action, entity_type, entity_id)
@erp/api:test:db: 	     VALUES ('eeeeeeee-3000-4000-8000-000000000003', $1, 'iso.attack', 'iso_fixture', $1)
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:39.598 UTC [29987] ERROR:  permission denied for table audit_events
@erp/api:test:db: 2026-11-01 00:55:39.598 UTC [29987] STATEMENT:  UPDATE audit_events SET action = action WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:39.605 UTC [29988] ERROR:  permission denied for table audit_events
@erp/api:test:db: 2026-11-01 00:55:39.605 UTC [29988] STATEMENT:  DELETE FROM audit_events WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:39.631 UTC [29992] ERROR:  new row violates row-level security policy for table "memberships"
@erp/api:test:db: 2026-11-01 00:55:39.631 UTC [29992] STATEMENT:  INSERT INTO memberships (id, tenant_id, user_id, role_id)
@erp/api:test:db: 	     VALUES ('ffffffff-3000-4000-8000-000000000003', $1,
@erp/api:test:db: 	             'eeeeeeee-0000-4000-8000-000000000002', 'dddddddd-0000-4000-8000-000000000002')
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:39.645 UTC [29994] ERROR:  permission denied for table memberships
@erp/api:test:db: 2026-11-01 00:55:39.645 UTC [29994] STATEMENT:  DELETE FROM memberships WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:39.671 UTC [29998] ERROR:  new row violates row-level security policy for table "invitations"
@erp/api:test:db: 2026-11-01 00:55:39.671 UTC [29998] STATEMENT:  INSERT INTO invitations (id, tenant_id, email, role_id, token_hash, expires_at, invited_by)
@erp/api:test:db: 	     VALUES ('eeeeeeee-4000-4000-8000-000000000003', $1, 'iso-attack@test',
@erp/api:test:db: 	             'dddddddd-0000-4000-8000-000000000002', 'iso-attack-token', now() + interval '72 hours',
@erp/api:test:db: 	             'eeeeeeee-0000-4000-8000-000000000002')
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:39.685 UTC [30000] ERROR:  permission denied for table invitations
@erp/api:test:db: 2026-11-01 00:55:39.685 UTC [30000] STATEMENT:  DELETE FROM invitations WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:39.711 UTC [30004] ERROR:  new row violates row-level security policy for table "roles"
@erp/api:test:db: 2026-11-01 00:55:39.711 UTC [30004] STATEMENT:  INSERT INTO roles (id, tenant_id, key, name)
@erp/api:test:db: 	     VALUES ('dddddddd-3000-4000-8000-000000000003', $1, 'attack_role', 'Attack Role')
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:39.752 UTC [30010] ERROR:  new row violates row-level security policy for table "role_permissions"
@erp/api:test:db: 2026-11-01 00:55:39.752 UTC [30010] STATEMENT:  INSERT INTO role_permissions (role_id, tenant_id, permission_id)
@erp/api:test:db: 	     VALUES ('dddddddd-0000-4000-8000-000000000002', $1, 'partners.view')
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:39.759 UTC [30011] ERROR:  permission denied for table role_permissions
@erp/api:test:db: 2026-11-01 00:55:39.759 UTC [30011] STATEMENT:  UPDATE role_permissions SET granted_at = granted_at WHERE role_id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:39.792 UTC [30016] ERROR:  new row violates row-level security policy for table "branches"
@erp/api:test:db: 2026-11-01 00:55:39.792 UTC [30016] STATEMENT:  INSERT INTO branches (id, tenant_id, code, name)
@erp/api:test:db: 	     VALUES ('abababab-3000-4000-8000-000000000003', $1, 'ATK', 'Attack Branch')
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:39.806 UTC [30018] ERROR:  permission denied for table branches
@erp/api:test:db: 2026-11-01 00:55:39.806 UTC [30018] STATEMENT:  DELETE FROM branches WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:39.833 UTC [30022] ERROR:  new row violates row-level security policy for table "tenant_settings"
@erp/api:test:db: 2026-11-01 00:55:39.833 UTC [30022] STATEMENT:  INSERT INTO tenant_settings (id, tenant_id, key, value)
@erp/api:test:db: 	     VALUES ('acacacac-3000-4000-8000-000000000003', $1, 'sales.credit_limit_action', '"warn"'::jsonb)
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:39.845 UTC [30024] ERROR:  permission denied for table tenant_settings
@erp/api:test:db: 2026-11-01 00:55:39.845 UTC [30024] STATEMENT:  DELETE FROM tenant_settings WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:39.871 UTC [30028] ERROR:  new row violates row-level security policy for table "subscriptions"
@erp/api:test:db: 2026-11-01 00:55:39.871 UTC [30028] STATEMENT:  INSERT INTO subscriptions (id, tenant_id, plan_id, period_start, period_end)
@erp/api:test:db: 	     VALUES ('adadadad-3000-4000-8000-000000000003', $1,
@erp/api:test:db: 	             '30000000-0000-4000-8000-000000000002', '2026-01-01', '2026-12-31')
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:39.884 UTC [30030] ERROR:  permission denied for table subscriptions
@erp/api:test:db: 2026-11-01 00:55:39.884 UTC [30030] STATEMENT:  DELETE FROM subscriptions WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:39.912 UTC [30034] ERROR:  new row violates row-level security policy for table "entitlements"
@erp/api:test:db: 2026-11-01 00:55:39.912 UTC [30034] STATEMENT:  INSERT INTO entitlements (id, tenant_id, feature_key, source)
@erp/api:test:db: 	     VALUES ('aeaeaeae-3000-4000-8000-000000000003', $1, 'pos.sales', 'MANUAL')
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:39.950 UTC [30040] ERROR:  new row violates row-level security policy for table "support_sessions"
@erp/api:test:db: 2026-11-01 00:55:39.950 UTC [30040] STATEMENT:  INSERT INTO support_sessions (id, tenant_id, platform_user_id, opt_in, ticket_ref, reason, expires_at)
@erp/api:test:db: 	     VALUES ('afafafaf-3000-4000-8000-000000000003', $1,
@erp/api:test:db: 	             'eeeeeeee-0000-4000-8000-000000000001', false, 'ISO-ATK', 'attack fixture',
@erp/api:test:db: 	             now() + interval '4 hours')
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:39.962 UTC [30042] ERROR:  permission denied for table support_sessions
@erp/api:test:db: 2026-11-01 00:55:39.962 UTC [30042] STATEMENT:  DELETE FROM support_sessions WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:39.988 UTC [30046] ERROR:  new row violates row-level security policy for table "accounts"
@erp/api:test:db: 2026-11-01 00:55:39.988 UTC [30046] STATEMENT:  INSERT INTO accounts (id, tenant_id, code, name, name_ar, type, is_postable)
@erp/api:test:db: 	     VALUES ('b0b0b0b0-3000-4000-8000-000000000003', $1, '2000', 'Attack Account', 'حساب هجوم', 'ASSET', false)
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:40.000 UTC [30048] ERROR:  permission denied for table accounts
@erp/api:test:db: 2026-11-01 00:55:40.000 UTC [30048] STATEMENT:  DELETE FROM accounts WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:40.026 UTC [30052] ERROR:  new row violates row-level security policy for table "account_purposes"
@erp/api:test:db: 2026-11-01 00:55:40.026 UTC [30052] STATEMENT:  INSERT INTO account_purposes (id, tenant_id, purpose_key, account_id, active_from)
@erp/api:test:db: 	     VALUES ('b1b1b1b1-3000-4000-8000-000000000003', $1, 'AP_CONTROL',
@erp/api:test:db: 	             'b0b0b0b0-0000-4000-8000-000000000002', '2026-01-01')
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:40.038 UTC [30054] ERROR:  permission denied for table account_purposes
@erp/api:test:db: 2026-11-01 00:55:40.038 UTC [30054] STATEMENT:  DELETE FROM account_purposes WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:40.063 UTC [30058] ERROR:  new row violates row-level security policy for table "credit_terms"
@erp/api:test:db: 2026-11-01 00:55:40.063 UTC [30058] STATEMENT:  INSERT INTO credit_terms (id, tenant_id, code, name, days)
@erp/api:test:db: 	     VALUES ('b3b3b3b3-3000-4000-8000-000000000003', $1, 'ATK-NET', 'Attack Terms', 90)
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:40.076 UTC [30060] ERROR:  permission denied for table credit_terms
@erp/api:test:db: 2026-11-01 00:55:40.076 UTC [30060] STATEMENT:  DELETE FROM credit_terms WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:40.101 UTC [30064] ERROR:  new row violates row-level security policy for table "price_lists"
@erp/api:test:db: 2026-11-01 00:55:40.101 UTC [30064] STATEMENT:  INSERT INTO price_lists (id, tenant_id, name, kind, currency_code)
@erp/api:test:db: 	     VALUES ('b4b4b4b4-3000-4000-8000-000000000003', $1, 'Attack List', 'SALE', 'SAR')
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:40.114 UTC [30066] ERROR:  permission denied for table price_lists
@erp/api:test:db: 2026-11-01 00:55:40.114 UTC [30066] STATEMENT:  DELETE FROM price_lists WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:40.141 UTC [30070] ERROR:  new row violates row-level security policy for table "partners"
@erp/api:test:db: 2026-11-01 00:55:40.141 UTC [30070] STATEMENT:  INSERT INTO partners (id, tenant_id, kind, code, name)
@erp/api:test:db: 	     VALUES ('b5b5b5b5-3000-4000-8000-000000000003', $1, 'CUSTOMER', 'ATK-P', 'Attack Partner')
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:40.155 UTC [30072] ERROR:  permission denied for table partners
@erp/api:test:db: 2026-11-01 00:55:40.155 UTC [30072] STATEMENT:  DELETE FROM partners WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:40.181 UTC [30076] ERROR:  new row violates row-level security policy for table "partner_contacts"
@erp/api:test:db: 2026-11-01 00:55:40.181 UTC [30076] STATEMENT:  INSERT INTO partner_contacts (id, tenant_id, partner_id, name)
@erp/api:test:db: 	     VALUES ('b6b6b6b6-3000-4000-8000-000000000003', $1,
@erp/api:test:db: 	             'b5b5b5b5-0000-4000-8000-000000000002', 'Attack Contact')
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:40.194 UTC [30078] ERROR:  permission denied for table partner_contacts
@erp/api:test:db: 2026-11-01 00:55:40.194 UTC [30078] STATEMENT:  DELETE FROM partner_contacts WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:40.219 UTC [30082] ERROR:  new row violates row-level security policy for table "partner_addresses"
@erp/api:test:db: 2026-11-01 00:55:40.219 UTC [30082] STATEMENT:  INSERT INTO partner_addresses (id, tenant_id, partner_id, type, line1)
@erp/api:test:db: 	     VALUES ('b7b7b7b7-3000-4000-8000-000000000003', $1,
@erp/api:test:db: 	             'b5b5b5b5-0000-4000-8000-000000000002', 'SHIPPING', 'Attack Line')
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:40.231 UTC [30084] ERROR:  permission denied for table partner_addresses
@erp/api:test:db: 2026-11-01 00:55:40.231 UTC [30084] STATEMENT:  DELETE FROM partner_addresses WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:40.256 UTC [30088] ERROR:  new row violates row-level security policy for table "item_categories"
@erp/api:test:db: 2026-11-01 00:55:40.256 UTC [30088] STATEMENT:  INSERT INTO item_categories (id, tenant_id, code, name)
@erp/api:test:db: 	     VALUES ('b8b8b8b8-3000-4000-8000-000000000003', $1, 'ATK-CAT', 'Attack Category')
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:40.269 UTC [30090] ERROR:  permission denied for table item_categories
@erp/api:test:db: 2026-11-01 00:55:40.269 UTC [30090] STATEMENT:  DELETE FROM item_categories WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:40.295 UTC [30094] ERROR:  new row violates row-level security policy for table "uoms"
@erp/api:test:db: 2026-11-01 00:55:40.295 UTC [30094] STATEMENT:  INSERT INTO uoms (id, tenant_id, code, name)
@erp/api:test:db: 	     VALUES ('b2b2b2b2-3000-4000-8000-000000000003', $1, 'ATK-U', 'Attack Unit')
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:40.307 UTC [30096] ERROR:  permission denied for table uoms
@erp/api:test:db: 2026-11-01 00:55:40.307 UTC [30096] STATEMENT:  DELETE FROM uoms WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:40.332 UTC [30100] ERROR:  new row violates row-level security policy for table "uom_conversions"
@erp/api:test:db: 2026-11-01 00:55:40.332 UTC [30100] STATEMENT:  INSERT INTO uom_conversions (id, tenant_id, from_uom_id, to_uom_id, factor)
@erp/api:test:db: 	     VALUES ('b9b9b9b9-3000-4000-8000-000000000003', $1,
@erp/api:test:db: 	             'b2b2b2b2-0000-4000-8000-000000000002', 'b2b2b2b2-1000-4000-8000-000000000002', 999)
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:40.345 UTC [30102] ERROR:  permission denied for table uom_conversions
@erp/api:test:db: 2026-11-01 00:55:40.345 UTC [30102] STATEMENT:  DELETE FROM uom_conversions WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:40.372 UTC [30106] ERROR:  new row violates row-level security policy for table "items"
@erp/api:test:db: 2026-11-01 00:55:40.372 UTC [30106] STATEMENT:  INSERT INTO items (id, tenant_id, sku, name, kind, uom_id)
@erp/api:test:db: 	     VALUES ('babababa-3000-4000-8000-000000000003', $1, 'ATK-ITEM', 'Attack Item', 'STOCK',
@erp/api:test:db: 	             'b2b2b2b2-0000-4000-8000-000000000002')
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:40.385 UTC [30108] ERROR:  permission denied for table items
@erp/api:test:db: 2026-11-01 00:55:40.385 UTC [30108] STATEMENT:  DELETE FROM items WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:40.411 UTC [30112] ERROR:  new row violates row-level security policy for table "barcodes"
@erp/api:test:db: 2026-11-01 00:55:40.411 UTC [30112] STATEMENT:  INSERT INTO barcodes (id, tenant_id, item_id, uom_id, code)
@erp/api:test:db: 	     VALUES ('bbbbbbbb-3000-4000-8000-000000000003', $1,
@erp/api:test:db: 	             'babababa-0000-4000-8000-000000000002', 'b2b2b2b2-0000-4000-8000-000000000002', '9999999999999')
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:40.424 UTC [30114] ERROR:  permission denied for table barcodes
@erp/api:test:db: 2026-11-01 00:55:40.424 UTC [30114] STATEMENT:  DELETE FROM barcodes WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:40.449 UTC [30118] ERROR:  new row violates row-level security policy for table "price_list_items"
@erp/api:test:db: 2026-11-01 00:55:40.449 UTC [30118] STATEMENT:  INSERT INTO price_list_items (id, tenant_id, price_list_id, item_id, uom_id, unit_price, min_qty)
@erp/api:test:db: 	     VALUES ('bcbcbcbc-3000-4000-8000-000000000003', $1,
@erp/api:test:db: 	             'b4b4b4b4-0000-4000-8000-000000000002', 'babababa-0000-4000-8000-000000000002',
@erp/api:test:db: 	             'b2b2b2b2-0000-4000-8000-000000000002', 42, 99)
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:40.462 UTC [30120] ERROR:  permission denied for table price_list_items
@erp/api:test:db: 2026-11-01 00:55:40.462 UTC [30120] STATEMENT:  DELETE FROM price_list_items WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:40.487 UTC [30124] ERROR:  new row violates row-level security policy for table "partner_balances"
@erp/api:test:db: 2026-11-01 00:55:40.487 UTC [30124] STATEMENT:  INSERT INTO partner_balances (id, tenant_id, partner_id, draft_balance)
@erp/api:test:db: 	     VALUES ('bdbdbdbd-3000-4000-8000-000000000003', $1,
@erp/api:test:db: 	             'b5b5b5b5-0000-4000-8000-000000000002', 777)
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:40.500 UTC [30126] ERROR:  permission denied for table partner_balances
@erp/api:test:db: 2026-11-01 00:55:40.500 UTC [30126] STATEMENT:  DELETE FROM partner_balances WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:40.525 UTC [30130] ERROR:  new row violates row-level security policy for table "opening_balance_docs"
@erp/api:test:db: 2026-11-01 00:55:40.525 UTC [30130] STATEMENT:  INSERT INTO opening_balance_docs (id, tenant_id, kind, account_id, amount, currency_code)
@erp/api:test:db: 	     VALUES ('bebebebe-3000-4000-8000-000000000003', $1, 'ACCOUNT',
@erp/api:test:db: 	             'b0b0b0b0-0000-4000-8000-000000000002', 100, 'SAR')
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:40.538 UTC [30132] ERROR:  permission denied for table opening_balance_docs
@erp/api:test:db: 2026-11-01 00:55:40.538 UTC [30132] STATEMENT:  DELETE FROM opening_balance_docs WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:40.564 UTC [30136] ERROR:  new row violates row-level security policy for table "file_objects"
@erp/api:test:db: 2026-11-01 00:55:40.564 UTC [30136] STATEMENT:  INSERT INTO file_objects (id, tenant_id, owner_type, owner_id, storage_key, name, size_bytes, content_type)
@erp/api:test:db: 	     VALUES ('bfbfbfbf-3000-4000-8000-000000000003', $1, 'PARTNER',
@erp/api:test:db: 	             'b5b5b5b5-0000-4000-8000-000000000002', 'iso/attack.pdf', 'attack.pdf', 10, 'application/pdf')
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:40.577 UTC [30138] ERROR:  permission denied for table file_objects
@erp/api:test:db: 2026-11-01 00:55:40.577 UTC [30138] STATEMENT:  DELETE FROM file_objects WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:40.602 UTC [30142] ERROR:  new row violates row-level security policy for table "import_jobs"
@erp/api:test:db: 2026-11-01 00:55:40.602 UTC [30142] STATEMENT:  INSERT INTO import_jobs (id, tenant_id, kind, format, upload_token, file_key)
@erp/api:test:db: 	     VALUES ('c0c0c0c0-3000-4000-8000-000000000003', $1, 'ITEMS', 'CSV', 'iso-attack-token',
@erp/api:test:db: 	             'iso/attack.csv')
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:40.614 UTC [30144] ERROR:  permission denied for table import_jobs
@erp/api:test:db: 2026-11-01 00:55:40.614 UTC [30144] STATEMENT:  DELETE FROM import_jobs WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:40.640 UTC [30148] ERROR:  new row violates row-level security policy for table "fiscal_years"
@erp/api:test:db: 2026-11-01 00:55:40.640 UTC [30148] STATEMENT:  INSERT INTO fiscal_years (id, tenant_id, name, start_date, end_date)
@erp/api:test:db: 	     VALUES ('c1c1c1c1-3000-4000-8000-000000000003', $1, 'ATK', '2027-01-01', '2027-12-31')
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:40.653 UTC [30150] ERROR:  permission denied for table fiscal_years
@erp/api:test:db: 2026-11-01 00:55:40.653 UTC [30150] STATEMENT:  DELETE FROM fiscal_years WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:40.678 UTC [30154] ERROR:  new row violates row-level security policy for table "fiscal_periods"
@erp/api:test:db: 2026-11-01 00:55:40.678 UTC [30154] STATEMENT:  INSERT INTO fiscal_periods (id, tenant_id, fiscal_year_id, name, kind, start_date, end_date)
@erp/api:test:db: 	     VALUES ('c2c2c2c2-3000-4000-8000-000000000003', $1, 'c1c1c1c1-0000-4000-8000-000000000002',
@erp/api:test:db: 	             '2027-01', 'REGULAR', '2027-01-01', '2027-01-31')
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:40.691 UTC [30156] ERROR:  permission denied for table fiscal_periods
@erp/api:test:db: 2026-11-01 00:55:40.691 UTC [30156] STATEMENT:  DELETE FROM fiscal_periods WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:40.716 UTC [30160] ERROR:  new row violates row-level security policy for table "exchange_rates"
@erp/api:test:db: 2026-11-01 00:55:40.716 UTC [30160] STATEMENT:  INSERT INTO exchange_rates (id, tenant_id, currency_code, rate_date, rate)
@erp/api:test:db: 	     VALUES ('c3c3c3c3-3000-4000-8000-000000000003', $1, 'EUR', '2026-02-01', 4.05)
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:40.729 UTC [30162] ERROR:  permission denied for table exchange_rates
@erp/api:test:db: 2026-11-01 00:55:40.729 UTC [30162] STATEMENT:  DELETE FROM exchange_rates WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:40.754 UTC [30166] ERROR:  new row violates row-level security policy for table "cost_centers"
@erp/api:test:db: 2026-11-01 00:55:40.754 UTC [30166] STATEMENT:  INSERT INTO cost_centers (id, tenant_id, code, name)
@erp/api:test:db: 	     VALUES ('c4c4c4c4-3000-4000-8000-000000000003', $1, 'ATK', 'Attack Center')
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:40.769 UTC [30168] ERROR:  permission denied for table cost_centers
@erp/api:test:db: 2026-11-01 00:55:40.769 UTC [30168] STATEMENT:  DELETE FROM cost_centers WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:40.794 UTC [30172] ERROR:  new row violates row-level security policy for table "recurring_journals"
@erp/api:test:db: 2026-11-01 00:55:40.794 UTC [30172] STATEMENT:  INSERT INTO recurring_journals (id, tenant_id, name, template, schedule, start_date, next_run_date)
@erp/api:test:db: 	     VALUES ('c5c5c5c5-3000-4000-8000-000000000003', $1, 'ATK', '{"lines": []}'::jsonb,
@erp/api:test:db: 	             'MONTHLY', '2026-02-01', '2026-03-01')
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:40.809 UTC [30174] ERROR:  permission denied for table recurring_journals
@erp/api:test:db: 2026-11-01 00:55:40.809 UTC [30174] STATEMENT:  DELETE FROM recurring_journals WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:40.834 UTC [30178] ERROR:  new row violates row-level security policy for table "approval_policies"
@erp/api:test:db: 2026-11-01 00:55:40.834 UTC [30178] STATEMENT:  INSERT INTO approval_policies (id, tenant_id, doc_type, policy, applies_from)
@erp/api:test:db: 	     VALUES ('c6c6c6c6-3000-4000-8000-000000000003', $1, 'journal_entry',
@erp/api:test:db: 	             '{"mode": "none"}'::jsonb, '2026-02-01')
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:40.847 UTC [30180] ERROR:  permission denied for table approval_policies
@erp/api:test:db: 2026-11-01 00:55:40.847 UTC [30180] STATEMENT:  DELETE FROM approval_policies WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:40.872 UTC [30184] ERROR:  new row violates row-level security policy for table "numbering_sequences"
@erp/api:test:db: 2026-11-01 00:55:40.872 UTC [30184] STATEMENT:  INSERT INTO numbering_sequences (id, tenant_id, doc_type, period_key, next_value)
@erp/api:test:db: 	     VALUES ('c7c7c7c7-3000-4000-8000-000000000003', $1, 'journal_entry', '2027', 1)
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:40.885 UTC [30186] ERROR:  permission denied for table numbering_sequences
@erp/api:test:db: 2026-11-01 00:55:40.885 UTC [30186] STATEMENT:  DELETE FROM numbering_sequences WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:40.910 UTC [30190] ERROR:  new row violates row-level security policy for table "number_assignments"
@erp/api:test:db: 2026-11-01 00:55:40.910 UTC [30190] STATEMENT:  INSERT INTO number_assignments (id, tenant_id, doc_type, period_key, number, value)
@erp/api:test:db: 	     VALUES ('c8c8c8c8-3000-4000-8000-000000000003', $1, 'journal_entry', '2027', 'JE-2027-000001', 1)
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:40.922 UTC [30192] ERROR:  permission denied for table number_assignments
@erp/api:test:db: 2026-11-01 00:55:40.922 UTC [30192] STATEMENT:  DELETE FROM number_assignments WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:40.947 UTC [30196] ERROR:  new row violates row-level security policy for table "manual_journals"
@erp/api:test:db: 2026-11-01 00:55:40.947 UTC [30196] STATEMENT:  INSERT INTO manual_journals (id, tenant_id, status, entry_date, currency_code)
@erp/api:test:db: 	     VALUES ('c9c9c9c9-3000-4000-8000-000000000003', $1, 'DRAFT', '2026-02-05', 'SAR')
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:40.985 UTC [30202] ERROR:  new row violates row-level security policy for table "manual_journal_lines"
@erp/api:test:db: 2026-11-01 00:55:40.985 UTC [30202] STATEMENT:  INSERT INTO manual_journal_lines (id, tenant_id, manual_journal_id, line_no, account_id, direction, amount)
@erp/api:test:db: 	     VALUES ('cacacaca-3000-4000-8000-000000000003', $1, 'c9c9c9c9-0000-4000-8000-000000000002',
@erp/api:test:db: 	             1, 'b0b0b0b0-0000-4000-8000-000000000002', 'DEBIT', 10)
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:41.022 UTC [30208] ERROR:  new row violates row-level security policy for table "journal_templates"
@erp/api:test:db: 2026-11-01 00:55:41.022 UTC [30208] STATEMENT:  INSERT INTO journal_templates (id, tenant_id, name, lines)
@erp/api:test:db: 	     VALUES ('cbcbcbcb-3000-4000-8000-000000000003', $1, 'ATK template', '[{"direction": "DEBIT"}]'::jsonb)
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:41.035 UTC [30210] ERROR:  permission denied for table journal_templates
@erp/api:test:db: 2026-11-01 00:55:41.035 UTC [30210] STATEMENT:  DELETE FROM journal_templates WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:41.060 UTC [30214] ERROR:  new row violates row-level security policy for table "journal_entries"
@erp/api:test:db: 2026-11-01 00:55:41.060 UTC [30214] STATEMENT:  INSERT INTO journal_entries (id, tenant_id, entry_date, fiscal_period_id, currency_code, source_type, operation)
@erp/api:test:db: 	     VALUES ('cccccccc-3000-4000-8000-000000000003', $1, '2026-02-05',
@erp/api:test:db: 	             'c2c2c2c2-0000-4000-8000-000000000002', 'SAR', 'iso_attack', 'post')
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:41.074 UTC [30216] ERROR:  permission denied for table journal_entries
@erp/api:test:db: 2026-11-01 00:55:41.074 UTC [30216] STATEMENT:  DELETE FROM journal_entries WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:41.099 UTC [30220] ERROR:  new row violates row-level security policy for table "journal_lines"
@erp/api:test:db: 2026-11-01 00:55:41.099 UTC [30220] STATEMENT:  INSERT INTO journal_lines (id, tenant_id, journal_entry_id, line_no, account_id, direction, amount, base_amount)
@erp/api:test:db: 	     VALUES ('cdcdcdcd-3000-4000-8000-000000000003', $1, 'cccccccc-0000-4000-8000-000000000002',
@erp/api:test:db: 	             3, 'b0b0b0b0-0000-4000-8000-000000000002', 'DEBIT', 10, 10)
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:41.105 UTC [30221] ERROR:  permission denied for table journal_lines
@erp/api:test:db: 2026-11-01 00:55:41.105 UTC [30221] STATEMENT:  UPDATE journal_lines SET updated_at = updated_at WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:41.111 UTC [30222] ERROR:  permission denied for table journal_lines
@erp/api:test:db: 2026-11-01 00:55:41.111 UTC [30222] STATEMENT:  DELETE FROM journal_lines WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:41.137 UTC [30226] ERROR:  new row violates row-level security policy for table "partner_subledger_entries"
@erp/api:test:db: 2026-11-01 00:55:41.137 UTC [30226] STATEMENT:  INSERT INTO partner_subledger_entries (id, tenant_id, partner_id, journal_entry_id,
@erp/api:test:db: 	                                            journal_line_id, entry_date, direction, amount, base_amount, currency_code, source_type)
@erp/api:test:db: 	     VALUES ('cececece-3000-4000-8000-000000000003', $1, 'b5b5b5b5-0000-4000-8000-000000000002',
@erp/api:test:db: 	             'cccccccc-0000-4000-8000-000000000002', 'cdcdcdcd-0000-4000-8000-000000000002',
@erp/api:test:db: 	             '2026-01-20', 'DEBIT', 10, 10, 'SAR', 'iso_attack')
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:41.144 UTC [30227] ERROR:  permission denied for table partner_subledger_entries
@erp/api:test:db: 2026-11-01 00:55:41.144 UTC [30227] STATEMENT:  UPDATE partner_subledger_entries SET updated_at = updated_at WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:41.150 UTC [30228] ERROR:  permission denied for table partner_subledger_entries
@erp/api:test:db: 2026-11-01 00:55:41.150 UTC [30228] STATEMENT:  DELETE FROM partner_subledger_entries WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:41.176 UTC [30232] ERROR:  new row violates row-level security policy for table "reconciliation_runs"
@erp/api:test:db: 2026-11-01 00:55:41.176 UTC [30232] STATEMENT:  INSERT INTO reconciliation_runs (id, tenant_id, kind, as_of, status, control_balance, subledger_balance)
@erp/api:test:db: 	     VALUES ('cfcfcfcf-3000-4000-8000-000000000003', $1, 'AP', '2026-02-28', 'OK', 0, 0)
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:41.189 UTC [30234] ERROR:  permission denied for table reconciliation_runs
@erp/api:test:db: 2026-11-01 00:55:41.189 UTC [30234] STATEMENT:  DELETE FROM reconciliation_runs WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:41.214 UTC [30238] ERROR:  new row violates row-level security policy for table "cash_accounts"
@erp/api:test:db: 2026-11-01 00:55:41.214 UTC [30238] STATEMENT:  INSERT INTO cash_accounts (id, tenant_id, name, type, account_id, currency_code)
@erp/api:test:db: 	     VALUES ('d0d0d0d0-3000-4000-8000-000000000003', $1, 'Attack Cash', 'CASH',
@erp/api:test:db: 	             'b0b0b0b0-0000-4000-8000-000000000002', 'SAR')
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:41.226 UTC [30240] ERROR:  permission denied for table cash_accounts
@erp/api:test:db: 2026-11-01 00:55:41.226 UTC [30240] STATEMENT:  DELETE FROM cash_accounts WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:41.252 UTC [30244] ERROR:  new row violates row-level security policy for table "cash_movements"
@erp/api:test:db: 2026-11-01 00:55:41.252 UTC [30244] STATEMENT:  INSERT INTO cash_movements (id, tenant_id, cash_account_id, direction, amount, currency_code, exchange_rate, base_amount, source_type, source_id, value_date)
@erp/api:test:db: 	     VALUES ('d2d2d2d2-3000-4000-8000-000000000003', $1, 'd0d0d0d0-0000-4000-8000-000000000002', 'OUT',
@erp/api:test:db: 	             10, 'SAR', 1, 10, 'expense', 'd0d0d0d0-0000-4000-8000-000000000002', '2027-02-01')
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:41.259 UTC [30245] ERROR:  permission denied for table cash_movements
@erp/api:test:db: 2026-11-01 00:55:41.259 UTC [30245] STATEMENT:  UPDATE cash_movements SET memo = memo WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:41.265 UTC [30246] ERROR:  permission denied for table cash_movements
@erp/api:test:db: 2026-11-01 00:55:41.265 UTC [30246] STATEMENT:  DELETE FROM cash_movements WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:41.291 UTC [30250] ERROR:  new row violates row-level security policy for table "receipts"
@erp/api:test:db: 2026-11-01 00:55:41.291 UTC [30250] STATEMENT:  INSERT INTO receipts (id, tenant_id, status, cash_account_id, partner_id, method, currency_code, amount, value_date)
@erp/api:test:db: 	     VALUES ('d3d3d3d3-3000-4000-8000-000000000003', $1, 'DRAFT', 'd0d0d0d0-0000-4000-8000-000000000002',
@erp/api:test:db: 	             'b5b5b5b5-0000-4000-8000-000000000002', 'CASH', 'SAR', 10, '2027-02-01')
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:41.304 UTC [30252] ERROR:  permission denied for table receipts
@erp/api:test:db: 2026-11-01 00:55:41.304 UTC [30252] STATEMENT:  DELETE FROM receipts WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:41.330 UTC [30256] ERROR:  new row violates row-level security policy for table "payments"
@erp/api:test:db: 2026-11-01 00:55:41.330 UTC [30256] STATEMENT:  INSERT INTO payments (id, tenant_id, status, cash_account_id, partner_id, method, currency_code, amount, value_date)
@erp/api:test:db: 	     VALUES ('d4d4d4d4-3000-4000-8000-000000000003', $1, 'DRAFT', 'd0d0d0d0-0000-4000-8000-000000000002',
@erp/api:test:db: 	             'b5b5b5b5-0000-4000-8000-000000000002', 'CASH', 'SAR', 10, '2027-02-01')
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:41.342 UTC [30258] ERROR:  permission denied for table payments
@erp/api:test:db: 2026-11-01 00:55:41.342 UTC [30258] STATEMENT:  DELETE FROM payments WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:41.368 UTC [30262] ERROR:  new row violates row-level security policy for table "treasury_allocations"
@erp/api:test:db: 2026-11-01 00:55:41.368 UTC [30262] STATEMENT:  INSERT INTO treasury_allocations (id, tenant_id, receipt_id, open_item_id, amount)
@erp/api:test:db: 	     VALUES ('d5d5d5d5-3000-4000-8000-000000000003', $1, 'd3d3d3d3-0000-4000-8000-000000000002',
@erp/api:test:db: 	             'cececece-0000-4000-8000-000000000002', 5)
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:41.376 UTC [30263] ERROR:  permission denied for table treasury_allocations
@erp/api:test:db: 2026-11-01 00:55:41.376 UTC [30263] STATEMENT:  UPDATE treasury_allocations SET amount = amount WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:41.407 UTC [30268] ERROR:  new row violates row-level security policy for table "expense_categories"
@erp/api:test:db: 2026-11-01 00:55:41.407 UTC [30268] STATEMENT:  INSERT INTO expense_categories (id, tenant_id, code, name, name_ar, account_id)
@erp/api:test:db: 	     VALUES ('d6d6d6d6-3000-4000-8000-000000000003', $1, 'ATK', 'Attack', 'هجوم',
@erp/api:test:db: 	             'b0b0b0b0-0000-4000-8000-000000000002')
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:41.420 UTC [30270] ERROR:  permission denied for table expense_categories
@erp/api:test:db: 2026-11-01 00:55:41.420 UTC [30270] STATEMENT:  DELETE FROM expense_categories WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:41.445 UTC [30274] ERROR:  new row violates row-level security policy for table "expenses"
@erp/api:test:db: 2026-11-01 00:55:41.445 UTC [30274] STATEMENT:  INSERT INTO expenses (id, tenant_id, status, category_id, cash_account_id, payee_name, currency_code, amount, value_date)
@erp/api:test:db: 	     VALUES ('d7d7d7d7-3000-4000-8000-000000000003', $1, 'DRAFT', 'd6d6d6d6-0000-4000-8000-000000000002',
@erp/api:test:db: 	             'd0d0d0d0-0000-4000-8000-000000000002', 'Attack Payee', 'SAR', 10, '2027-02-01')
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:41.458 UTC [30276] ERROR:  permission denied for table expenses
@erp/api:test:db: 2026-11-01 00:55:41.458 UTC [30276] STATEMENT:  DELETE FROM expenses WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:41.484 UTC [30280] ERROR:  new row violates row-level security policy for table "cash_transfers"
@erp/api:test:db: 2026-11-01 00:55:41.484 UTC [30280] STATEMENT:  INSERT INTO cash_transfers (id, tenant_id, status, from_account_id, to_account_id, currency_code, amount, fee_amount, value_date)
@erp/api:test:db: 	     VALUES ('d8d8d8d8-3000-4000-8000-000000000003', $1, 'DRAFT', 'd0d0d0d0-0000-4000-8000-000000000002',
@erp/api:test:db: 	             'd1d1d1d1-0000-4000-8000-000000000002', 'SAR', 10, 0, '2027-02-01')
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:41.496 UTC [30282] ERROR:  permission denied for table cash_transfers
@erp/api:test:db: 2026-11-01 00:55:41.496 UTC [30282] STATEMENT:  DELETE FROM cash_transfers WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:41.522 UTC [30286] ERROR:  new row violates row-level security policy for table "cashier_shifts"
@erp/api:test:db: 2026-11-01 00:55:41.522 UTC [30286] STATEMENT:  INSERT INTO cashier_shifts (id, tenant_id, status, cash_account_id, currency_code, opening_amount)
@erp/api:test:db: 	     VALUES ('d9d9d9d9-3000-4000-8000-000000000003', $1, 'OPEN', 'd0d0d0d0-0000-4000-8000-000000000002',
@erp/api:test:db: 	             'SAR', 10)
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:41.534 UTC [30288] ERROR:  permission denied for table cashier_shifts
@erp/api:test:db: 2026-11-01 00:55:41.534 UTC [30288] STATEMENT:  DELETE FROM cashier_shifts WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:41.560 UTC [30292] ERROR:  new row violates row-level security policy for table "bank_statements"
@erp/api:test:db: 2026-11-01 00:55:41.560 UTC [30292] STATEMENT:  INSERT INTO bank_statements (id, tenant_id, status, cash_account_id, period_start, period_end, file_name, file_hash, adapter_id)
@erp/api:test:db: 	     VALUES ('dadadada-3000-4000-8000-000000000003', $1, 'IMPORTED', 'd1d1d1d1-0000-4000-8000-000000000002',
@erp/api:test:db: 	             '2027-02-01', '2027-02-28', 'attack.csv', repeat('c', 64), 'generic-csv')
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:41.574 UTC [30294] ERROR:  permission denied for table bank_statements
@erp/api:test:db: 2026-11-01 00:55:41.574 UTC [30294] STATEMENT:  DELETE FROM bank_statements WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:41.600 UTC [30298] ERROR:  new row violates row-level security policy for table "bank_statement_lines"
@erp/api:test:db: 2026-11-01 00:55:41.600 UTC [30298] STATEMENT:  INSERT INTO bank_statement_lines (id, tenant_id, bank_statement_id, line_no, line_date, amount)
@erp/api:test:db: 	     VALUES ('dbdbdbdb-3000-4000-8000-000000000003', $1, 'dadadada-0000-4000-8000-000000000002',
@erp/api:test:db: 	             2, '2027-02-05', 25)
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:41.613 UTC [30300] ERROR:  permission denied for table bank_statement_lines
@erp/api:test:db: 2026-11-01 00:55:41.613 UTC [30300] STATEMENT:  DELETE FROM bank_statement_lines WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:41.638 UTC [30304] ERROR:  new row violates row-level security policy for table "tax_codes"
@erp/api:test:db: 2026-11-01 00:55:41.638 UTC [30304] STATEMENT:  INSERT INTO tax_codes (id, tenant_id, code, name, country_code, default_treatment)
@erp/api:test:db: 	     VALUES ('e0e0e0e0-3000-4000-8000-000000000003', $1, 'ATK-INS', 'Attack Insert', 'SA', 'STANDARD_RATED')
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:41.651 UTC [30306] ERROR:  permission denied for table tax_codes
@erp/api:test:db: 2026-11-01 00:55:41.651 UTC [30306] STATEMENT:  DELETE FROM tax_codes WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:41.677 UTC [30310] ERROR:  new row violates row-level security policy for table "tax_registrations"
@erp/api:test:db: 2026-11-01 00:55:41.677 UTC [30310] STATEMENT:  INSERT INTO tax_registrations (id, tenant_id, country_code, status, registration_number, effective_from)
@erp/api:test:db: 	     VALUES ('e1e1e1e1-3000-4000-8000-000000000003', $1, 'SA', 'REGISTERED', '300000000000009', '2026-01-01')
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:41.690 UTC [30312] ERROR:  permission denied for table tax_registrations
@erp/api:test:db: 2026-11-01 00:55:41.690 UTC [30312] STATEMENT:  DELETE FROM tax_registrations WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:41.715 UTC [30316] ERROR:  new row violates row-level security policy for table "tax_pack_bindings"
@erp/api:test:db: 2026-11-01 00:55:41.715 UTC [30316] STATEMENT:  INSERT INTO tax_pack_bindings (id, tenant_id, country_code, pack_version)
@erp/api:test:db: 	     VALUES ('e2e2e2e2-3000-4000-8000-000000000003', $1, 'SA', '1.0.0-baseline')
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:41.728 UTC [30318] ERROR:  permission denied for table tax_pack_bindings
@erp/api:test:db: 2026-11-01 00:55:41.728 UTC [30318] STATEMENT:  DELETE FROM tax_pack_bindings WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:41.753 UTC [30322] ERROR:  new row violates row-level security policy for table "tax_document_summaries"
@erp/api:test:db: 2026-11-01 00:55:41.753 UTC [30322] STATEMENT:  INSERT INTO tax_document_summaries (id, tenant_id, source_type, source_id, document_date,
@erp/api:test:db: 	        country_code, direction, treatment, rate, taxable_base, tax_amount, snapshot, tax_code_id)
@erp/api:test:db: 	     VALUES ('e3e3e3e3-3000-4000-8000-000000000003', $1, 'iso_fixture', $1, '2027-02-01', 'SA',
@erp/api:test:db: 	        'INPUT', 'STANDARD_RATED', 15.0000, 100, 15, '{"treatment":"STANDARD_RATED"}'::jsonb,
@erp/api:test:db: 	        'e0e0e0e0-0000-4000-8000-000000000002')
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:41.759 UTC [30323] ERROR:  permission denied for table tax_document_summaries
@erp/api:test:db: 2026-11-01 00:55:41.759 UTC [30323] STATEMENT:  UPDATE tax_document_summaries SET taxable_base = taxable_base WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:41.765 UTC [30324] ERROR:  permission denied for table tax_document_summaries
@erp/api:test:db: 2026-11-01 00:55:41.765 UTC [30324] STATEMENT:  DELETE FROM tax_document_summaries WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:41.791 UTC [30328] ERROR:  new row violates row-level security policy for table "vat_returns"
@erp/api:test:db: 2026-11-01 00:55:41.791 UTC [30328] STATEMENT:  INSERT INTO vat_returns (id, tenant_id, country_code, period_start, period_end, summary, cross_check)
@erp/api:test:db: 	     VALUES ('e4e4e4e4-3000-4000-8000-000000000003', $1, 'SA', '2027-02-01', '2027-02-28', '{}'::jsonb, '{}'::jsonb)
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:41.804 UTC [30330] ERROR:  permission denied for table vat_returns
@erp/api:test:db: 2026-11-01 00:55:41.804 UTC [30330] STATEMENT:  DELETE FROM vat_returns WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:41.830 UTC [30334] ERROR:  new row violates row-level security policy for table "e_invoicing_submissions"
@erp/api:test:db: 2026-11-01 00:55:41.830 UTC [30334] STATEMENT:  INSERT INTO e_invoicing_submissions (id, tenant_id, country_code, adapter_id, source_type, source_id, status)
@erp/api:test:db: 	     VALUES ('e5e5e5e5-3000-4000-8000-000000000003', $1, 'SA', 'fake', 'iso_fixture', $1, 'PENDING')
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:41.842 UTC [30336] ERROR:  permission denied for table e_invoicing_submissions
@erp/api:test:db: 2026-11-01 00:55:41.842 UTC [30336] STATEMENT:  DELETE FROM e_invoicing_submissions WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:41.868 UTC [30340] ERROR:  new row violates row-level security policy for table "warehouses"
@erp/api:test:db: 2026-11-01 00:55:41.868 UTC [30340] STATEMENT:  INSERT INTO warehouses (id, tenant_id, branch_id, code, name)
@erp/api:test:db: 	     VALUES ('f0f0f0f0-3000-4000-8000-000000000003', $1,
@erp/api:test:db: 	             'abababab-0000-4000-8000-000000000002', 'ATK', 'Attack WH')
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:41.882 UTC [30342] ERROR:  permission denied for table warehouses
@erp/api:test:db: 2026-11-01 00:55:41.882 UTC [30342] STATEMENT:  DELETE FROM warehouses WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:41.908 UTC [30346] ERROR:  new row violates row-level security policy for table "item_warehouse_settings"
@erp/api:test:db: 2026-11-01 00:55:41.908 UTC [30346] STATEMENT:  INSERT INTO item_warehouse_settings (id, tenant_id, item_id, warehouse_id, reorder_level, min_qty)
@erp/api:test:db: 	     VALUES ('f1f1f1f1-3000-4000-8000-000000000003', $1, 'babababa-0000-4000-8000-000000000002',
@erp/api:test:db: 	             'f0f0f0f0-2000-4000-8000-000000000002', 5, 2)
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:41.921 UTC [30348] ERROR:  permission denied for table item_warehouse_settings
@erp/api:test:db: 2026-11-01 00:55:41.921 UTC [30348] STATEMENT:  DELETE FROM item_warehouse_settings WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:41.947 UTC [30352] ERROR:  new row violates row-level security policy for table "stock_moves"
@erp/api:test:db: 2026-11-01 00:55:41.947 UTC [30352] STATEMENT:  INSERT INTO stock_moves (id, tenant_id, item_id, warehouse_id, direction, move_kind, qty, unit_cost, value_amount, source_type, source_id, moved_at)
@erp/api:test:db: 	     VALUES ('f4f4f4f4-3000-4000-8000-000000000003', $1, 'babababa-0000-4000-8000-000000000002',
@erp/api:test:db: 	             'f0f0f0f0-2000-4000-8000-000000000002', 'IN', 'receipt', 10, 2.5, 25,
@erp/api:test:db: 	             'manual_receipt', 'f4f4f4f4-3000-4000-8000-000000000003', '2027-01-05')
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:41.954 UTC [30353] ERROR:  permission denied for table stock_moves
@erp/api:test:db: 2026-11-01 00:55:41.954 UTC [30353] STATEMENT:  UPDATE stock_moves SET memo = memo WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:41.961 UTC [30354] ERROR:  permission denied for table stock_moves
@erp/api:test:db: 2026-11-01 00:55:41.961 UTC [30354] STATEMENT:  DELETE FROM stock_moves WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:41.987 UTC [30358] ERROR:  new row violates row-level security policy for table "stock_layers"
@erp/api:test:db: 2026-11-01 00:55:41.987 UTC [30358] STATEMENT:  INSERT INTO stock_layers (id, tenant_id, item_id, warehouse_id, remaining_qty, unit_cost, source_move_id, received_at)
@erp/api:test:db: 	     VALUES ('f5f5f5f5-3000-4000-8000-000000000003', $1, 'babababa-0000-4000-8000-000000000002',
@erp/api:test:db: 	             'f0f0f0f0-2000-4000-8000-000000000002', 10, 2.5,
@erp/api:test:db: 	             'f4f4f4f4-3000-4000-8000-000000000003', '2027-01-05')
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:42.000 UTC [30360] ERROR:  permission denied for table stock_layers
@erp/api:test:db: 2026-11-01 00:55:42.000 UTC [30360] STATEMENT:  DELETE FROM stock_layers WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:42.026 UTC [30364] ERROR:  new row violates row-level security policy for table "item_stock"
@erp/api:test:db: 2026-11-01 00:55:42.026 UTC [30364] STATEMENT:  INSERT INTO item_stock (id, tenant_id, item_id, warehouse_id, qty, avg_cost)
@erp/api:test:db: 	     VALUES ('f6f6f6f6-3000-4000-8000-000000000003', $1, 'babababa-0000-4000-8000-000000000002',
@erp/api:test:db: 	             'f0f0f0f0-2000-4000-8000-000000000002', 10, 2.5)
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:42.039 UTC [30366] ERROR:  permission denied for table item_stock
@erp/api:test:db: 2026-11-01 00:55:42.039 UTC [30366] STATEMENT:  DELETE FROM item_stock WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:42.065 UTC [30370] ERROR:  new row violates row-level security policy for table "stock_transfers"
@erp/api:test:db: 2026-11-01 00:55:42.065 UTC [30370] STATEMENT:  INSERT INTO stock_transfers (id, tenant_id, from_warehouse_id, to_warehouse_id, status)
@erp/api:test:db: 	     VALUES ('f7f7f7f7-3000-4000-8000-000000000003', $1, 'f0f0f0f0-1000-4000-8000-000000000002',
@erp/api:test:db: 	             'f0f0f0f0-2000-4000-8000-000000000002', 'DRAFT')
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:42.078 UTC [30372] ERROR:  permission denied for table stock_transfers
@erp/api:test:db: 2026-11-01 00:55:42.078 UTC [30372] STATEMENT:  DELETE FROM stock_transfers WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:42.104 UTC [30376] ERROR:  new row violates row-level security policy for table "stock_transfer_lines"
@erp/api:test:db: 2026-11-01 00:55:42.104 UTC [30376] STATEMENT:  INSERT INTO stock_transfer_lines (id, tenant_id, transfer_id, line_no, item_id, qty)
@erp/api:test:db: 	     VALUES ('f8f8f8f8-3000-4000-8000-000000000003', $1, 'f7f7f7f7-0000-4000-8000-000000000002', 2,
@erp/api:test:db: 	             'babababa-0000-4000-8000-000000000002', 4)
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:42.116 UTC [30378] ERROR:  permission denied for table stock_transfer_lines
@erp/api:test:db: 2026-11-01 00:55:42.116 UTC [30378] STATEMENT:  DELETE FROM stock_transfer_lines WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:42.142 UTC [30382] ERROR:  new row violates row-level security policy for table "stock_adjustments"
@erp/api:test:db: 2026-11-01 00:55:42.142 UTC [30382] STATEMENT:  INSERT INTO stock_adjustments (id, tenant_id, warehouse_id, item_id, reason, delta_qty)
@erp/api:test:db: 	     VALUES ('f9f9f9f9-3000-4000-8000-000000000003', $1, 'f0f0f0f0-2000-4000-8000-000000000002',
@erp/api:test:db: 	             'babababa-0000-4000-8000-000000000002', 'DAMAGE', -1)
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:42.155 UTC [30384] ERROR:  permission denied for table stock_adjustments
@erp/api:test:db: 2026-11-01 00:55:42.155 UTC [30384] STATEMENT:  DELETE FROM stock_adjustments WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:42.181 UTC [30388] ERROR:  new row violates row-level security policy for table "stock_reservations"
@erp/api:test:db: 2026-11-01 00:55:42.181 UTC [30388] STATEMENT:  INSERT INTO stock_reservations (id, tenant_id, item_id, warehouse_id, qty, holder_type)
@erp/api:test:db: 	     VALUES ('fafafafa-3000-4000-8000-000000000003', $1, 'babababa-0000-4000-8000-000000000002',
@erp/api:test:db: 	             'f0f0f0f0-2000-4000-8000-000000000002', 2, 'MANUAL')
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:42.193 UTC [30390] ERROR:  permission denied for table stock_reservations
@erp/api:test:db: 2026-11-01 00:55:42.193 UTC [30390] STATEMENT:  DELETE FROM stock_reservations WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:42.219 UTC [30394] ERROR:  new row violates row-level security policy for table "item_batches"
@erp/api:test:db: 2026-11-01 00:55:42.219 UTC [30394] STATEMENT:  INSERT INTO item_batches (id, tenant_id, item_id, batch_no)
@erp/api:test:db: 	     VALUES ('f2f2f2f2-3000-4000-8000-000000000003', $1, 'babababa-0000-4000-8000-000000000002', 'ATK-B')
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:42.232 UTC [30396] ERROR:  permission denied for table item_batches
@erp/api:test:db: 2026-11-01 00:55:42.232 UTC [30396] STATEMENT:  DELETE FROM item_batches WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:42.259 UTC [30400] ERROR:  new row violates row-level security policy for table "item_serials"
@erp/api:test:db: 2026-11-01 00:55:42.259 UTC [30400] STATEMENT:  INSERT INTO item_serials (id, tenant_id, item_id, serial_no)
@erp/api:test:db: 	     VALUES ('f3f3f3f3-3000-4000-8000-000000000003', $1, 'babababa-0000-4000-8000-000000000002', 'ATK-SN')
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:42.273 UTC [30402] ERROR:  permission denied for table item_serials
@erp/api:test:db: 2026-11-01 00:55:42.273 UTC [30402] STATEMENT:  DELETE FROM item_serials WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:42.299 UTC [30406] ERROR:  new row violates row-level security policy for table "stock_counts"
@erp/api:test:db: 2026-11-01 00:55:42.299 UTC [30406] STATEMENT:  INSERT INTO stock_counts (id, tenant_id, warehouse_id, status, snapshot_at)
@erp/api:test:db: 	     VALUES ('fbfbfbfb-3000-4000-8000-000000000003', $1, 'f0f0f0f0-2000-4000-8000-000000000002',
@erp/api:test:db: 	             'DRAFT', '2027-01-10T09:00:00Z')
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:42.313 UTC [30408] ERROR:  permission denied for table stock_counts
@erp/api:test:db: 2026-11-01 00:55:42.313 UTC [30408] STATEMENT:  DELETE FROM stock_counts WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:42.341 UTC [30412] ERROR:  new row violates row-level security policy for table "stock_count_lines"
@erp/api:test:db: 2026-11-01 00:55:42.341 UTC [30412] STATEMENT:  INSERT INTO stock_count_lines (id, tenant_id, stock_count_id, line_no, item_id, batch_id, system_qty)
@erp/api:test:db: 	     VALUES ('fcfcfcfc-3000-4000-8000-000000000003', $1, 'fbfbfbfb-0000-4000-8000-000000000002', 2,
@erp/api:test:db: 	             'babababa-0000-4000-8000-000000000002', 'f2f2f2f2-0000-4000-8000-000000000002', 10)
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:42.354 UTC [30414] ERROR:  permission denied for table stock_count_lines
@erp/api:test:db: 2026-11-01 00:55:42.354 UTC [30414] STATEMENT:  DELETE FROM stock_count_lines WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:42.380 UTC [30418] ERROR:  new row violates row-level security policy for table "purchase_requests"
@erp/api:test:db: 2026-11-01 00:55:42.380 UTC [30418] STATEMENT:  INSERT INTO purchase_requests (id, tenant_id, branch_id, status)
@erp/api:test:db: 	     VALUES ('5a5a5a5a-3000-4000-8000-000000000003', $1, 'abababab-0000-4000-8000-000000000002', 'DRAFT')
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:42.397 UTC [30420] ERROR:  permission denied for table purchase_requests
@erp/api:test:db: 2026-11-01 00:55:42.397 UTC [30420] STATEMENT:  DELETE FROM purchase_requests WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:42.431 UTC [30424] ERROR:  new row violates row-level security policy for table "purchase_request_lines"
@erp/api:test:db: 2026-11-01 00:55:42.431 UTC [30424] STATEMENT:  INSERT INTO purchase_request_lines (id, tenant_id, request_id, line_no, item_id, qty)
@erp/api:test:db: 	     VALUES ('5b5b5b5b-3000-4000-8000-000000000003', $1, '5a5a5a5a-0000-4000-8000-000000000002', 2,
@erp/api:test:db: 	             'babababa-0000-4000-8000-000000000002', 5)
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:42.445 UTC [30426] ERROR:  permission denied for table purchase_request_lines
@erp/api:test:db: 2026-11-01 00:55:42.445 UTC [30426] STATEMENT:  DELETE FROM purchase_request_lines WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:42.471 UTC [30430] ERROR:  new row violates row-level security policy for table "purchase_orders"
@erp/api:test:db: 2026-11-01 00:55:42.471 UTC [30430] STATEMENT:  INSERT INTO purchase_orders (id, tenant_id, branch_id, supplier_id, order_date, currency_code, status)
@erp/api:test:db: 	     VALUES ('5c5c5c5c-3000-4000-8000-000000000003', $1, 'abababab-0000-4000-8000-000000000002',
@erp/api:test:db: 	             'b5b5b5b5-0000-4000-8000-000000000002', '2027-02-01', 'SAR', 'DRAFT')
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:42.484 UTC [30432] ERROR:  permission denied for table purchase_orders
@erp/api:test:db: 2026-11-01 00:55:42.484 UTC [30432] STATEMENT:  DELETE FROM purchase_orders WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:42.512 UTC [30436] ERROR:  new row violates row-level security policy for table "purchase_order_lines"
@erp/api:test:db: 2026-11-01 00:55:42.512 UTC [30436] STATEMENT:  INSERT INTO purchase_order_lines (id, tenant_id, order_id, line_no, item_id, qty, unit_price, net_amount)
@erp/api:test:db: 	     VALUES ('5d5d5d5d-3000-4000-8000-000000000003', $1, '5c5c5c5c-0000-4000-8000-000000000002', 2,
@erp/api:test:db: 	             'babababa-0000-4000-8000-000000000002', 5, 2.5, 12.5)
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:42.524 UTC [30438] ERROR:  permission denied for table purchase_order_lines
@erp/api:test:db: 2026-11-01 00:55:42.524 UTC [30438] STATEMENT:  DELETE FROM purchase_order_lines WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:42.550 UTC [30442] ERROR:  new row violates row-level security policy for table "goods_receipts"
@erp/api:test:db: 2026-11-01 00:55:42.550 UTC [30442] STATEMENT:  INSERT INTO goods_receipts (id, tenant_id, branch_id, supplier_id, po_id, warehouse_id, receipt_date, status)
@erp/api:test:db: 	     VALUES ('5e5e5e5e-3000-4000-8000-000000000003', $1, 'abababab-0000-4000-8000-000000000002',
@erp/api:test:db: 	             'b5b5b5b5-0000-4000-8000-000000000002', '5c5c5c5c-0000-4000-8000-000000000002',
@erp/api:test:db: 	             'f0f0f0f0-2000-4000-8000-000000000002', '2027-02-05', 'DRAFT')
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:42.563 UTC [30444] ERROR:  permission denied for table goods_receipts
@erp/api:test:db: 2026-11-01 00:55:42.563 UTC [30444] STATEMENT:  DELETE FROM goods_receipts WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:42.589 UTC [30448] ERROR:  new row violates row-level security policy for table "goods_receipt_lines"
@erp/api:test:db: 2026-11-01 00:55:42.589 UTC [30448] STATEMENT:  INSERT INTO goods_receipt_lines (id, tenant_id, receipt_id, line_no, item_id, qty, unit_cost, value_amount)
@erp/api:test:db: 	     VALUES ('5f5f5f5f-3000-4000-8000-000000000003', $1, '5e5e5e5e-0000-4000-8000-000000000002', 2,
@erp/api:test:db: 	             'babababa-0000-4000-8000-000000000002', 5, 2.5, 12.5)
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:42.602 UTC [30450] ERROR:  permission denied for table goods_receipt_lines
@erp/api:test:db: 2026-11-01 00:55:42.602 UTC [30450] STATEMENT:  DELETE FROM goods_receipt_lines WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:42.629 UTC [30454] ERROR:  new row violates row-level security policy for table "supplier_invoices"
@erp/api:test:db: 2026-11-01 00:55:42.629 UTC [30454] STATEMENT:  INSERT INTO supplier_invoices (id, tenant_id, branch_id, supplier_id, invoice_no, invoice_date, due_date, currency_code, status)
@erp/api:test:db: 	     VALUES ('60606060-3000-4000-8000-000000000003', $1, 'abababab-0000-4000-8000-000000000002',
@erp/api:test:db: 	             'b5b5b5b5-0000-4000-8000-000000000002', 'ATK-001', '2027-02-10', '2027-03-12', 'SAR', 'DRAFT')
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:42.643 UTC [30456] ERROR:  permission denied for table supplier_invoices
@erp/api:test:db: 2026-11-01 00:55:42.643 UTC [30456] STATEMENT:  DELETE FROM supplier_invoices WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:42.669 UTC [30460] ERROR:  new row violates row-level security policy for table "supplier_invoice_lines"
@erp/api:test:db: 2026-11-01 00:55:42.669 UTC [30460] STATEMENT:  INSERT INTO supplier_invoice_lines (id, tenant_id, invoice_id, line_no, item_id, qty, unit_price, net_amount)
@erp/api:test:db: 	     VALUES ('61616161-3000-4000-8000-000000000003', $1, '60606060-0000-4000-8000-000000000002', 2,
@erp/api:test:db: 	             'babababa-0000-4000-8000-000000000002', 5, 2.5, 12.5)
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:42.682 UTC [30462] ERROR:  permission denied for table supplier_invoice_lines
@erp/api:test:db: 2026-11-01 00:55:42.682 UTC [30462] STATEMENT:  DELETE FROM supplier_invoice_lines WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:42.707 UTC [30466] ERROR:  new row violates row-level security policy for table "debit_notes"
@erp/api:test:db: 2026-11-01 00:55:42.707 UTC [30466] STATEMENT:  INSERT INTO debit_notes (id, tenant_id, branch_id, supplier_id, ref_invoice_id, note_date, currency_code, status)
@erp/api:test:db: 	     VALUES ('62626262-3000-4000-8000-000000000003', $1, 'abababab-0000-4000-8000-000000000002',
@erp/api:test:db: 	             'b5b5b5b5-0000-4000-8000-000000000002', '60606060-0000-4000-8000-000000000002', '2027-02-15', 'SAR', 'DRAFT')
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:42.721 UTC [30468] ERROR:  permission denied for table debit_notes
@erp/api:test:db: 2026-11-01 00:55:42.721 UTC [30468] STATEMENT:  DELETE FROM debit_notes WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:42.746 UTC [30472] ERROR:  new row violates row-level security policy for table "debit_note_lines"
@erp/api:test:db: 2026-11-01 00:55:42.746 UTC [30472] STATEMENT:  INSERT INTO debit_note_lines (id, tenant_id, note_id, line_no, item_id, qty, unit_price, net_amount)
@erp/api:test:db: 	     VALUES ('63636363-3000-4000-8000-000000000003', $1, '62626262-0000-4000-8000-000000000002', 2,
@erp/api:test:db: 	             'babababa-0000-4000-8000-000000000002', 1, 1, 1)
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:42.759 UTC [30474] ERROR:  permission denied for table debit_note_lines
@erp/api:test:db: 2026-11-01 00:55:42.759 UTC [30474] STATEMENT:  DELETE FROM debit_note_lines WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:42.784 UTC [30478] ERROR:  new row violates row-level security policy for table "landed_costs"
@erp/api:test:db: 2026-11-01 00:55:42.784 UTC [30478] STATEMENT:  INSERT INTO landed_costs (id, tenant_id, grn_id, cost_type, amount, allocation_method, charge_account_id, status)
@erp/api:test:db: 	     VALUES ('64646464-3000-4000-8000-000000000003', $1, '5e5e5e5e-0000-4000-8000-000000000002',
@erp/api:test:db: 	             'freight', 2, 'VALUE', 'b0b0b0b0-0000-4000-8000-000000000002', 'DRAFT')
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:42.797 UTC [30480] ERROR:  permission denied for table landed_costs
@erp/api:test:db: 2026-11-01 00:55:42.797 UTC [30480] STATEMENT:  DELETE FROM landed_costs WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:42.824 UTC [30484] ERROR:  new row violates row-level security policy for table "landed_cost_allocations"
@erp/api:test:db: 2026-11-01 00:55:42.824 UTC [30484] STATEMENT:  INSERT INTO landed_cost_allocations (id, tenant_id, landed_cost_id, grn_line_id, item_id, warehouse_id, qty_at_allocation, remaining_qty, allocated_amount)
@erp/api:test:db: 	     VALUES ('65656565-3000-4000-8000-000000000003', $1, '64646464-0000-4000-8000-000000000002',
@erp/api:test:db: 	             '5f5f5f5f-0000-4000-8000-000000000002', 'babababa-0000-4000-8000-000000000002',
@erp/api:test:db: 	             'f0f0f0f0-2000-4000-8000-000000000002', 5, 5, 2)
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:42.836 UTC [30486] ERROR:  permission denied for table landed_cost_allocations
@erp/api:test:db: 2026-11-01 00:55:42.836 UTC [30486] STATEMENT:  DELETE FROM landed_cost_allocations WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:42.862 UTC [30490] ERROR:  new row violates row-level security policy for table "purchase_reallocations"
@erp/api:test:db: 2026-11-01 00:55:42.862 UTC [30490] STATEMENT:  INSERT INTO purchase_reallocations (id, tenant_id, doc_no, payment_id, supplier_id, reason, total_amount)
@erp/api:test:db: 	     VALUES ('66666666-3000-4000-8000-000000000003', $1, 'RAL-ATK-1', 'd4d4d4d4-0000-4000-8000-000000000002',
@erp/api:test:db: 	             'b5b5b5b5-0000-4000-8000-000000000002', 'attack re-allocation', 1)
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:42.869 UTC [30491] ERROR:  permission denied for table purchase_reallocations
@erp/api:test:db: 2026-11-01 00:55:42.869 UTC [30491] STATEMENT:  UPDATE purchase_reallocations SET reason = reason WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:42.875 UTC [30492] ERROR:  permission denied for table purchase_reallocations
@erp/api:test:db: 2026-11-01 00:55:42.875 UTC [30492] STATEMENT:  DELETE FROM purchase_reallocations WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:42.899 UTC [30496] ERROR:  new row violates row-level security policy for table "purchase_reallocation_lines"
@erp/api:test:db: 2026-11-01 00:55:42.899 UTC [30496] STATEMENT:  INSERT INTO purchase_reallocation_lines (id, tenant_id, reallocation_id, line_no, to_open_item_id, amount)
@erp/api:test:db: 	     VALUES ('67676767-3000-4000-8000-000000000003', $1, '66666666-0000-4000-8000-000000000002', 2,
@erp/api:test:db: 	             'cececece-0000-4000-8000-000000000002', 1)
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:42.906 UTC [30497] ERROR:  permission denied for table purchase_reallocation_lines
@erp/api:test:db: 2026-11-01 00:55:42.906 UTC [30497] STATEMENT:  UPDATE purchase_reallocation_lines SET amount = amount WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:42.914 UTC [30498] ERROR:  permission denied for table purchase_reallocation_lines
@erp/api:test:db: 2026-11-01 00:55:42.914 UTC [30498] STATEMENT:  DELETE FROM purchase_reallocation_lines WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:42.947 UTC [30502] ERROR:  new row violates row-level security policy for table "sales_reps"
@erp/api:test:db: 2026-11-01 00:55:42.947 UTC [30502] STATEMENT:  INSERT INTO sales_reps (id, tenant_id, code, name, status)
@erp/api:test:db: 	     VALUES ('70707070-3000-4000-8000-000000000003', $1, 'ATK-REP', 'Attack Rep', 'ACTIVE')
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:42.965 UTC [30504] ERROR:  permission denied for table sales_reps
@erp/api:test:db: 2026-11-01 00:55:42.965 UTC [30504] STATEMENT:  DELETE FROM sales_reps WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:42.991 UTC [30508] ERROR:  new row violates row-level security policy for table "quotations"
@erp/api:test:db: 2026-11-01 00:55:42.991 UTC [30508] STATEMENT:  INSERT INTO quotations (id, tenant_id, branch_id, customer_id, quote_date, valid_until, currency_code, status)
@erp/api:test:db: 	     VALUES ('71717171-3000-4000-8000-000000000003', $1, 'abababab-0000-4000-8000-000000000002',
@erp/api:test:db: 	             'b5b5b5b5-0000-4000-8000-000000000002', '2027-02-01', '2027-03-03', 'SAR', 'DRAFT')
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:43.003 UTC [30510] ERROR:  permission denied for table quotations
@erp/api:test:db: 2026-11-01 00:55:43.003 UTC [30510] STATEMENT:  DELETE FROM quotations WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:43.028 UTC [30514] ERROR:  new row violates row-level security policy for table "quotation_lines"
@erp/api:test:db: 2026-11-01 00:55:43.028 UTC [30514] STATEMENT:  INSERT INTO quotation_lines (id, tenant_id, quotation_id, line_no, item_id, qty, unit_price, net_amount)
@erp/api:test:db: 	     VALUES ('72727272-3000-4000-8000-000000000003', $1, '71717171-0000-4000-8000-000000000002', 2,
@erp/api:test:db: 	             'babababa-0000-4000-8000-000000000002', 5, 2.5, 12.5)
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:43.041 UTC [30516] ERROR:  permission denied for table quotation_lines
@erp/api:test:db: 2026-11-01 00:55:43.041 UTC [30516] STATEMENT:  DELETE FROM quotation_lines WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:43.067 UTC [30520] ERROR:  new row violates row-level security policy for table "sales_orders"
@erp/api:test:db: 2026-11-01 00:55:43.067 UTC [30520] STATEMENT:  INSERT INTO sales_orders (id, tenant_id, branch_id, customer_id, warehouse_id, order_date, currency_code, status)
@erp/api:test:db: 	     VALUES ('73737373-3000-4000-8000-000000000003', $1, 'abababab-0000-4000-8000-000000000002',
@erp/api:test:db: 	             'b5b5b5b5-0000-4000-8000-000000000002', 'f0f0f0f0-1000-4000-8000-000000000002',
@erp/api:test:db: 	             '2027-02-02', 'SAR', 'DRAFT')
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:43.080 UTC [30522] ERROR:  permission denied for table sales_orders
@erp/api:test:db: 2026-11-01 00:55:43.080 UTC [30522] STATEMENT:  DELETE FROM sales_orders WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:43.105 UTC [30526] ERROR:  new row violates row-level security policy for table "sales_order_lines"
@erp/api:test:db: 2026-11-01 00:55:43.105 UTC [30526] STATEMENT:  INSERT INTO sales_order_lines (id, tenant_id, order_id, line_no, item_id, qty, unit_price, net_amount)
@erp/api:test:db: 	     VALUES ('74747474-3000-4000-8000-000000000003', $1, '73737373-0000-4000-8000-000000000002', 2,
@erp/api:test:db: 	             'babababa-0000-4000-8000-000000000002', 5, 2.5, 12.5)
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:43.118 UTC [30528] ERROR:  permission denied for table sales_order_lines
@erp/api:test:db: 2026-11-01 00:55:43.118 UTC [30528] STATEMENT:  DELETE FROM sales_order_lines WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:43.144 UTC [30532] ERROR:  new row violates row-level security policy for table "delivery_notes"
@erp/api:test:db: 2026-11-01 00:55:43.144 UTC [30532] STATEMENT:  INSERT INTO delivery_notes (id, tenant_id, branch_id, customer_id, warehouse_id, delivery_date, currency_code, status)
@erp/api:test:db: 	     VALUES ('75757575-3000-4000-8000-000000000003', $1, 'abababab-0000-4000-8000-000000000002',
@erp/api:test:db: 	             'b5b5b5b5-0000-4000-8000-000000000002', 'f0f0f0f0-1000-4000-8000-000000000002',
@erp/api:test:db: 	             '2027-02-05', 'SAR', 'DRAFT')
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:43.157 UTC [30534] ERROR:  permission denied for table delivery_notes
@erp/api:test:db: 2026-11-01 00:55:43.157 UTC [30534] STATEMENT:  DELETE FROM delivery_notes WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:43.183 UTC [30538] ERROR:  new row violates row-level security policy for table "delivery_note_lines"
@erp/api:test:db: 2026-11-01 00:55:43.183 UTC [30538] STATEMENT:  INSERT INTO delivery_note_lines (id, tenant_id, delivery_id, line_no, item_id, qty, unit_price, net_amount)
@erp/api:test:db: 	     VALUES ('76767676-3000-4000-8000-000000000003', $1, '75757575-0000-4000-8000-000000000002', 2,
@erp/api:test:db: 	             'babababa-0000-4000-8000-000000000002', 5, 2.5, 12.5)
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:43.196 UTC [30540] ERROR:  permission denied for table delivery_note_lines
@erp/api:test:db: 2026-11-01 00:55:43.196 UTC [30540] STATEMENT:  DELETE FROM delivery_note_lines WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:43.222 UTC [30544] ERROR:  new row violates row-level security policy for table "sales_invoices"
@erp/api:test:db: 2026-11-01 00:55:43.222 UTC [30544] STATEMENT:  INSERT INTO sales_invoices (id, tenant_id, branch_id, customer_id, kind, invoice_date, due_date, currency_code, status)
@erp/api:test:db: 	     VALUES ('77777777-3000-4000-8000-000000000003', $1, 'abababab-0000-4000-8000-000000000002',
@erp/api:test:db: 	             'b5b5b5b5-0000-4000-8000-000000000002', 'CREDIT', '2027-02-10', '2027-03-12', 'SAR', 'DRAFT')
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:43.238 UTC [30546] ERROR:  permission denied for table sales_invoices
@erp/api:test:db: 2026-11-01 00:55:43.238 UTC [30546] STATEMENT:  DELETE FROM sales_invoices WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:43.265 UTC [30550] ERROR:  new row violates row-level security policy for table "sales_invoice_lines"
@erp/api:test:db: 2026-11-01 00:55:43.265 UTC [30550] STATEMENT:  INSERT INTO sales_invoice_lines (id, tenant_id, invoice_id, line_no, item_id, qty, unit_price, net_amount)
@erp/api:test:db: 	     VALUES ('78787878-3000-4000-8000-000000000003', $1, '77777777-0000-4000-8000-000000000002', 2,
@erp/api:test:db: 	             'babababa-0000-4000-8000-000000000002', 5, 2.5, 12.5)
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:43.279 UTC [30552] ERROR:  permission denied for table sales_invoice_lines
@erp/api:test:db: 2026-11-01 00:55:43.279 UTC [30552] STATEMENT:  DELETE FROM sales_invoice_lines WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:43.308 UTC [30556] ERROR:  new row violates row-level security policy for table "credit_notes"
@erp/api:test:db: 2026-11-01 00:55:43.308 UTC [30556] STATEMENT:  INSERT INTO credit_notes (id, tenant_id, branch_id, customer_id, invoice_id, note_date, currency_code, status)
@erp/api:test:db: 	     VALUES ('79797979-3000-4000-8000-000000000003', $1, 'abababab-0000-4000-8000-000000000002',
@erp/api:test:db: 	             'b5b5b5b5-0000-4000-8000-000000000002', '77777777-0000-4000-8000-000000000002',
@erp/api:test:db: 	             '2027-02-15', 'SAR', 'DRAFT')
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:43.321 UTC [30558] ERROR:  permission denied for table credit_notes
@erp/api:test:db: 2026-11-01 00:55:43.321 UTC [30558] STATEMENT:  DELETE FROM credit_notes WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:43.347 UTC [30562] ERROR:  new row violates row-level security policy for table "credit_note_lines"
@erp/api:test:db: 2026-11-01 00:55:43.347 UTC [30562] STATEMENT:  INSERT INTO credit_note_lines (id, tenant_id, note_id, line_no, invoice_line_id, item_id, qty, unit_price, net_amount)
@erp/api:test:db: 	     VALUES ('7a7a7a7a-3000-4000-8000-000000000003', $1, '79797979-0000-4000-8000-000000000002', 2,
@erp/api:test:db: 	             '78787878-0000-4000-8000-000000000002', 'babababa-0000-4000-8000-000000000002', 1, 1, 1)
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:43.369 UTC [30564] ERROR:  permission denied for table credit_note_lines
@erp/api:test:db: 2026-11-01 00:55:43.369 UTC [30564] STATEMENT:  DELETE FROM credit_note_lines WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:43.394 UTC [30568] ERROR:  new row violates row-level security policy for table "sales_reallocations"
@erp/api:test:db: 2026-11-01 00:55:43.394 UTC [30568] STATEMENT:  INSERT INTO sales_reallocations (id, tenant_id, doc_no, receipt_id, customer_id, reason, total_amount)
@erp/api:test:db: 	     VALUES ('7b7b7b7b-3000-4000-8000-000000000003', $1, 'SRAL-ATK-1', 'd3d3d3d3-0000-4000-8000-000000000002',
@erp/api:test:db: 	             'b5b5b5b5-0000-4000-8000-000000000002', 'attack sales re-allocation', 1)
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:43.401 UTC [30569] ERROR:  permission denied for table sales_reallocations
@erp/api:test:db: 2026-11-01 00:55:43.401 UTC [30569] STATEMENT:  UPDATE sales_reallocations SET reason = reason WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:43.408 UTC [30570] ERROR:  permission denied for table sales_reallocations
@erp/api:test:db: 2026-11-01 00:55:43.408 UTC [30570] STATEMENT:  DELETE FROM sales_reallocations WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:43.433 UTC [30574] ERROR:  new row violates row-level security policy for table "sales_reallocation_lines"
@erp/api:test:db: 2026-11-01 00:55:43.433 UTC [30574] STATEMENT:  INSERT INTO sales_reallocation_lines (id, tenant_id, reallocation_id, line_no, to_open_item_id, amount)
@erp/api:test:db: 	     VALUES ('7c7c7c7c-3000-4000-8000-000000000003', $1, '7b7b7b7b-0000-4000-8000-000000000002', 2,
@erp/api:test:db: 	             'cececece-0000-4000-8000-000000000002', 1)
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:43.440 UTC [30575] ERROR:  permission denied for table sales_reallocation_lines
@erp/api:test:db: 2026-11-01 00:55:43.440 UTC [30575] STATEMENT:  UPDATE sales_reallocation_lines SET amount = amount WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:43.446 UTC [30576] ERROR:  permission denied for table sales_reallocation_lines
@erp/api:test:db: 2026-11-01 00:55:43.446 UTC [30576] STATEMENT:  DELETE FROM sales_reallocation_lines WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:43.472 UTC [30580] ERROR:  new row violates row-level security policy for table "report_runs"
@erp/api:test:db: 2026-11-01 00:55:43.472 UTC [30580] STATEMENT:  INSERT INTO report_runs (id, tenant_id, report_key, contract_version, params,
@erp/api:test:db: 	                                      params_hash, execution_class, status)
@erp/api:test:db: 	     VALUES ('7d7d7d7d-3000-4000-8000-000000000003', $1, 'financial.trial-balance', 1,
@erp/api:test:db: 	             '{"locale": "ar"}'::jsonb, 'iso-attack', 'inline', 'QUEUED')
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:43.485 UTC [30582] ERROR:  permission denied for table report_runs
@erp/api:test:db: 2026-11-01 00:55:43.485 UTC [30582] STATEMENT:  DELETE FROM report_runs WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:43.510 UTC [30586] ERROR:  new row violates row-level security policy for table "print_templates"
@erp/api:test:db: 2026-11-01 00:55:43.510 UTC [30586] STATEMENT:  INSERT INTO print_templates (id, tenant_id, key, version, locale_variants)
@erp/api:test:db: 	     VALUES ('7e7e7e7e-3000-4000-8000-000000000003', $1, 'receipt-58', 1, '{"ar": 1}'::jsonb)
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:43.523 UTC [30588] ERROR:  permission denied for table print_templates
@erp/api:test:db: 2026-11-01 00:55:43.523 UTC [30588] STATEMENT:  DELETE FROM print_templates WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:43.537 UTC [30590] ERROR:  new row violates row-level security policy for table "roles"
@erp/api:test:db: 2026-11-01 00:55:43.537 UTC [30590] STATEMENT:  INSERT INTO roles (id, tenant_id, key, name, is_system)
@erp/api:test:db: 	       VALUES ('dddddddd-9999-4999-8999-999999999999', NULL, 'forged', 'Forged', true)
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:43.538 UTC [30590] ERROR:  new row violates row-level security policy for table "roles"
@erp/api:test:db: 2026-11-01 00:55:43.538 UTC [30590] STATEMENT:  UPDATE roles SET name = 'HACKED' WHERE tenant_id IS NULL AND key = 'owner'
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:43.551 UTC [30592] ERROR:  new row violates row-level security policy for table "roles"
@erp/api:test:db: 2026-11-01 00:55:43.551 UTC [30592] STATEMENT:  INSERT INTO roles (id, tenant_id, key, name, is_system)
@erp/api:test:db: 	         VALUES ('dddddddd-7777-4777-8777-777777777777', $1, 'tenant_probe', 'Tenant Probe', false)
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:55:43.558 UTC [30593] ERROR:  insert or update on table "memberships" violates foreign key constraint "fk_memberships_role"
@erp/api:test:db: 2026-11-01 00:55:43.558 UTC [30593] DETAIL:  Key (role_id, tenant_id)=(dddddddd-0000-4000-8000-000000000002, 11111111-1111-1111-1111-111111111111) is not present in table "roles".
@erp/api:test:db: 2026-11-01 00:55:43.558 UTC [30593] STATEMENT:  INSERT INTO memberships (id, tenant_id, user_id, role_id)
@erp/api:test:db: 	         VALUES ('ffffffff-1111-4111-8111-111111111111', $1,
@erp/api:test:db: 	                 'eeeeeeee-0000-4000-8000-000000000002',
@erp/api:test:db: 	                 'dddddddd-0000-4000-8000-000000000002')
@erp/api:test:db: 
@erp/api:test:db:  ✓ src/__db__/isolation/identity-isolation.db.spec.ts (612 tests) 4128ms
@erp/api:test:db: 2026-11-01 00:55:45.148 UTC [30607] ERROR:  permission denied for table sales_reallocations
@erp/api:test:db: 2026-11-01 00:55:45.148 UTC [30607] STATEMENT:  UPDATE sales_reallocations SET reason = 'tamper' WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db:  ✓ src/__db__/sales/operations.spec.ts (17 tests) 3238ms
@erp/api:test:db:    ✓ RC-01/RC-03 — AR subledger = AR_CONTROL exact, drift detected > RC-01: 20 randomized AR operations reconcile exactly (OK run)  711ms
@erp/api:test:db:    ✓ CC-03 / INV-021 — 50 parallel posts → 50 unique official numbers > consumes 50 distinct contiguous SAL numbers with no gaps or collisions  1696ms
@erp/api:test:db: {"level":30,"time":1793494546866,"service":"erp-api","module":"jobs","action":"boss-started","msg":"pg-boss queue client started"}
@erp/api:test:db: {"level":30,"time":1793494549408,"service":"erp-api","module":"jobs","action":"boss-stopped","msg":"pg-boss queue client stopped"}
@erp/api:test:db:  ✓ src/__db__/jobs.db.spec.ts (4 tests) 2549ms
@erp/api:test:db:    ✓ pg-boss queue infrastructure > test job executes exactly once for duplicate enqueues (dedupe contract, acceptance 5)  2512ms
@erp/api:test:db: {"level":30,"time":1793494549691,"service":"erp-api","module":"jobs","action":"boss-started","msg":"pg-boss queue client started"}
@erp/api:test:db: {"level":30,"time":1793494549705,"service":"erp-api","module":"http","correlation_id":"01a1949b-04c2-7000-a4af-3bd6c5b94c0e","action":"request","method":"GET","path":"/api/v1/platform/register/options","status":200,"duration_ms":7,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793494549895,"service":"erp-api","module":"tenancy-registration","tenant_id":"01a1949b-055e-7000-bca0-fab391c59316","country":"SA","msg":"tenant registered via public flow"}
@erp/api:test:db: {"level":30,"time":1793494549896,"service":"erp-api","module":"http","correlation_id":"01a1949b-04cc-7000-9779-b320c34fdd21","action":"request","method":"POST","path":"/api/v1/platform/register","status":200,"duration_ms":188,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793494550051,"service":"erp-api","module":"tenancy-registration","tenant_id":"01a1949b-0600-7000-91a2-daa28f61c2b2","country":"YE","msg":"tenant registered via public flow"}
@erp/api:test:db: {"level":30,"time":1793494550051,"service":"erp-api","module":"http","correlation_id":"01a1949b-058a-7000-83a7-4830f95413c6","action":"request","method":"POST","path":"/api/v1/platform/register","status":200,"duration_ms":153,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793494550193,"service":"erp-api","module":"tenancy-registration","tenant_id":"01a1949b-0697-7000-91b5-5ae4532c46c9","country":"YE","msg":"tenant registered via public flow"}
@erp/api:test:db: {"level":30,"time":1793494550194,"service":"erp-api","module":"http","correlation_id":"01a1949b-0625-7000-850a-fb6d93e124f0","action":"request","method":"POST","path":"/api/v1/platform/register","status":200,"duration_ms":141,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793494550332,"service":"erp-api","module":"tenancy-registration","tenant_id":"01a1949b-0720-7000-944c-a5d73ad18fff","country":"YE","msg":"tenant registered via public flow"}
@erp/api:test:db: {"level":30,"time":1793494550333,"service":"erp-api","module":"http","correlation_id":"01a1949b-06b3-7000-9584-c608a12129a0","action":"request","method":"POST","path":"/api/v1/platform/register","status":200,"duration_ms":138,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793494550467,"service":"erp-api","module":"tenancy-registration","tenant_id":"01a1949b-07ab-7000-b5bf-dd79c9792ef3","country":"YE","msg":"tenant registered via public flow"}
@erp/api:test:db: {"level":30,"time":1793494550468,"service":"erp-api","module":"http","correlation_id":"01a1949b-073e-7001-8a47-92888e485bd1","action":"request","method":"POST","path":"/api/v1/platform/register","status":200,"duration_ms":134,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793494550470,"service":"erp-api","module":"http","correlation_id":"01a1949b-07c5-7000-aee9-6c30e4d4a438","action":"request","method":"POST","path":"/api/v1/platform/register","status":429,"duration_ms":1,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793494550586,"service":"erp-api","module":"http","correlation_id":"01a1949b-07c8-7000-9c68-16f8d06dbfc1","action":"request","method":"POST","path":"/api/v1/identity/sessions","status":200,"duration_ms":114,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793494550631,"service":"erp-api","module":"http","correlation_id":"01a1949b-083c-7000-b28c-0379d7045336","action":"request","method":"POST","path":"/api/v1/tenancy/onboarding/provision","status":200,"duration_ms":43,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793494550648,"service":"erp-api","module":"http","correlation_id":"01a1949b-0868-7000-a875-992dafbaafd9","action":"request","method":"POST","path":"/api/v1/tenancy/onboarding/provision","status":200,"duration_ms":16,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793494550891,"service":"erp-api","module":"http","correlation_id":"01a1949b-08f8-7000-86a5-27c67239dd5d","action":"request","method":"POST","path":"/api/v1/identity/sessions","status":200,"duration_ms":115,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793494550899,"service":"erp-api","module":"http","correlation_id":"01a1949b-096d-7000-9561-4620b90193ae","action":"request","method":"POST","path":"/api/v1/tenancy/branches","status":200,"duration_ms":6,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793494550903,"service":"erp-api","module":"http","correlation_id":"01a1949b-0974-7000-ba96-864e39cbdaad","action":"request","method":"POST","path":"/api/v1/tenancy/branches","status":403,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793494550909,"service":"erp-api","module":"http","correlation_id":"01a1949b-0978-7000-8e86-5411e5637daf","action":"request","method":"PATCH","path":"/api/v1/tenancy/branches/01a1949b-0971-7000-ae5d-e18b4fe7cbbb","status":200,"duration_ms":5,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793494550913,"service":"erp-api","module":"http","correlation_id":"01a1949b-097f-7000-8299-136e49386644","action":"request","method":"POST","path":"/api/v1/tenancy/branches","status":409,"duration_ms":2,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793494550918,"service":"erp-api","module":"http","correlation_id":"01a1949b-0983-7000-a6ce-74dfb7a41f8d","action":"request","method":"GET","path":"/api/v1/tenancy/settings","status":200,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793494550923,"service":"erp-api","module":"http","correlation_id":"01a1949b-0987-7001-94b6-cfc020602a9f","action":"request","method":"PUT","path":"/api/v1/tenancy/settings/general.numeral_system","status":200,"duration_ms":4,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793494550927,"service":"erp-api","module":"http","correlation_id":"01a1949b-098c-7001-a448-ce44876735fa","action":"request","method":"PUT","path":"/api/v1/tenancy/settings/does.not_exist","status":422,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793494550932,"service":"erp-api","module":"http","correlation_id":"01a1949b-0990-7000-a925-fbfbb0d7daaa","action":"request","method":"PUT","path":"/api/v1/tenancy/settings/general.default_locale","status":422,"duration_ms":4,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793494550943,"service":"erp-api","module":"http","correlation_id":"01a1949b-0995-7001-945e-924c013496f6","action":"request","method":"GET","path":"/api/v1/tenancy/entitlements","status":200,"duration_ms":10,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793494551062,"service":"erp-api","module":"http","correlation_id":"01a1949b-09a0-7000-8aed-2fb63d3aae07","action":"request","method":"POST","path":"/api/v1/identity/sessions","status":200,"duration_ms":118,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793494551069,"service":"erp-api","module":"http","correlation_id":"01a1949b-0a18-7000-8e0d-6ae6237df6ba","action":"request","method":"GET","path":"/api/v1/platform/tenants?limit=200","status":200,"duration_ms":5,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793494551073,"service":"erp-api","module":"http","correlation_id":"01a1949b-0a1f-7000-b40d-5de396c02309","action":"request","method":"GET","path":"/api/v1/platform/tenants","status":403,"duration_ms":2,"msg":"request completed"}
@erp/api:test:db: (node:29885) DeprecationWarning: Calling client.query() when the client is already executing a query is deprecated and will be removed in pg@9.0. Use async/await or an external async flow control mechanism instead.
@erp/api:test:db: (Use `node --trace-deprecation ...` to show where the warning was created)
@erp/api:test:db: {"level":30,"time":1793494551083,"service":"erp-api","module":"http","correlation_id":"01a1949b-0a23-7000-a8fd-45d613341712","action":"request","method":"GET","path":"/api/v1/platform/tenants/01a1949b-055e-7000-bca0-fab391c59316","status":200,"duration_ms":8,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793494551107,"service":"erp-api","module":"http","correlation_id":"01a1949b-0a2d-7000-bd26-2927f1850dc6","action":"request","method":"POST","path":"/api/v1/platform/tenants/01a1949b-055e-7000-bca0-fab391c59316/plan","status":200,"duration_ms":22,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793494551114,"service":"erp-api","module":"http","correlation_id":"01a1949b-0a44-7000-b2d8-2d53c042bdd1","action":"request","method":"POST","path":"/api/v1/platform/tenants/01a1949b-055e-7000-bca0-fab391c59316/entitlements","status":200,"duration_ms":6,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793494551118,"service":"erp-api","module":"http","correlation_id":"01a1949b-0a4b-7000-afa2-008a4644f359","action":"request","method":"POST","path":"/api/v1/platform/tenants/01a1949b-055e-7000-bca0-fab391c59316/entitlements","status":422,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793494551123,"service":"erp-api","module":"http","correlation_id":"01a1949b-0a4f-7001-9f5b-09f072f6023e","action":"request","method":"DELETE","path":"/api/v1/platform/tenants/01a1949b-055e-7000-bca0-fab391c59316/entitlements/accounting.recurring_journals?reason=cleanup","status":200,"duration_ms":4,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793494551130,"service":"erp-api","module":"http","correlation_id":"01a1949b-0a54-7001-bf39-2ddd0dbb5d55","action":"request","method":"GET","path":"/api/v1/platform/audit/events?platformOnly=true&limit=200","status":200,"duration_ms":6,"msg":"request completed"}
@erp/api:test:db: {"level":40,"time":1793494551137,"service":"erp-api","module":"tenancy-lifecycle","tenant_id":"01a1949b-055e-7000-bca0-fab391c59316","killed_sessions":2,"msg":"tenant suspended"}
@erp/api:test:db: {"level":30,"time":1793494551138,"service":"erp-api","module":"http","correlation_id":"01a1949b-0a5b-7000-92b0-e40bfb17b2bf","action":"request","method":"POST","path":"/api/v1/platform/tenants/01a1949b-055e-7000-bca0-fab391c59316/suspend","status":200,"duration_ms":7,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793494551140,"service":"erp-api","module":"http","correlation_id":"01a1949b-0a62-7001-b5f2-15a922282d8a","action":"request","method":"GET","path":"/api/v1/tenancy/profile","status":401,"duration_ms":2,"msg":"request completed"}
@erp/api:test:db: {"level":40,"time":1793494551256,"service":"erp-api","module":"identity","user_id":"01a1949b-0561-7000-a99f-43949c004733","msg":"authenticated user has no active membership"}
@erp/api:test:db: {"level":30,"time":1793494551256,"service":"erp-api","module":"http","correlation_id":"01a1949b-0a65-7000-9134-8d5180b4274d","action":"request","method":"POST","path":"/api/v1/identity/sessions","status":401,"duration_ms":115,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793494551266,"service":"erp-api","module":"http","correlation_id":"01a1949b-0ad9-7001-ac70-8a293d6b8508","action":"request","method":"GET","path":"/api/v1/platform/tenants/01a1949b-055e-7000-bca0-fab391c59316","status":200,"duration_ms":9,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793494551273,"service":"erp-api","module":"http","correlation_id":"01a1949b-0ae3-7000-a435-7d695b61fbbd","action":"request","method":"POST","path":"/api/v1/platform/tenants/01a1949b-055e-7000-bca0-fab391c59316/restore","status":200,"duration_ms":6,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793494551394,"service":"erp-api","module":"http","correlation_id":"01a1949b-0aea-7000-b34e-7cff19739051","action":"request","method":"POST","path":"/api/v1/identity/sessions","status":200,"duration_ms":120,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793494551398,"service":"erp-api","module":"http","correlation_id":"01a1949b-0b63-7000-a42e-596134078fc9","action":"request","method":"GET","path":"/api/v1/tenancy/profile","status":200,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793494551404,"service":"erp-api","module":"http","correlation_id":"01a1949b-0b68-7000-9385-b94eb49b2399","action":"request","method":"PUT","path":"/api/v1/tenancy/settings/platform.support.opt_in","status":200,"duration_ms":4,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793494551411,"service":"erp-api","module":"http","correlation_id":"01a1949b-0b6d-7000-b087-5e6932e9a61d","action":"request","method":"POST","path":"/api/v1/platform/tenants/01a1949b-055e-7000-bca0-fab391c59316/support-sessions","status":200,"duration_ms":6,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793494551417,"service":"erp-api","module":"http","correlation_id":"01a1949b-0b74-7001-ac0f-9767ed7dffa2","action":"request","method":"GET","path":"/api/v1/platform/tenants/01a1949b-055e-7000-bca0-fab391c59316/support-sessions/01a1949b-0b72-7000-9b68-b5369abc3045/tenant-data/users","status":200,"duration_ms":5,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793494551422,"service":"erp-api","module":"http","correlation_id":"01a1949b-0b7a-7001-8427-3f747bf6a98b","action":"request","method":"GET","path":"/api/v1/tenancy/support-sessions","status":200,"duration_ms":4,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793494551427,"service":"erp-api","module":"http","correlation_id":"01a1949b-0b7f-7000-beaa-1d45c90e6068","action":"request","method":"DELETE","path":"/api/v1/tenancy/support-sessions/01a1949b-0b72-7000-9b68-b5369abc3045","status":200,"duration_ms":4,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793494551438,"service":"erp-api","module":"jobs","action":"boss-stopped","msg":"pg-boss queue client stopped"}
@erp/api:test:db:  ✓ src/__db__/tenancy-http.db.spec.ts (16 tests) 1969ms
@erp/api:test:db:    ✓ public registration (anonymous, rate-limited) > per-IP rate limit caps anonymous registrations (429 + Retry-After)  574ms
@erp/api:test:db:  ✓ src/__db__/reporting/asof.spec.ts (2 tests) 1315ms
@erp/api:test:db:    ✓ as-of freeze (posted_at cutoff) > entries posted AFTER the freeze never leak into the as-of snapshot  1235ms
@erp/api:test:db:  ✓ src/__db__/migrations.db.spec.ts (7 tests) 1194ms
@erp/api:test:db:    ✓ migration state > re-apply (regression shape) is a no-op: drizzle-kit migrate skips applied entries  1059ms
@erp/api:test:db:  ✓ src/__db__/master-data-perf.db.spec.ts (3 tests) 894ms
@erp/api:test:db: {"level":30,"time":1793494555245,"service":"erp-api","module":"jobs","action":"boss-started","msg":"pg-boss queue client started"}
@erp/api:test:db: {"level":30,"time":1793494555273,"service":"erp-api","module":"notifications","template":"registration_welcome","correlation_id":"01a1949b-04cc-7000-9779-b320c34fdd21","msg":"email delivered"}
@erp/api:test:db: {"level":30,"time":1793494555387,"service":"erp-api","module":"http","correlation_id":"01a1949b-1a75-7000-872e-de69b57681d6","action":"request","method":"POST","path":"/api/v1/identity/sessions","status":200,"duration_ms":134,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793494555509,"service":"erp-api","module":"http","correlation_id":"01a1949b-1afd-7000-887a-99da71b018e4","action":"request","method":"POST","path":"/api/v1/identity/sessions","status":401,"duration_ms":120,"msg":"request completed"}
@erp/api:test:db: {"level":40,"time":1793494555511,"service":"erp-api","module":"identity","email_hash":"63bc7e40b1ca","msg":"login attempt for unknown email"}
@erp/api:test:db: {"level":30,"time":1793494555512,"service":"erp-api","module":"http","correlation_id":"01a1949b-1b76-7000-8286-45a02c3abdd0","action":"request","method":"POST","path":"/api/v1/identity/sessions","status":401,"duration_ms":2,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793494555638,"service":"erp-api","module":"http","correlation_id":"01a1949b-1b79-7000-82fb-b6ae1900869f","action":"request","method":"POST","path":"/api/v1/identity/sessions","status":200,"duration_ms":125,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793494555640,"service":"erp-api","module":"http","correlation_id":"01a1949b-1bf7-7000-ab91-2f356228469d","action":"request","method":"GET","path":"/api/v1/identity/users","status":401,"duration_ms":1,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793494555653,"service":"erp-api","module":"http","correlation_id":"01a1949b-1c01-7000-bf49-740ad6d6fbc0","action":"request","method":"GET","path":"/api/v1/identity/users","status":403,"duration_ms":4,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793494555666,"service":"erp-api","module":"http","correlation_id":"01a1949b-1c0d-7000-84ce-89e7453630c9","action":"request","method":"GET","path":"/api/v1/identity/users","status":200,"duration_ms":5,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793494555671,"service":"erp-api","module":"http","correlation_id":"01a1949b-1c14-7000-84b3-c0e44524716d","action":"request","method":"GET","path":"/api/v1/identity/sessions/current","status":200,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793494555677,"service":"erp-api","module":"http","correlation_id":"01a1949b-1c19-7000-9ac9-e73023de8dd9","action":"request","method":"POST","path":"/api/v1/identity/sessions/switch-tenant","status":404,"duration_ms":4,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793494555682,"service":"erp-api","module":"http","correlation_id":"01a1949b-1c1e-7000-b847-67046b4dd106","action":"request","method":"GET","path":"/api/v1/audit/events","status":200,"duration_ms":4,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793494555686,"service":"erp-api","module":"http","correlation_id":"01a1949b-1c23-7000-a0fb-ffe3f11591be","action":"request","method":"GET","path":"/api/v1/audit/events","status":403,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793494555689,"service":"erp-api","module":"http","correlation_id":"01a1949b-1c27-7000-8152-cfbcd6ddd3e8","action":"request","method":"POST","path":"/api/v1/identity/invitations","status":422,"duration_ms":2,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793494555807,"service":"erp-api","module":"http","correlation_id":"01a1949b-1c2a-7000-8948-f72dc19f70a4","action":"request","method":"POST","path":"/api/v1/identity/sessions","status":200,"duration_ms":117,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793494555813,"service":"erp-api","module":"http","correlation_id":"01a1949b-1ca0-7000-ad51-eeaf44a0457b","action":"request","method":"DELETE","path":"/api/v1/identity/sessions/current","status":200,"duration_ms":5,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793494555815,"service":"erp-api","module":"http","correlation_id":"01a1949b-1ca6-7000-b6fe-1b0634cf236b","action":"request","method":"GET","path":"/api/v1/identity/sessions/current","status":401,"duration_ms":1,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793494555822,"service":"erp-api","module":"http","correlation_id":"01a1949b-1ca9-7000-a26a-2cfc3b6fc41c","action":"request","method":"POST","path":"/api/v1/identity/mfa/totp/enroll","status":200,"duration_ms":5,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793494555831,"service":"erp-api","module":"http","correlation_id":"01a1949b-1cb0-7000-a702-f433a6b0cd6b","action":"request","method":"POST","path":"/api/v1/identity/mfa/totp/verify","status":200,"duration_ms":7,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793494555953,"service":"erp-api","module":"http","correlation_id":"01a1949b-1cb8-7000-8c50-060608d5cb09","action":"request","method":"POST","path":"/api/v1/identity/sessions","status":423,"duration_ms":121,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793494555959,"service":"erp-api","module":"http","correlation_id":"01a1949b-1d33-7000-a344-664135fa63c0","action":"request","method":"POST","path":"/api/v1/identity/password-resets","status":200,"duration_ms":4,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793494555961,"service":"erp-api","module":"identity","email_domain":"exist.test","msg":"reset requested for unknown email"}
@erp/api:test:db: {"level":30,"time":1793494555962,"service":"erp-api","module":"http","correlation_id":"01a1949b-1d38-7001-9ba4-159c56cf1a6c","action":"request","method":"POST","path":"/api/v1/identity/password-resets","status":200,"duration_ms":2,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793494555966,"service":"erp-api","module":"jobs","action":"boss-stopped","msg":"pg-boss queue client stopped"}
@erp/api:test:db:  ✓ src/__db__/identity-http.db.spec.ts (12 tests) 1023ms
@erp/api:test:db:  ✓ src/__db__/purchasing/ap.spec.ts (12 tests) 838ms
@erp/api:test:db:    ✓ RC-02/RC-03 — AP subledger = AP_CONTROL exact, drift detected > RC-02: 20 randomized AP operations reconcile exactly (OK run)  425ms
@erp/api:test:db:  ✓ src/__db__/reporting/render.spec.ts (2 tests) 787ms
@erp/api:test:db: stdout | src/__db__/accounting/posting-smoke.local.spec.ts > PHASE-007 posting smoke (k6-equivalent, smoke tier) > posts under 5 concurrent workers measure p95 < 500ms with zero failures
@erp/api:test:db: [posting-smoke] n=100 p50=22.8ms p95=60.8ms max=94.3ms failures=0
@erp/api:test:db: 
@erp/api:test:db:  ✓ src/__db__/accounting/posting-smoke.local.spec.ts (1 test) 790ms
@erp/api:test:db:    ✓ PHASE-007 posting smoke (k6-equivalent, smoke tier) > posts under 5 concurrent workers measure p95 < 500ms with zero failures  790ms
@erp/api:test:db: {"level":30,"time":1793494558712,"service":"erp-api","module":"jobs","action":"boss-started","msg":"pg-boss queue client started"}
@erp/api:test:db: {"level":30,"time":1793494558739,"service":"erp-api","module":"notifications","template":"registration_welcome","correlation_id":"01a1949b-058a-7000-83a7-4830f95413c6","msg":"email delivered"}
@erp/api:test:db: {"level":30,"time":1793494558847,"service":"erp-api","module":"http","correlation_id":"01a1949b-27ff-7000-a6c9-2b5c36ca1f36","action":"request","method":"POST","path":"/api/v1/identity/sessions","status":200,"duration_ms":128,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793494558965,"service":"erp-api","module":"http","correlation_id":"01a1949b-2881-7000-8eba-48e07fe5617e","action":"request","method":"POST","path":"/api/v1/identity/sessions","status":200,"duration_ms":116,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793494558978,"service":"erp-api","module":"http","correlation_id":"01a1949b-28f7-7000-965f-d8a65c3d71b8","action":"request","method":"POST","path":"/api/v1/partners/partners","status":200,"duration_ms":11,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793494558983,"service":"erp-api","module":"http","correlation_id":"01a1949b-2903-7000-8d14-ad4a541cc458","action":"request","method":"GET","path":"/api/v1/partners/partners","status":200,"duration_ms":4,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793494558987,"service":"erp-api","module":"http","correlation_id":"01a1949b-2908-7001-b0a6-9c56491387c2","action":"request","method":"POST","path":"/api/v1/partners/partners","status":403,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793494558993,"service":"erp-api","module":"http","correlation_id":"01a1949b-290d-7000-ac8a-3c239bbc56c9","action":"request","method":"POST","path":"/api/v1/items/import-jobs","status":403,"duration_ms":4,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793494558996,"service":"erp-api","module":"http","correlation_id":"01a1949b-2912-7000-98ad-cf2763dfdef4","action":"request","method":"POST","path":"/api/v1/partners/partners","status":422,"duration_ms":2,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793494559010,"service":"erp-api","module":"http","correlation_id":"01a1949b-291c-7000-b1cc-afa439c35b36","action":"request","method":"POST","path":"/api/v1/partners/partners","status":404,"duration_ms":6,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793494559031,"service":"erp-api","module":"http","correlation_id":"01a1949b-2932-7000-8541-ab6e623f9482","action":"request","method":"PATCH","path":"/api/v1/partners/partners/01a1949b-2900-7000-9424-7d980f75001b","status":404,"duration_ms":5,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793494559042,"service":"erp-api","module":"http","correlation_id":"01a1949b-293e-7001-a1ce-5214fc47810b","action":"request","method":"GET","path":"/api/v1/partners/partners/01a1949b-293e-7000-b776-60eb3d72c5ca","status":404,"duration_ms":4,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793494559047,"service":"erp-api","module":"http","correlation_id":"01a1949b-2943-7000-bf20-9a67e2f6c181","action":"request","method":"GET","path":"/api/v1/partners/partners/01a1949b-2743-7004-83a4-7cc8844e06b1","status":404,"duration_ms":4,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793494559052,"service":"erp-api","module":"http","correlation_id":"01a1949b-2949-7000-a733-61a59693d4fb","action":"request","method":"GET","path":"/api/v1/partners/partners","status":200,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793494559057,"service":"erp-api","module":"http","correlation_id":"01a1949b-294d-7000-bb94-1471393ca4e7","action":"request","method":"GET","path":"/api/v1/items/uoms","status":200,"duration_ms":4,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793494559061,"service":"erp-api","module":"http","correlation_id":"01a1949b-2952-7000-b1f3-a167a3ac010b","action":"request","method":"GET","path":"/api/v1/partners/credit-terms","status":200,"duration_ms":3,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793494559067,"service":"erp-api","module":"http","correlation_id":"01a1949b-2957-7000-bcd0-ae1df8adc093","action":"request","method":"POST","path":"/api/v1/partners/partners","status":200,"duration_ms":4,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793494559073,"service":"erp-api","module":"http","correlation_id":"01a1949b-295c-7001-a05c-e6fab0cdc75e","action":"request","method":"POST","path":"/api/v1/partners/partners","status":200,"duration_ms":5,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793494559078,"service":"erp-api","module":"http","correlation_id":"01a1949b-2962-7000-84e2-e09210107be1","action":"request","method":"POST","path":"/api/v1/partners/partners","status":200,"duration_ms":4,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793494559084,"service":"erp-api","module":"http","correlation_id":"01a1949b-2967-7001-bc19-75d3f4c3684e","action":"request","method":"POST","path":"/api/v1/partners/partners","status":200,"duration_ms":5,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793494559090,"service":"erp-api","module":"http","correlation_id":"01a1949b-296d-7000-a242-536f88e26967","action":"request","method":"POST","path":"/api/v1/partners/partners","status":200,"duration_ms":5,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793494559094,"service":"erp-api","module":"http","correlation_id":"01a1949b-2972-7000-8e90-187fa6ce55ed","action":"request","method":"GET","path":"/api/v1/partners/partners?limit=3","status":200,"duration_ms":4,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793494559100,"service":"erp-api","module":"http","correlation_id":"01a1949b-2977-7000-a993-ddba7a449d97","action":"request","method":"GET","path":"/api/v1/partners/partners?limit=3&cursor=eyJvZmZzZXQiOjN9","status":200,"duration_ms":5,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793494559105,"service":"erp-api","module":"http","correlation_id":"01a1949b-297d-7000-9b0d-04c1aa4c671e","action":"request","method":"GET","path":"/api/v1/partners/search?q=%D8%A7%D9%84%D8%B9%D8%A7%D9%84%D9%85%D9%8A%D8%A9","status":200,"duration_ms":4,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793494559134,"service":"erp-api","module":"http","correlation_id":"01a1949b-2989-7000-a582-f69baef88a18","action":"request","method":"POST","path":"/api/v1/items/items","status":200,"duration_ms":21,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793494559140,"service":"erp-api","module":"http","correlation_id":"01a1949b-299f-7000-8aa0-8b5b4b1c04e3","action":"request","method":"POST","path":"/api/v1/items/resolve-price","status":200,"duration_ms":5,"msg":"request completed"}
@erp/api:test:db: {"level":30,"time":1793494559144,"service":"erp-api","module":"jobs","action":"boss-stopped","msg":"pg-boss queue client stopped"}
@erp/api:test:db:  ✓ src/__db__/master-data-http.db.spec.ts (10 tests) 640ms
@erp/api:test:db: {"level":30,"time":1793494559334,"service":"erp-api","module":"tenancy-registration","tenant_id":"01a1949b-2a49-7000-b251-e73205d6b63e","country":"SA","msg":"tenant registered via public flow"}
@erp/api:test:db: {"level":30,"time":1793494559537,"service":"erp-api","module":"tenancy-registration","tenant_id":"01a1949b-2b16-7000-838a-c46929091406","country":"YE","msg":"tenant registered via public flow"}
@erp/api:test:db: {"level":30,"time":1793494559722,"service":"erp-api","module":"tenancy-registration","tenant_id":"01a1949b-2bc4-7000-a65e-b3ebb4e67486","country":"SA","msg":"tenant registered via public flow"}
@erp/api:test:db:  ✓ src/__db__/tenancy-provisioning.db.spec.ts (4 tests) 629ms
@erp/api:test:db: 2026-11-01 00:56:00.378 UTC [30805] ERROR:  duplicate key value violates unique constraint "uq_journal_entries_tenant_source_op"
@erp/api:test:db: 2026-11-01 00:56:00.378 UTC [30805] STATEMENT:  
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
@erp/api:test:db:  ✓ src/__db__/sales/golden.spec.ts (10 tests) 555ms
@erp/api:test:db: 2026-11-01 00:56:00.421 UTC [30805] ERROR:  duplicate key value violates unique constraint "uq_journal_entries_tenant_source_op"
@erp/api:test:db: 2026-11-01 00:56:00.421 UTC [30805] STATEMENT:  
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
@erp/api:test:db: 2026-11-01 00:56:00.867 UTC [30835] ERROR:  PERIOD_LOCKED: entry date falls in a LOCKED fiscal period
@erp/api:test:db: 2026-11-01 00:56:00.867 UTC [30835] CONTEXT:  PL/pgSQL function erp.journal_entry_period_check() line 9 at RAISE
@erp/api:test:db: 2026-11-01 00:56:00.867 UTC [30835] STATEMENT:  commit
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:56:00.868 UTC [30835] WARNING:  there is no transaction in progress
@erp/api:test:db: 
@erp/api:test:db:  ✓ src/__db__/accounting/concurrency/concurrency.spec.ts (4 tests) 499ms
@erp/api:test:db:    ✓ CC-03 — sequence numbering race (50 parallel posts) > 50 unique official numbers, no gaps/collisions, no deadlocks  430ms
@erp/api:test:db:  ✓ src/__db__/treasury/golden.spec.ts (14 tests) 485ms
@erp/api:test:db: {"level":30,"time":1793494561617,"service":"erp-api","module":"tenancy-registration","tenant_id":"01a1949b-3335-7000-bd20-f04f19f2338a","country":"SA","msg":"tenant registered via public flow"}
@erp/api:test:db: {"level":30,"time":1793494561764,"service":"erp-api","module":"tenancy-registration","tenant_id":"01a1949b-33c6-7000-a978-0e751ed085e6","country":"YE","msg":"tenant registered via public flow"}
@erp/api:test:db: {"level":40,"time":1793494561779,"service":"erp-api","module":"tenancy-lifecycle","tenant_id":"01a1949b-3335-7000-bd20-f04f19f2338a","killed_sessions":1,"msg":"tenant suspended"}
@erp/api:test:db: {"level":40,"time":1793494561814,"service":"erp-api","module":"tenancy-lifecycle","tenant_id":"01a1949b-3335-7000-bd20-f04f19f2338a","killed_sessions":0,"msg":"tenant suspended"}
@erp/api:test:db: {"level":40,"time":1793494561940,"service":"erp-api","module":"tenancy-lifecycle","tenant_id":"01a1949b-33c6-7000-a978-0e751ed085e6","killed_sessions":0,"msg":"tenant suspended"}
@erp/api:test:db:  ✓ src/__db__/platform-lifecycle.db.spec.ts (16 tests) 481ms
@erp/api:test:db: {"level":30,"time":1793494562113,"service":"erp-api","module":"tenancy-registration","tenant_id":"01a1949b-3523-7000-9088-6f687bf9c081","country":"SA","msg":"tenant registered via public flow"}
@erp/api:test:db: {"level":30,"time":1793494562252,"service":"erp-api","module":"tenancy-registration","tenant_id":"01a1949b-35b4-7000-bc82-829e6f070b43","country":"AE","msg":"tenant registered via public flow"}
@erp/api:test:db:  ✓ src/__db__/entitlements.db.spec.ts (11 tests) 344ms
@erp/api:test:db:  ✓ src/__db__/purchasing/golden.spec.ts (10 tests) 290ms
@erp/api:test:db:  ✓ src/__db__/accounting/golden/golden.spec.ts (8 tests) 288ms
@erp/api:test:db: 2026-11-01 00:56:03.181 UTC [30875] ERROR:  permission denied for table tax_document_summaries
@erp/api:test:db: 2026-11-01 00:56:03.181 UTC [30875] STATEMENT:  UPDATE tax_document_summaries SET tax_amount = 28 WHERE tenant_id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:56:03.248 UTC [30880] ERROR:  permission denied for table jurisdictions
@erp/api:test:db: 2026-11-01 00:56:03.248 UTC [30880] STATEMENT:  INSERT INTO jurisdictions (id, country_code, country_name, country_name_ar, currency_code, minor_units, vat_status, pack_version, descriptor, source_ref)
@erp/api:test:db: 	       VALUES ('99999999-0000-4000-8000-000000000001', 'ZZ', 'X', 'س', 'SAR', 2, 'NO_VAT', '1', '{}', 'x')
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:56:03.249 UTC [30880] ERROR:  permission denied for table jurisdictions
@erp/api:test:db: 2026-11-01 00:56:03.249 UTC [30880] STATEMENT:  UPDATE jurisdictions SET pack_version = '9' WHERE country_code = 'SA'
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:56:03.250 UTC [30880] ERROR:  permission denied for table jurisdiction_tax_rates
@erp/api:test:db: 2026-11-01 00:56:03.250 UTC [30880] STATEMENT:  DELETE FROM jurisdiction_tax_rates WHERE rate = 15
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:56:03.251 UTC [30880] ERROR:  permission denied for table tax_treatments
@erp/api:test:db: 2026-11-01 00:56:03.251 UTC [30880] STATEMENT:  UPDATE tax_treatments SET name = 'X' WHERE key = 'EXEMPT'
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:56:03.251 UTC [30880] ERROR:  permission denied for table tax_treatments
@erp/api:test:db: 2026-11-01 00:56:03.251 UTC [30880] STATEMENT:  INSERT INTO tax_treatments (key, name, name_ar, taxable, sort_order) VALUES ('X', 'X', 'س', true, 9)
@erp/api:test:db: 
@erp/api:test:db:  ✓ src/__db__/tax/vat-return.spec.ts (13 tests) 297ms
@erp/api:test:db: 2026-11-01 00:56:03.581 UTC [30891] ERROR:  permission denied for table cash_movements
@erp/api:test:db: 2026-11-01 00:56:03.581 UTC [30891] STATEMENT:  UPDATE cash_movements SET amount = 999 WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:56:03.581 UTC [30891] ERROR:  permission denied for table cash_movements
@erp/api:test:db: 2026-11-01 00:56:03.581 UTC [30891] STATEMENT:  DELETE FROM cash_movements WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:56:03.589 UTC [30892] ERROR:  cash_movements are append-only (INV-019): UPDATE on row 01a1949b-3aa9-7000-b905-5f37217d5aa6 is forbidden
@erp/api:test:db: 2026-11-01 00:56:03.589 UTC [30892] CONTEXT:  PL/pgSQL function erp.cash_movements_guard() line 3 at RAISE
@erp/api:test:db: 2026-11-01 00:56:03.589 UTC [30892] STATEMENT:  UPDATE cash_movements SET amount = 999 WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db:  ✓ src/__db__/treasury/invariants.spec.ts (7 tests) 292ms
@erp/api:test:db:  ✓ src/__db__/inventory/golden.spec.ts (9 tests) 244ms
@erp/api:test:db:  ✓ src/__db__/purchasing/matching.spec.ts (7 tests) 203ms
@erp/api:test:db:  ✓ src/__db__/tax/pack-ae.spec.ts (10 tests) 202ms
@erp/api:test:db:  ✓ src/__db__/tax/pack-om.spec.ts (10 tests) 182ms
@erp/api:test:db:  ✓ src/__db__/treasury/treasury-rules.spec.ts (7 tests) 212ms
@erp/api:test:db:  ✓ src/__db__/tax/pack-eg.spec.ts (10 tests) 182ms
@erp/api:test:db:  ✓ src/__db__/tax/pack-jo.spec.ts (10 tests) 189ms
@erp/api:test:db:  ✓ src/__db__/tax/pack-bh.spec.ts (10 tests) 191ms
@erp/api:test:db:  ✓ src/__db__/accounting/periods/periods.spec.ts (5 tests) 170ms
@erp/api:test:db:  ✓ src/__db__/reporting/exports.spec.ts (4 tests) 184ms
@erp/api:test:db:  ✓ src/__db__/purchasing/landed-costs.spec.ts (3 tests) 158ms
@erp/api:test:db: 2026-11-01 00:56:05.999 UTC [30941] ERROR:  PERIOD_LOCKED: entry date falls in a LOCKED fiscal period
@erp/api:test:db: 2026-11-01 00:56:05.999 UTC [30941] CONTEXT:  PL/pgSQL function erp.journal_entry_period_check() line 9 at RAISE
@erp/api:test:db: 2026-11-01 00:56:05.999 UTC [30941] STATEMENT:  COMMIT
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:56:06.085 UTC [30943] ERROR:  duplicate key value violates unique constraint "uq_number_assignments_scope_number"
@erp/api:test:db: 2026-11-01 00:56:06.085 UTC [30943] DETAIL:  Key (tenant_id, doc_type, COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'::uuid), number)=(33333333-3333-3333-3333-333333333333, probe_doc, 00000000-0000-0000-0000-000000000000, PRB-2026-000001) already exists.
@erp/api:test:db: 2026-11-01 00:56:06.085 UTC [30943] STATEMENT:  INSERT INTO number_assignments (id, tenant_id, doc_type, period_key, number, value)
@erp/api:test:db: 	         VALUES ($1, $2, 'probe_doc', '2026', $3, 999)
@erp/api:test:db: 
@erp/api:test:db:  ✓ src/__db__/accounting/invariants/INV-011-022.spec.ts (8 tests) 167ms
@erp/api:test:db:  ✓ src/__db__/inventory/method-switch.spec.ts (3 tests) 152ms
@erp/api:test:db: 2026-11-01 00:56:06.387 UTC [30947] ERROR:  permission denied for table journal_lines
@erp/api:test:db: 2026-11-01 00:56:06.387 UTC [30947] STATEMENT:  UPDATE journal_lines SET amount = 999 WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:56:06.388 UTC [30947] ERROR:  permission denied for table journal_entries
@erp/api:test:db: 2026-11-01 00:56:06.388 UTC [30947] STATEMENT:  DELETE FROM journal_entries WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:56:06.388 UTC [30947] ERROR:  permission denied for table journal_entries
@erp/api:test:db: 2026-11-01 00:56:06.388 UTC [30947] STATEMENT:  UPDATE journal_entries SET description = 'hacked' WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:56:06.402 UTC [30948] ERROR:  journal_entries are append-only (INV-003): only the reversal link (status→REVERSED, reversed_by_id) may change
@erp/api:test:db: 2026-11-01 00:56:06.402 UTC [30948] CONTEXT:  PL/pgSQL function erp.journal_entries_guard() line 28 at RAISE
@erp/api:test:db: 2026-11-01 00:56:06.402 UTC [30948] STATEMENT:  UPDATE journal_entries SET status = 'REVERSED', version = version + 1 WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db:  ✓ src/__db__/accounting/invariants/INV-001-009.spec.ts (16 tests) 141ms
@erp/api:test:db: 2026-11-01 00:56:06.616 UTC [30950] ERROR:  stock_moves are append-only (INV-010): DELETE on row 0bad0bad-0000-4000-8000-000000000001 is forbidden
@erp/api:test:db: 2026-11-01 00:56:06.616 UTC [30950] CONTEXT:  PL/pgSQL function erp.stock_moves_guard() line 3 at RAISE
@erp/api:test:db: 2026-11-01 00:56:06.616 UTC [30950] STATEMENT:  DELETE FROM stock_moves WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db:  ✓ src/__db__/inventory/recon.spec.ts (3 tests) 144ms
@erp/api:test:db:  ✓ src/__db__/inventory/counts.spec.ts (4 tests) 128ms
@erp/api:test:db:  ✓ src/__db__/master-data-flows.db.spec.ts (14 tests) 149ms
@erp/api:test:db:  ✓ src/__db__/inventory/tracking.spec.ts (6 tests) 168ms
@erp/api:test:db:  ✓ src/__db__/inventory/valuation-ledger.spec.ts (6 tests) 131ms
@erp/api:test:db:  ✓ src/__db__/tax/pack-sa.spec.ts (10 tests) 122ms
@erp/api:test:db:  ✓ src/__db__/purchasing/operations.spec.ts (9 tests) 104ms
@erp/api:test:db:  ✓ src/__db__/treasury/bank-rec.spec.ts (11 tests) 134ms
@erp/api:test:db: 2026-11-01 00:56:07.769 UTC [30967] ERROR:  new row violates row-level security policy for table "audit_events"
@erp/api:test:db: 2026-11-01 00:56:07.769 UTC [30967] STATEMENT:  INSERT INTO audit_events (id, tenant_id, action, entity_type, entity_id)
@erp/api:test:db: 	         VALUES ('aaaaaaaa-3333-4333-8333-333333333333', $1, 'forged.created', 'x', $1)
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:56:07.783 UTC [30969] ERROR:  permission denied for table audit_events
@erp/api:test:db: 2026-11-01 00:56:07.783 UTC [30969] STATEMENT:  DELETE FROM audit_events WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:56:07.798 UTC [30971] ERROR:  permission denied for table audit_events
@erp/api:test:db: 2026-11-01 00:56:07.798 UTC [30971] STATEMENT:  UPDATE audit_events SET action = 'hacked' WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:56:07.799 UTC [30971] ERROR:  permission denied for table audit_events
@erp/api:test:db: 2026-11-01 00:56:07.799 UTC [30971] STATEMENT:  DELETE FROM audit_events WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:56:07.807 UTC [30972] ERROR:  audit_events are append-only (INV-003 substrate): UPDATE prohibited
@erp/api:test:db: 2026-11-01 00:56:07.807 UTC [30972] CONTEXT:  PL/pgSQL function erp.audit_events_guard() line 3 at RAISE
@erp/api:test:db: 2026-11-01 00:56:07.807 UTC [30972] STATEMENT:  UPDATE audit_events SET action = 'hacked' WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:56:07.807 UTC [30972] ERROR:  audit_events are append-only (INV-003 substrate): DELETE prohibited
@erp/api:test:db: 2026-11-01 00:56:07.807 UTC [30972] CONTEXT:  PL/pgSQL function erp.audit_events_guard() line 3 at RAISE
@erp/api:test:db: 2026-11-01 00:56:07.807 UTC [30972] STATEMENT:  DELETE FROM audit_events WHERE id = $1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:56:07.825 UTC [30974] ERROR:  insert or update on table "_infra_probe_child" violates foreign key constraint "fk__infra_probe_tenant"
@erp/api:test:db: 2026-11-01 00:56:07.825 UTC [30974] DETAIL:  Key (probe_id, tenant_id)=(bbbbbbbb-1111-4111-8111-111111111111, 22222222-2222-2222-2222-222222222222) is not present in table "_infra_probe".
@erp/api:test:db: 2026-11-01 00:56:07.825 UTC [30974] STATEMENT:  INSERT INTO _infra_probe_child (id, probe_id, tenant_id)
@erp/api:test:db: 	         VALUES ('cccccccc-2222-4222-8222-222222222222', $1, $2)
@erp/api:test:db: 
@erp/api:test:db:  ✓ src/__db__/rls-attacks.db.spec.ts (9 tests) 94ms
@erp/api:test:db: 2026-11-01 00:56:07.894 UTC [30982] ERROR:  new row violates row-level security policy for table "audit_events"
@erp/api:test:db: 2026-11-01 00:56:07.894 UTC [30982] STATEMENT:  INSERT INTO audit_events (id, tenant_id, action, entity_type, entity_id, via_platform_admin)
@erp/api:test:db: 	         VALUES ('cccccccc-9000-4000-8000-000000000009', $1, 'forge.tenant', 'tenant', $1, true)
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:56:07.901 UTC [30983] ERROR:  new row violates row-level security policy for table "audit_events"
@erp/api:test:db: 2026-11-01 00:56:07.901 UTC [30983] STATEMENT:  INSERT INTO audit_events (id, tenant_id, action, entity_type, entity_id, via_platform_admin)
@erp/api:test:db: 	         VALUES ('cccccccc-9000-4000-8000-00000000000a', NULL, 'forge.platform', 'tenant', $1, true)
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:56:07.908 UTC [30984] ERROR:  new row violates row-level security policy for table "plans"
@erp/api:test:db: 2026-11-01 00:56:07.908 UTC [30984] STATEMENT:  INSERT INTO plans (id, key, name, name_ar, price_amount, currency_code, limits, feature_keys)
@erp/api:test:db: 	         VALUES ('31111111-0000-4000-8000-00000000000f', 'rogue', 'Rogue', 'م rogue', 0, 'SAR',
@erp/api:test:db: 	                 '{}'::jsonb, ARRAY['platform.registration'])
@erp/api:test:db: 
@erp/api:test:db:  ✓ src/__db__/isolation/platform-isolation.db.spec.ts (12 tests) 91ms
@erp/api:test:db:  ✓ src/__db__/tax/pack-kw.spec.ts (3 tests) 89ms
@erp/api:test:db:  ✓ src/__db__/tax/pack-qa.spec.ts (3 tests) 85ms
@erp/api:test:db:  ✓ src/__db__/reporting/runs.spec.ts (5 tests) 88ms
@erp/api:test:db:  ✓ src/__db__/tax/pack-iq.spec.ts (3 tests) 88ms
@erp/api:test:db:  ✓ src/__db__/tax/pack-ye.spec.ts (3 tests) 78ms
@erp/api:test:db:  ✓ src/__db__/reporting/golden.spec.ts (6 tests) 51ms
@erp/api:test:db:  ✓ src/__db__/accounting/gl-perf.db.spec.ts (3 tests) 70ms
@erp/api:test:db:  ✓ src/__db__/tax/spoof.spec.ts (5 tests) 25ms
@erp/api:test:db:  ✓ src/__db__/files.db.spec.ts (4 tests) 28ms
@erp/api:test:db:  ✓ src/__db__/treasury/spoof.spec.ts (5 tests) 30ms
@erp/api:test:db: {"level":30,"time":1793494568702,"service":"erp-api","module":"jobs","action":"boss-started","msg":"pg-boss queue client started"}
@erp/api:test:db:  ✓ src/__db__/readiness.db.spec.ts (4 tests) 21ms
@erp/api:test:db: {"level":30,"time":1793494568716,"service":"erp-api","module":"jobs","action":"boss-stopped","msg":"pg-boss queue client stopped"}
@erp/api:test:db:  ✓ src/__db__/tenant-context.db.spec.ts (4 tests) 13ms
@erp/api:test:db: 
@erp/api:test:db:  Test Files  62 passed (62)
@erp/api:test:db:       Tests  1075 passed (1075)
@erp/api:test:db:    Start at  00:55:12
@erp/api:test:db:    Duration  56.01s (transform 2.25s, setup 0ms, collect 4.30s, tests 48.51s, environment 0ms, prepare 51ms)
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:56:08.753 UTC [29826] LOG:  received fast shutdown request
@erp/api:test:db: 2026-11-01 00:56:08.753 UTC [29826] LOG:  aborting any active transactions
@erp/api:test:db: 2026-11-01 00:56:08.753 UTC [30963] FATAL:  terminating connection due to administrator command
@erp/api:test:db: 2026-11-01 00:56:08.753 UTC [30956] FATAL:  terminating connection due to administrator command
@erp/api:test:db: 2026-11-01 00:56:08.755 UTC [29921] FATAL:  terminating connection due to administrator command
@erp/api:test:db: 2026-11-01 00:56:08.755 UTC [30590] FATAL:  terminating connection due to administrator command
@erp/api:test:db: 2026-11-01 00:56:08.757 UTC [29919] FATAL:  terminating connection due to administrator command
@erp/api:test:db: 2026-11-01 00:56:08.758 UTC [29826] LOG:  background worker "logical replication launcher" (PID 29832) exited with exit code 1
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:56:08.760 UTC [29827] LOG:  shutting down
@erp/api:test:db: 2026-11-01 00:56:08.760 UTC [29827] LOG:  checkpoint starting: shutdown immediate
@erp/api:test:db: 
@erp/api:test:db: (node:29885) DeprecationWarning: Client.activeQuery is deprecated and will be removed in pg@9.0
@erp/api:test:db: (node:29885) DeprecationWarning: Client.queryQueue is deprecated and will be removed in pg@9.0.
@erp/api:test:db: 2026-11-01 00:56:08.809 UTC [29827] LOG:  checkpoint complete: wrote 10334 buffers (63.1%); 0 WAL file(s) added, 0 removed, 9 recycled; write=0.047 s, sync=0.002 s, total=0.050 s; sync files=1250, longest=0.001 s, average=0.000 s; distance=146568 kB, estimate=146568 kB; lsn=0/A400C50, redo lsn=0/A400C50
@erp/api:test:db: 
@erp/api:test:db: 2026-11-01 00:56:08.822 UTC [29826] LOG:  database system is shut down
@erp/api:test:db: 

 Tasks:    1 successful, 1 total
Cached:    0 cached, 1 total
  Time:    56.886s 


=== build ===

> erp-platform@0.1.0 build /home/z/erp-platform
> turbo run build


   • turbo 2.11.10
   • Packages in scope: @erp/api, @erp/config, @erp/contracts, @erp/domain-core, @erp/ui, @erp/web
   • Running build in 6 packages
   • Remote caching disabled

@erp/contracts:build: cache miss, executing d788f45418beb907
@erp/domain-core:build: cache miss, executing 8984482349f7d203
@erp/domain-core:build: 
@erp/domain-core:build: > @erp/domain-core@0.1.0 build /home/z/erp-platform/packages/domain-core
@erp/domain-core:build: > tsc --noEmit -p tsconfig.json
@erp/domain-core:build: 
@erp/contracts:build: 
@erp/contracts:build: > @erp/contracts@0.1.0 build /home/z/erp-platform/packages/contracts
@erp/contracts:build: > tsc --noEmit -p tsconfig.json
@erp/contracts:build: 
@erp/ui:build: cache miss, executing 3264c35745c103ec
@erp/ui:build: 
@erp/ui:build: > @erp/ui@1.0.0 build /home/z/erp-platform/packages/ui
@erp/ui:build: > tsc --noEmit -p tsconfig.json
@erp/ui:build: 
@erp/web:build: cache miss, executing 0ff2a574f897b024
@erp/api:build: cache miss, executing 7e1575eef9d573b3
@erp/web:build: 
@erp/web:build: > @erp/web@0.1.0 build /home/z/erp-platform/apps/web
@erp/web:build: > next build
@erp/web:build: 
@erp/api:build: 
@erp/api:build: > @erp/api@0.1.0 build /home/z/erp-platform/apps/api
@erp/api:build: > tsc --noEmit -p tsconfig.json
@erp/api:build: 
@erp/web:build: ▲ Next.js 16.4.3 (Turbopack)
@erp/web:build: ✓ Running next.config.ts took 56ms
@erp/web:build: 
@erp/web:build: ⚠ The "middleware" file convention is deprecated. Please use "proxy" instead.
@erp/web:build: 
@erp/web:build:   To migrate automatically, run:
@erp/web:build:   npx @next/codemod@canary middleware-to-proxy .
@erp/web:build: 
@erp/web:build:   Learn more: https://nextjs.org/docs/messages/middleware-to-proxy
@erp/web:build:   Creating an optimized production build ...
@erp/web:build: ✓ Compiled successfully in 7.8s
@erp/web:build:   Running TypeScript ...
@erp/web:build:   Finished TypeScript in 11.8s ...
@erp/web:build:   Collecting page data using 1 worker ...
@erp/web:build:   Generating static pages using 1 worker (0/122) ...
@erp/web:build:   Generating static pages using 1 worker (30/122) 
@erp/web:build:   Generating static pages using 1 worker (60/122) 
@erp/web:build:   Generating static pages using 1 worker (91/122) 
@erp/web:build: ✓ Generating static pages using 1 worker (122/122) in 574ms
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
@erp/web:build: ├ ƒ /[locale]/branches
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
@erp/web:build: ├ ƒ /[locale]/onboarding
@erp/web:build: ├ ƒ /[locale]/opening-balances
@erp/web:build: ├ ƒ /[locale]/partners
@erp/web:build: ├ ƒ /[locale]/partners/[id]
@erp/web:build: ├ ƒ /[locale]/partners/new
@erp/web:build: ├ ƒ /[locale]/platform
@erp/web:build: ├ ƒ /[locale]/platform/audit
@erp/web:build: ├ ƒ /[locale]/platform/tenants/[id]
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
Cached:    0 cached, 5 total
  Time:    31.316s 

 WARNING  no output files found for task @erp/api#build. Please check your `outputs` key in `turbo.json`
 WARNING  no output files found for task @erp/contracts#build. Please check your `outputs` key in `turbo.json`
 WARNING  no output files found for task @erp/domain-core#build. Please check your `outputs` key in `turbo.json`
 WARNING  no output files found for task @erp/ui#build. Please check your `outputs` key in `turbo.json`

=== design-token contrast gate (§16) ===

> erp-platform@0.1.0 check:token-contrast /home/z/erp-platform
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

=== i18n key parity + negative proof ===

> erp-platform@0.1.0 check:i18n-parity /home/z/erp-platform
> tsx scripts/check-i18n-parity.ts

== i18n key parity: ar=1505 keys, en=1505 keys ==
ar/en catalogs at 100% key parity; no empty values.

=== ui catalog coverage (export ↔ row) ===

> erp-platform@0.1.0 check:ui-catalog /home/z/erp-platform
> tsx scripts/check-ui-catalog-coverage.ts

== ui catalog coverage: 37 component exports ↔ 60 catalog rows ==
export↔row parity green.

=== design-system harness (storybook → visual/axe/coverage → perf) ===

> erp-platform@0.1.0 test:visual-harness-run /home/z/erp-platform
> pnpm --filter @erp/ui test:harness


> @erp/ui@1.0.0 test:harness /home/z/erp-platform/packages/ui
> pnpm build:storybook && pnpm test:visual && pnpm test:perf


> @erp/ui@1.0.0 build:storybook /home/z/erp-platform/packages/ui
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
▲  Vite src/patterns/approvals-queue.tsx (1:0): Error when using
│  sourcemap for reporting an error: Can't resolve original location of
│  error.
│
▲  Vite src/patterns/approvals-queue.tsx (1:0): Module level directives
│  cause errors when bundled, "use client" in
│  "src/patterns/approvals-queue.tsx" was ignored.
│
▲  Vite src/patterns/shift-panel.tsx (1:0): Error when using sourcemap
│  for reporting an error: Can't resolve original location of error.
│
▲  Vite src/patterns/shift-panel.tsx (1:0): Module level directives cause
│  errors when bundled, "use client" in "src/patterns/shift-panel.tsx"
│  was ignored.
│
▲  Vite src/patterns/journal-entry-grid.tsx (1:0): Error when using
│  sourcemap for reporting an error: Can't resolve original location of
│  error.
│
▲  Vite src/patterns/journal-entry-grid.tsx (1:0): Module level
│  directives cause errors when bundled, "use client" in
│  "src/patterns/journal-entry-grid.tsx" was ignored.
│
▲  Vite src/patterns/partner-picker.tsx (1:0): Error when using sourcemap
│  for reporting an error: Can't resolve original location of error.
│
▲  Vite src/patterns/partner-picker.tsx (1:0): Module level directives
│  cause errors when bundled, "use client" in
│  "src/patterns/partner-picker.tsx" was ignored.
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
●  Copying static files: public at dist-storybook
│
▲  Vite src/components/button.tsx (1:0): Error when using sourcemap for
│  reporting an error: Can't resolve original location of error.
│
▲  Vite src/components/button.tsx (1:0): Module level directives cause
│  errors when bundled, "use client" in "src/components/button.tsx" was
│  ignored.
│
▲  Vite src/components/controls.tsx (1:0): Error when using sourcemap for
│  reporting an error: Can't resolve original location of error.
│
▲  Vite src/components/controls.tsx (1:0): Module level directives cause
│  errors when bundled, "use client" in "src/components/controls.tsx" was
│  ignored.
│
▲  Vite src/components/money-input.tsx (1:0): Error when using sourcemap
│  for reporting an error: Can't resolve original location of error.
│
▲  Vite src/components/money-input.tsx (1:0): Module level directives
│  cause errors when bundled, "use client" in
│  "src/components/money-input.tsx" was ignored.
│
▲  Vite src/components/toast.tsx (1:0): Error when using sourcemap for
│  reporting an error: Can't resolve original location of error.
│
▲  Vite src/components/toast.tsx (1:0): Module level directives cause
│  errors when bundled, "use client" in "src/components/toast.tsx" was
│  ignored.
│
▲  Vite src/components/overlays.tsx (1:0): Error when using sourcemap for
│  reporting an error: Can't resolve original location of error.
│
▲  Vite src/components/overlays.tsx (1:0): Module level directives cause
│  errors when bundled, "use client" in "src/components/overlays.tsx" was
│  ignored.
│
▲  Vite src/hooks/use-partner-balance.ts (1:0): Error when using
│  sourcemap for reporting an error: Can't resolve original location of
│  error.
│
▲  Vite src/hooks/use-partner-balance.ts (1:0): Module level directives
│  cause errors when bundled, "use client" in
│  "src/hooks/use-partner-balance.ts" was ignored.
│
▲  Vite src/hooks/use-item-pricing.ts (1:0): Error when using sourcemap
│  for reporting an error: Can't resolve original location of error.
│
▲  Vite src/hooks/use-item-pricing.ts (1:0): Module level directives
│  cause errors when bundled, "use client" in
│  "src/hooks/use-item-pricing.ts" was ignored.
│
▲  Vite src/components/input.tsx (1:0): Error when using sourcemap for
│  reporting an error: Can't resolve original location of error.
│
▲  Vite src/components/input.tsx (1:0): Module level directives cause
│  errors when bundled, "use client" in "src/components/input.tsx" was
│  ignored.
│
▲  Vite src/components/badge.tsx (1:0): Error when using sourcemap for
│  reporting an error: Can't resolve original location of error.
│
▲  Vite src/components/badge.tsx (1:0): Module level directives cause
│  errors when bundled, "use client" in "src/components/badge.tsx" was
│  ignored.
│
▲  Vite src/components/states.tsx (1:0): Error when using sourcemap for
│  reporting an error: Can't resolve original location of error.
│
▲  Vite src/components/states.tsx (1:0): Module level directives cause
│  errors when bundled, "use client" in "src/components/states.tsx" was
│  ignored.
│
▲  Vite src/components/shell.tsx (1:0): Error when using sourcemap for
│  reporting an error: Can't resolve original location of error.
│
▲  Vite src/components/shell.tsx (1:0): Module level directives cause
│  errors when bundled, "use client" in "src/components/shell.tsx" was
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
▲  Vite src/components/date-picker.tsx (1:0): Error when using sourcemap
│  for reporting an error: Can't resolve original location of error.
│
▲  Vite src/components/date-picker.tsx (1:0): Module level directives
│  cause errors when bundled, "use client" in
│  "src/components/date-picker.tsx" was ignored.
│
▲  Vite src/primitives/dropdown.tsx (1:0): Error when using sourcemap for
│  reporting an error: Can't resolve original location of error.
│
▲  Vite src/primitives/dropdown.tsx (1:0): Module level directives cause
│  errors when bundled, "use client" in "src/primitives/dropdown.tsx" was
│  ignored.
│
▲  Vite src/primitives/checkbox.tsx (1:0): Error when using sourcemap for
│  reporting an error: Can't resolve original location of error.
│
▲  Vite src/primitives/checkbox.tsx (1:0): Module level directives cause
│  errors when bundled, "use client" in "src/primitives/checkbox.tsx" was
│  ignored.
│
▲  Vite src/primitives/tabs.tsx (1:0): Error when using sourcemap for
│  reporting an error: Can't resolve original location of error.
│
▲  Vite src/primitives/tabs.tsx (1:0): Module level directives cause
│  errors when bundled, "use client" in "src/primitives/tabs.tsx" was
│  ignored.
│
▲  Vite src/primitives/switch.tsx (1:0): Error when using sourcemap for
│  reporting an error: Can't resolve original location of error.
│
▲  Vite src/primitives/switch.tsx (1:0): Module level directives cause
│  errors when bundled, "use client" in "src/primitives/switch.tsx" was
│  ignored.
│
▲  Vite src/primitives/radio.tsx (1:0): Error when using sourcemap for
│  reporting an error: Can't resolve original location of error.
│
▲  Vite src/primitives/radio.tsx (1:0): Module level directives cause
│  errors when bundled, "use client" in "src/primitives/radio.tsx" was
│  ignored.
│
▲  Vite src/primitives/dialog.tsx (1:0): Error when using sourcemap for
│  reporting an error: Can't resolve original location of error.
│
▲  Vite src/primitives/dialog.tsx (1:0): Module level directives cause
│  errors when bundled, "use client" in "src/primitives/dialog.tsx" was
│  ignored.
│
▲  Vite src/primitives/popover.tsx (1:0): Error when using sourcemap for
│  reporting an error: Can't resolve original location of error.
│
▲  Vite src/primitives/popover.tsx (1:0): Module level directives cause
│  errors when bundled, "use client" in "src/primitives/popover.tsx" was
│  ignored.
│
▲  Vite src/primitives/select.tsx (1:0): Error when using sourcemap for
│  reporting an error: Can't resolve original location of error.
│
▲  Vite src/primitives/select.tsx (1:0): Module level directives cause
│  errors when bundled, "use client" in "src/primitives/select.tsx" was
│  ignored.
│
▲  Vite src/primitives/tooltip.tsx (1:0): Error when using sourcemap for
│  reporting an error: Can't resolve original location of error.
│
▲  Vite src/primitives/tooltip.tsx (1:0): Module level directives cause
│  errors when bundled, "use client" in "src/primitives/tooltip.tsx" was
│  ignored.
│
▲  Vite src/primitives/drawer.tsx (1:0): Error when using sourcemap for
│  reporting an error: Can't resolve original location of error.
│
▲  Vite src/primitives/drawer.tsx (1:0): Module level directives cause
│  errors when bundled, "use client" in "src/primitives/drawer.tsx" was
│  ignored.
│
▲  Vite src/primitives/combobox.tsx (1:0): Error when using sourcemap for
│  reporting an error: Can't resolve original location of error.
│
▲  Vite src/primitives/combobox.tsx (1:0): Module level directives cause
│  errors when bundled, "use client" in "src/primitives/combobox.tsx" was
│  ignored.
│
▲  Vite
│  ../../node_modules/.pnpm/@radix-ui+react-dropdown-menu@2.2.1_@types+react-dom@19.3.0_@types+react@19.3.0__@types+react_xxm5e7tmvfqi4v2pshf6swmjk4/node_modules/@radix-ui/react-dropdown-menu/dist/index.mjs
│  (1:0): Module level directives cause errors when bundled, "use client"
│  in
│  "../../node_modules/.pnpm/@radix-ui+react-dropdown-menu@2.2.1_@types+react-dom@19.3.0_@types+react@19.3.0__@types+react_xxm5e7tmvfqi4v2pshf6swmjk4/node_modules/@radix-ui/react-dropdown-menu/dist/index.mjs"
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
│  ../../node_modules/.pnpm/@radix-ui+react-tabs@1.2.1_@types+react-dom@19.3.0_@types+react@19.3.0__@types+react@19.3.0_r_puc5pxotum6p2y2tcdnpidtoti/node_modules/@radix-ui/react-tabs/dist/index.mjs
│  (1:0): Module level directives cause errors when bundled, "use client"
│  in
│  "../../node_modules/.pnpm/@radix-ui+react-tabs@1.2.1_@types+react-dom@19.3.0_@types+react@19.3.0__@types+react@19.3.0_r_puc5pxotum6p2y2tcdnpidtoti/node_modules/@radix-ui/react-tabs/dist/index.mjs"
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
│  ../../node_modules/.pnpm/@radix-ui+react-radio-group@1.5.1_@types+react-dom@19.3.0_@types+react@19.3.0__@types+react@1_5eprdutbftqztliknbj4763vpi/node_modules/@radix-ui/react-radio-group/dist/index.mjs
│  (1:0): Module level directives cause errors when bundled, "use client"
│  in
│  "../../node_modules/.pnpm/@radix-ui+react-radio-group@1.5.1_@types+react-dom@19.3.0_@types+react@19.3.0__@types+react@1_5eprdutbftqztliknbj4763vpi/node_modules/@radix-ui/react-radio-group/dist/index.mjs"
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
│  ../../node_modules/.pnpm/@radix-ui+react-tooltip@1.4.1_@types+react-dom@19.3.0_@types+react@19.3.0__@types+react@19.3._xzrwmhtxvg6axoqmxmbnxquore/node_modules/@radix-ui/react-tooltip/dist/index.mjs
│  (1:0): Module level directives cause errors when bundled, "use client"
│  in
│  "../../node_modules/.pnpm/@radix-ui+react-tooltip@1.4.1_@types+react-dom@19.3.0_@types+react@19.3.0__@types+react@19.3._xzrwmhtxvg6axoqmxmbnxquore/node_modules/@radix-ui/react-tooltip/dist/index.mjs"
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
│  ../../node_modules/.pnpm/@radix-ui+react-popover@1.3.1_@types+react-dom@19.3.0_@types+react@19.3.0__@types+react@19.3._rxegc4hnzisv7vnucx3luvnlte/node_modules/@radix-ui/react-popover/dist/index.mjs
│  (1:0): Module level directives cause errors when bundled, "use client"
│  in
│  "../../node_modules/.pnpm/@radix-ui+react-popover@1.3.1_@types+react-dom@19.3.0_@types+react@19.3.0__@types+react@19.3._rxegc4hnzisv7vnucx3luvnlte/node_modules/@radix-ui/react-popover/dist/index.mjs"
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
│  ../../node_modules/.pnpm/@radix-ui+react-presence@1.1.11_@types+react-dom@19.3.0_@types+react@19.3.0__@types+react@19._omslmu2xf2j5osdlwfmawglnxy/node_modules/@radix-ui/react-presence/dist/index.mjs
│  (1:0): Module level directives cause errors when bundled, "use client"
│  in
│  "../../node_modules/.pnpm/@radix-ui+react-presence@1.1.11_@types+react-dom@19.3.0_@types+react@19.3.0__@types+react@19._omslmu2xf2j5osdlwfmawglnxy/node_modules/@radix-ui/react-presence/dist/index.mjs"
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
│  ../../node_modules/.pnpm/@radix-ui+react-menu@2.2.1_@types+react-dom@19.3.0_@types+react@19.3.0__@types+react@19.3.0_r_ly4265ahvip4e22uqjqsfs6say/node_modules/@radix-ui/react-menu/dist/index.mjs
│  (1:0): Module level directives cause errors when bundled, "use client"
│  in
│  "../../node_modules/.pnpm/@radix-ui+react-menu@2.2.1_@types+react-dom@19.3.0_@types+react@19.3.0__@types+react@19.3.0_r_ly4265ahvip4e22uqjqsfs6say/node_modules/@radix-ui/react-menu/dist/index.mjs"
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
│  ../../node_modules/.pnpm/@radix-ui+react-portal@1.2.0_@types+react-dom@19.3.0_@types+react@19.3.0__@types+react@19.3.0_nccyaa7sgzbykcwvtuwcktpwzu/node_modules/@radix-ui/react-portal/dist/index.mjs
│  (1:0): Module level directives cause errors when bundled, "use client"
│  in
│  "../../node_modules/.pnpm/@radix-ui+react-portal@1.2.0_@types+react-dom@19.3.0_@types+react@19.3.0__@types+react@19.3.0_nccyaa7sgzbykcwvtuwcktpwzu/node_modules/@radix-ui/react-portal/dist/index.mjs"
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
│  ../../node_modules/.pnpm/@radix-ui+react-popper@1.4.0_@types+react-dom@19.3.0_@types+react@19.3.0__@types+react@19.3.0_4bv4ucqgzkjgfbxanprxdzoozu/node_modules/@radix-ui/react-popper/dist/index.mjs
│  (1:0): Module level directives cause errors when bundled, "use client"
│  in
│  "../../node_modules/.pnpm/@radix-ui+react-popper@1.4.0_@types+react-dom@19.3.0_@types+react@19.3.0__@types+react@19.3.0_4bv4ucqgzkjgfbxanprxdzoozu/node_modules/@radix-ui/react-popper/dist/index.mjs"
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
│  ../../node_modules/.pnpm/@radix-ui+react-collection@1.2.0_@types+react-dom@19.3.0_@types+react@19.3.0__@types+react@19_uoaxrhgzxpicw5nsl73w5smpwe/node_modules/@radix-ui/react-collection/dist/index.mjs
│  (1:0): Module level directives cause errors when bundled, "use client"
│  in
│  "../../node_modules/.pnpm/@radix-ui+react-collection@1.2.0_@types+react-dom@19.3.0_@types+react@19.3.0__@types+react@19_uoaxrhgzxpicw5nsl73w5smpwe/node_modules/@radix-ui/react-collection/dist/index.mjs"
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
│  ../../node_modules/.pnpm/zod@4.6.7/node_modules/zod/v4/core/util.js
│  (400:0): A comment

│  "// Wrapped in a `@__PURE__` IIFE: esbuild never tree-shakes a
│  top-level initializer that contains a member access on `Number`, so
│  the bare object literal survived into every bundle."

│  in
│  "../../node_modules/.pnpm/zod@4.6.7/node_modules/zod/v4/core/util.js"
│  contains an annotation that Rollup cannot interpret due to the
│  position of the comment. The comment will be removed to avoid issues.
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
│  Vite dist-storybook/assets/iframe-BPfltAXh.css
│  72.87 kB
│  Vite dist-storybook/assets/exact-decimal-BzhQq6aO.js
│  0.49 kB
│  Vite dist-storybook/assets/partner-picker-DscjYV6b.js
│  0.66 kB
│  Vite dist-storybook/assets/partner-picker.stories-gqV0gQrU.js
│  1.20 kB
│  Vite dist-storybook/assets/preload-helper-PPVm8Dsz.js
│  1.23 kB
│  Vite dist-storybook/assets/item-picker.stories-CUQpaZmg.js
│  1.52 kB
│  Vite dist-storybook/assets/index-D_HrmjZ6.js
│  3.97 kB
│  Vite dist-storybook/assets/treasury-patterns.stories-DlH2cp0D.js
│  9.02 kB
│  Vite dist-storybook/assets/accounting-patterns.stories-C9GRAh1_.js
│  13.52 kB
│  Vite dist-storybook/assets/badge-Bm4zaSKi.js
│  14.46 kB
│  Vite dist-storybook/assets/money-input-vpJunYL5.js
│  20.84 kB
│  Vite dist-storybook/vite-inject-mocker-entry.js
│  28.11 kB
│  Vite dist-storybook/assets/input-CfoeDPqZ.js
│  34.43 kB
│  Vite dist-storybook/assets/catalog.stories-6PMjXc8i.js
│  77.65 kB
│  Vite dist-storybook/assets/controls-D_nFwaE7.js
│  122.66 kB
│  Vite dist-storybook/assets/react-18-BDNwTiQj.js
│  209.75 kB
│  Vite dist-storybook/assets/iframe-CYsfasA5.js
│  1,137.64 kB
│
▲  Vite
│  (!) Some chunks are larger than 500 kB after minification. Consider:
│  - Using dynamic import() to code-split the application
│  - Use build.rollupOptions.output.manualChunks to improve chunking:
│  ]8;;https://rollupjs.org/configuration-options/#output-manualchunkshttps://rollupjs.org/configuration-options/#output-manualchunks]8;;
│  - Adjust chunk size limit for this warning via
│  build.chunkSizeWarningLimit.
│  Vite ✓ built in 6.60s
│
◇  Output directory: /home/z/erp-platform/packages/ui/dist-storybook
│
└  Storybook build completed successfully


> @erp/ui@1.0.0 test:visual /home/z/erp-platform/packages/ui
> playwright test

[WebServer] (node:31501) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
[WebServer] (Use `node --trace-warnings ...` to show where the warning was created)

Running 16 tests using 2 workers

(node:31513) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:31514) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
  ✓   1 [chromium] › tests/security/bidi-payloads.spec.ts:20:3 › S-03 bidi/XSS payload neutralization › HTML/script payloads render as literal text — never execute (868ms)
  ✓   2 [chromium] › tests/security/bidi-payloads.spec.ts:34:3 › S-03 bidi/XSS payload neutralization › bidi override control characters cannot spoof adjacent labels (746ms)
  ✓   3 [chromium] › tests/security/bidi-payloads.spec.ts:46:3 › S-03 bidi/XSS payload neutralization › legit mixed-script values are isolated (dir=ltr + unicode-bidi isolate) (640ms)

  ✓   5 [chromium] › tests/security/bidi-payloads.spec.ts:71:1 › no dangerouslySetInnerHTML anywhere in the design system (static proof) (15ms)
  ✓   4 [chromium] › tests/security/bidi-payloads.spec.ts:64:3 › S-03 bidi/XSS payload neutralization › money payload cannot inject markup into the amount field (684ms)
  ✓   6 [chromium] › tests/visual/visual.spec.ts:137:3 › geometry invariants (RTL §10 / VISUAL_TESTING §4) › sidebar sits at the start edge in both directions (1.2s)
  ✓   8 [chromium] › tests/visual/visual.spec.ts:154:3 › geometry invariants (RTL §10 / VISUAL_TESTING §4) › amount digits identical across locales (never mirrored) (1.1s)
  ✓   9 [chromium] › tests/visual/visual.spec.ts:166:3 › geometry invariants (RTL §10 / VISUAL_TESTING §4) › breadcrumb separator mirrors with direction (981ms)
  ✓  10 [chromium] › tests/visual/visual.spec.ts:181:3 › coverage check (both directions mandatory) › every non-excluded story has ar AND en baselines (6ms)
  ✓  11 [chromium] › tests/visual/visual.spec.ts:68:5 › visual regression — AR+EN, threshold 0 › all stories render + screenshot — ar (25.5s)
  ✓  12 [chromium] › tests/visual/visual.spec.ts:68:5 › visual regression — AR+EN, threshold 0 › all stories render + screenshot — en (25.3s)
  ✓  13 [chromium] › tests/visual/visual.spec.ts:89:3 › visual regression — AR+EN, threshold 0 › comfortable density companions (6.4s)
  ✓  14 [chromium] › tests/visual/visual.spec.ts:104:5 › visual regression — AR+EN, threshold 0 › archetype viewports 390 — ar + en (1.0s)
  ✓  15 [chromium] › tests/visual/visual.spec.ts:104:5 › visual regression — AR+EN, threshold 0 › archetype viewports 1024 — ar + en (1.0s)
  ✓  16 [chromium] › tests/visual/visual.spec.ts:104:5 › visual regression — AR+EN, threshold 0 › archetype viewports 1280 — ar + en (895ms)
  ✓   7 [chromium] › tests/visual/visual.spec.ts:119:3 › axe — 0 violations per story (inside the visual harness) › axe clean on every story, both directions (1.4m)

  16 passed (1.5m)

> @erp/ui@1.0.0 test:perf /home/z/erp-platform/packages/ui
> playwright test -c playwright.perf.config.ts

[WebServer] (node:368) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
[WebServer] (Use `node --trace-warnings ...` to show where the warning was created)

Running 1 test using 1 worker

(node:380) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
floor=16.56ms table=17.14ms overhead=0.58ms (interleaved best-of-3)
  ✓  1 tests/perf/data-table-perf.spec.ts:55:1 › 10,000-row scroll: virtualization overhead isolated + 60fps where the floor allows (34.1s)

  1 passed (34.8s)

=== web secure-headers/CSP probe (§8) ===

> erp-platform@0.1.0 test:web-security /home/z/erp-platform
> pnpm --filter @erp/web build && pnpm --filter @erp/web exec playwright test -c playwright.probe.config.ts


> @erp/web@0.1.0 build /home/z/erp-platform/apps/web
> next build

▲ Next.js 16.4.3 (Turbopack)
✓ Running next.config.ts took 33ms

⚠ The "middleware" file convention is deprecated. Please use "proxy" instead.

  To migrate automatically, run:
  npx @next/codemod@canary middleware-to-proxy .

  Learn more: https://nextjs.org/docs/messages/middleware-to-proxy
  Creating an optimized production build ...
✓ Compiled successfully in 3.5s
  Running TypeScript ...
  Finished TypeScript in 8.1s ...
  Collecting page data using 1 worker ...
  Generating static pages using 1 worker (0/122) ...
  Generating static pages using 1 worker (30/122) 
  Generating static pages using 1 worker (60/122) 
  Generating static pages using 1 worker (91/122) 
✓ Generating static pages using 1 worker (122/122) in 632ms
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
├ ƒ /[locale]/branches
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
├ ƒ /[locale]/onboarding
├ ƒ /[locale]/opening-balances
├ ƒ /[locale]/partners
├ ƒ /[locale]/partners/[id]
├ ƒ /[locale]/partners/new
├ ƒ /[locale]/platform
├ ƒ /[locale]/platform/audit
├ ƒ /[locale]/platform/tenants/[id]
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

[WebServer] (node:629) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
[WebServer] (Use `node --trace-warnings ...` to show where the warning was created)
[WebServer] (node:641) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
[WebServer] (Use `node --trace-warnings ...` to show where the warning was created)

Running 4 tests using 1 worker

(node:660) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
  ✓  1 tests/security/headers-csp.spec.ts:15:7 › secure headers probe › document routes carry the full §8 header set (255ms)
  ✓  2 tests/security/headers-csp.spec.ts:37:7 › secure headers probe › per-request nonces rotate and scripts reference them (56ms)
  ✓  3 tests/security/headers-csp.spec.ts:47:7 › secure headers probe › no third-party assets are referenced (SRI n/a assertion) (16ms)
  ✓  4 tests/security/headers-csp.spec.ts:55:7 › secure headers probe › nonce'd document actually executes its scripts (CSP not breaking the app) (323ms)

  4 passed (2.2s)

=== docs validation (29 checks) ===

> erp-platform@0.1.0 docs:validate /home/z/erp-platform
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
INFO  total markdown files under docs/: 255
PASS  4d. EXPANSION_REGISTER present with ED-01..ED-19
PASS  4e. six v2.0 modules present in FEATURE_CATALOG
PASS  4f. v2.0 entities present in ENTITY_CATALOG
PASS  4g. v2.0 decision records + ADR-0018 present and indexed
PASS  4h. PHASE-026..034 present with 8 canonical headings
PASS  4i. v2.0 cross-references registered (G-21..32, INV-023..26, BR-041..056, reports, perms, nav)

29/29 checks passed.

=== negative boundary meta-test ===

> erp-platform@0.1.0 boundary:negative-test /home/z/erp-platform
> bash scripts/ci/negative-boundary-test.sh

[negative-boundary-test] linting deliberate violation with --no-ignore...

/home/z/erp-platform/apps/web/app/__boundary-violations__/violation.fixture.ts
  10:27  error  apps-web importing apps-api violates docs/architecture/DEPENDENCY_RULES.md  boundaries/element-types

✖ 1 problem (1 error, 0 warnings)

PASS: ESLint exited 1 on the violating fixture (expected failure).
      Boundary enforcement is active (DEPENDENCY_RULES.md §3).

=== negative erp-ui lint meta-test ===
NEGATIVE-UI-RULES: all four rules fail their fixtures (proof complete)

=== i18n key parity (ar/en) ===

> erp-platform@0.1.0 check:i18n-parity /home/z/erp-platform
> tsx scripts/check-i18n-parity.ts

== i18n key parity: ar=1505 keys, en=1505 keys ==
ar/en catalogs at 100% key parity; no empty values.

=== negative i18n parity meta-test ===

> erp-platform@0.1.0 boundary:negative-i18n-test /home/z/erp-platform
> bash scripts/ci/negative-i18n-parity-test.sh

NEGATIVE-I18N: parity checker fails its drifting fixture (proof complete)

=== ALL LOCAL GATES GREEN ===
FINAL_GATE_EXIT_CODE=0
