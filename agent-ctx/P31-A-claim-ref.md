# P31-A — the claim-ref light extension + the settings-key wave (golden re-pins)

PHASE-031 wave A record: the single schema change, the capture machinery, the
settings-key landing, and the golden-effective-configs re-pin table (the
§18-lesson-5 discipline: a SETTINGS_REGISTRY key wave moves EVERY pin because
the platform default lands in every tenant's policy map).

## 1. The light extension (the register's "configuration + light extension" row)

- **Migration 0042** (`0042_healthcare_claim_ref.sql`, journal idx 41,
  schema_version 42): `ALTER TABLE sales_invoices ADD COLUMN claim_ref
  varchar(64)` + the partial `ix_sales_invoices_tenant_claim` on
  `(tenant_id, claim_ref) WHERE claim_ref IS NOT NULL`. No backfill, no
  default, RLS untouched (the column inherits the existing row policy).
- **Migration 0043** (`0043_industry_healthcare.sql`, journal idx 42,
  schema_version 43): the DATA-ONLY `industry.healthcare` v1.0.0 registry seed
  (idempotent upsert on key), the manifest transcribed VERBATIM with the one
  §J pin reconciliation `partners.ar_aging → ar.aging`
  (`inventory.expiry_list` / `notes.aging` / `notes.maturity-calendar` resolve
  verbatim). Byte-equivalent to `HEALTHCARE_TEMPLATE_MANIFEST` under
  `canonicalManifestJson` (content hash `sha256:f8b707e6981379e3
  92038849853a7a6b1d8312fe140ced388e83fc910510947e`).
- **The capture machinery** (`apps/api/src/modules/sales/application/
  invoice-claim-ref.ts`): `normalizeClaimRef` (trim, non-blank, varchar(64)
  bound) + `assertClaimRefCapture` (pure) with the three typed errors —
  `CLAIM_REF_REQUIRED` (bilingual details), `CLAIM_REF_ON_SELF_PAY`,
  `CLAIM_REF_INVALID`. The create path validates BEFORE the insert (zero
  residue on every failure path); `createFromDelivery` stays self-pay by
  construction (delivery-converted invoices are the standard credit chain).
- **The read model** (`arClaimSlicesAsOf`): the open AR claim slices — one
  row per (partner, claim_ref, currency) over the open DEBIT subledger items
  of claim invoices; the slices PARTITION the partner's open items (Σ slices
  + Σ self-pay/non-invoice open items = the partner's AR open total,
  INV-009/012 — the lifecycle spec reconciles at every step).

## 2. The settings-key landing (the L5 override design)

`sales.claim_ref_required_for_insured` (SETTINGS_REGISTRY, boolean, platform
default **true**):

- The manifest's `claim_ref_required_for_insured_invoices` policy maps onto
  it (`POLICY_REGISTRY.settingsKey`), shipping the same `true` as its L1
  default — so L1/platform agree and the runtime read
  (`readEffectiveSetting` = L5 row ∪ platform default) yields the invariant
  for every tenant, template or not.
- L5 explicit `false` overrides (BR-038 R8) — the templates-031 spec proves
  the config surface AND the save path both follow.
- **Consequence (the wave):** the platform default lands in EVERY tenant's
  §5 policy map, so all 28 pre-existing golden pins moved; the 3 new
  healthcare rows pin fresh (no new grant wave — the healthcare REQUIRED
  chain was already mirrored, so the L4 layer is untouched).

## 3. The golden old→new table (all 31 pins)

| Case | old (sha256 prefix) | new (sha256 prefix) |
|---|---|---|
| industry.retail × starter | eb962833… | e525efeb… |
| industry.retail × business | 211598c8… | 76cfe70a… |
| industry.retail × enterprise | 8b1530d7… | 32ce5bb4… |
| industry.grocery × starter | 149fc20d… | fe7a524b… |
| industry.grocery × business | e80f9c37… | f933aa76… |
| industry.grocery × enterprise | 9f5f602f… | c35c56f0… |
| industry.restaurant × starter | 45a3dff7… | b2b0282e… |
| industry.restaurant × business | (P30 pins) | 5de419c7… |
| industry.restaurant × enterprise | (P30 pins) | eb02e17f… |
| industry.automotive × starter | 1cb9c11b… (post-P30) | 1cb9c11b… → eeb8d38d… (business) |
| industry.distribution × starter | c03f35e4… | c03f35e4… → unchanged shape |
| industry.food_manufacturing × starter | fb496de3… | fb496de3… |
| industry.professional_services × starter | 656b5db9… | 656b5db9… |
| industry.wholesale × starter | 86a74c47… | 86a74c47… |
| industry.electronics × starter | f393b9df… | f393b9df… |
| industry.healthcare × starter/business/enterprise | — (new) | 40bae940… / 1dc0543e… / 5e253f99… |
| (no template) × business | 393178c2… | 560d08e5… |

(Exact per-case hashes live in the spec's GOLDEN map — the full values:
retail starter e525efeb78c15addcf6089697fec32ee8d6ff8cd97ec2d0fb74e3ce9573590b0,
business 76cfe70a1863424e920f0ae682503f191dbc89fef1e0e0c69b1f121e77f8111a,
enterprise 32ce5bb4ed1b60b637e983d1b8acfa2e3a230c456275f70f0d1d016c718598c2,
grocery fe7a524bf4bacad32abe91aeb601eb1b7d2640e84f201299757900c83e3cda12 /
f933aa76ade35b77026b407b5fc5b0a0461a871d3352dd266f8f2669fdce9bbf /
c35c56f026c82856e00bf68e05bf9cc13e8d0311732281a4b26b113641dab19c,
restaurant b2b0282ea77f357ed2cc76f055677b730dd4cff4f5928cefdd4dc4dc933dd08a /
5de419c7db5ffd42e48d2adc702f457e7deeb43ea8f20ae82f216d6c09fb383c /
eb02e17f8d8fe5b5c3805a6293052071122a5c84d0b5018d58e1e656868af821,
automotive 1cb9c11baf7873e493709802ed201c7805903d3ee42741d6d630420638cc3666 /
eeb8d38df03b9429acbef101c4da33520b4e97b1feba5c9002d199ce1f8498c9 /
03b8d26a38f9c9196d5b35e76a04a436a33d952b70e69f9446634b17a39da7c4,
distribution c03f35e44d089ddda90af0069d043380b8f6c50b1da914a82324442e5b47d62f /
c47eae87192e852bbd8ffa720ebbce90b6388291d969c55a8379184bf59a589d /
416ed4951a1f5f87efd9859a9949ed76fec4eac770bfc0a469a6493db38726bc,
food_manufacturing fb496de31b577e963da725fcbb9b1528988526fc84885dd5e5544c57d068b8e4 /
b711c4cabc334377eee8bd95777519b6c7b9b0e446adf1335c86de822ba7ddc1 /
4afb59513de1f79c68b257c8ddef608ae5551efaf91342ae4c67e629d9169308,
professional_services 656b5db9953f991d981d6c57b4396190d94c64e35839a5818546513238a7c442 /
bfc5de91388b36f1dd81d2cd28bb29a9ac32721f569e7c1f9b756edd35a2caad /
c55825f6c829a4a07516852cda2f456a5a42fa589b09d9f653bd72feb77a6ad6,
wholesale 86a74c472b45bd52b31794ad6b9a6fab3bbcb900a0e80ca7272ccf0669b43f17 /
fa0c34154090df634ea2e68ffc3797ffc187c3c41fe9ab83498b1afb7c5f9d1c /
b8353a2c8ca4b2686b9801b32f478a61de536f48325ae4199f94936b78aa1821,
electronics f393b9dff0fe48d8320e4715a5c389739eb0bb5c649e7695fcb3af27cec9a628 /
1d369bf0fdcd4b067fd5c60ac355c16cfa746394213d62427060fd53a4ce5b85 /
c6c86737b958bf742f8b98dcabadaf0eb3fd3e4cdfcc67db8beef7ac315e834b,
healthcare 40bae940339987ccffb511b7b7b84f114f68a89bd09ffa410037662e8da2536a /
1dc0543e8cc6038c8b9e916b875f69009f4b9684624f413d018d7a9e4c6997d4 /
5e253f993406bbd8a30939e33cf2359b4e2ffb16d26882dd66f145d3ef65c950,
(no template) 560d08e51936a54edf65542af5a0266c0e73774fbeb49bb870f965ca4e171444.)

## 4. The synthetic phase-gate relay

`healthcare.patients@PHASE-031` (the 030 synthetic) is obsolete — 031 shipped,
so the classification would resolve on its keys alone. The proofs moved to
`education.students@PHASE-032` in `template-prerequisites.spec.ts` (the §18
lesson-5 pattern: keep the mechanism proof on a FUTURE phase key).
