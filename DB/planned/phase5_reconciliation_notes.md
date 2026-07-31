# Reconciliation: `phase6_vendor_purchases.md` vs. `phase4_pos_billing.md` Domain 6.7

> Draft — decisions below need sign-off before `phase6_vendor_purchases.md`
> is rewritten/renamed and `phase4_pos_billing.md` is patched. Nothing here
> is built yet (Domain 6.7 is still design-only per the 17-Jul build-status
> check), so this is a paperwork fix, not a migration.

## Why this doc exists

`phase6_vendor_purchases.md` (committed 2026-07-22) was written without
reconciling against `phase4_pos_billing.md` Domain 6.7 (last touched
2026-07-09), which already designs `vendors`, `vendor_shipments`,
`eway_bills`, and `eway_api_logs`. The two docs disagree on phase numbering
and propose two incompatible e-way-bill schemas. This note resolves both
before either is built.

## Decision 1 — Renumber Phase 6 → Phase 5

`phase4_pos_billing.md` already reserves the name **Phase 5** for this exact
scope: "full procurement stays in Phase 5" (line 206), "Full procurement
(POs, GRNs, supplier bills, supplier payments)... Phase 5" (line 404).
`phase6_vendor_purchases.md`'s "Phase 6, after Phase 5 (POS Billing)" framing
was written on the mistaken premise that POS billing itself is Phase 5 (it's
Phase 4 — this exact naming slip already happened once before, per project
memory).

**Resolution:** this module is **Phase 5**, immediately following Phase 4.
Rename the doc `phase5_vendor_purchases.md`; relabel 6a/6b/6c → 5a/5b/5c
throughout.

## Decision 2 — Reuse `vendors` (T21), don't recreate it

`phase4_pos_billing.md` T21 already specs `vendors` with a code sequence
(`VEN0001` via `vendor_code_seq`), a GSTIN-length CHECK, and a **`state_code`**
column (2-digit GST state code, backfilled from the GSTIN prefix) — not the
free-text `state` column `phase6_vendor_purchases.md` §3 assumes.

**Resolution:** Phase 5a does not create `vendors`; it either builds on top
of T21 (if Domain 6.7 ships first) or is the one that actually creates it
using the **T21 shape** (if Phase 5 ships first, which is the current
likely order since Domain 6.7 is unbuilt). Either way, the column is
`state_code`, and `is_interstate` must derive as
`vendors.state_code <> '33'` (Tamil Nadu's GST state code) — **not** a
string comparison against `'Tamil Nadu'`. Also carry over the
`chk_vendors_gstin_length` constraint and `code`/`active`/`is_deleted`
column names as-is for consistency with the rest of the schema.

## Decision 3 — Drop `vendor_shipments`; `vendor_purchases` is the only inbound anchor

`vendor_shipments` (T22) is explicitly a stand-in: "Header only for v1... 
Full procurement / GRN with line-level received qty stays Phase 5" (line
251). Since it's unbuilt, there's no migration cost to skipping it entirely.

**Resolution:** do not build `vendor_shipments`. `vendor_purchases` +
`vendor_purchase_items` (already designed in `phase6_vendor_purchases.md`
§3) becomes the one and only inbound-goods anchor, for both the e-way
record and the eventual line-level GRN. This also means Phase 5 absorbs
Domain 6.7's "vendor shipment" scope rather than sitting downstream of it —
Phase 4 Domain 6.7 shrinks to `vendors` + `eway_bills` + `eway_api_logs`.

## Decision 4 — Don't duplicate e-way fields on `vendor_purchases`; reuse `eway_bills`

`phase6_vendor_purchases.md` §3 puts `eway_bill_number` /
`eway_bill_valid_upto` / `eway_bill_doc_url` directly on `vendor_purchases`.
But `eway_bills` (T23) already handles this — both directions, full GST
split (cgst/sgst/igst), transporter/vehicle detail, GSP metadata
(`generated_via`, `gsp_request_id`), and a direction-integrity CHECK
constraint (`chk_eway_bills_direction_ref`) that enforces exactly one parent
FK per row. Building a second, flatter EBN mechanism on `vendor_purchases`
would fork e-way data into two places with no shared reporting surface.

**Resolution:**
- Drop the three e-way columns from `vendor_purchases`.
- Add `vendor_purchase_id uuid NULL FK vendor_purchases` to `eway_bills`,
  replacing `vendor_shipment_id` (removed per Decision 3).
- Update `chk_eway_bills_direction_ref`'s `Inbound` branch to require
  `vendor_purchase_id IS NOT NULL` instead of `vendor_shipment_id`.
- Add `idx_eway_bills_vendor_purchase` in place of
  `idx_eway_bills_vendor_shipmt`.
- The Phase 5 "Mark Received" gate (§4 of the original doc) becomes: block
  the transition unless an `eway_bills` row exists with
  `direction='Inbound'`, `vendor_purchase_id = this purchase`,
  `status='Generated'` — not a null-check on a flat column.
- `fn_vendor_purchase_receive` calls into the same e-way-bill SPs Domain
  6.7 already plans (`fn_eway_bill_record`, per line 501 of
  `phase4_pos_billing.md`) rather than inventing parallel ones.

## Decision 5 — Threshold value conflict: ₹50,000 vs. ₹1,00,000

`phase4_pos_billing.md` line 192 references **₹50,000** as the outbound
B2B e-way threshold. `phase6_vendor_purchases.md` §3/§4 seeds
`app_settings.eway_bill_threshold` at **₹1,00,000** for inbound interstate
purchases. Both are plausible (interstate vs. intrastate GST e-way rules
do differ, and thresholds get revised by the GST Council), but the two docs
don't acknowledge each other's number, and both write to what should be a
single `app_settings` entry.

**Resolution (needs your confirmation, not a code judgment call):**
confirm with the client/current GST rules whether inbound-interstate and
outbound-B2B should share one `eway_bill_threshold` value or need two
separate settings keys (e.g. `eway_bill_threshold_inbound` /
`_outbound`). Don't seed either number until this is confirmed.

## Decision 6 — Duplicate file copies

`E:\Snacks\phase6_vendor_purchases.md` (repo root, untracked) is a byte-for-
byte copy of `DB/planned/phase6_vendor_purchases.md` (git-tracked). Once
this reconciliation lands and the tracked copy is renamed/rewritten, the
loose root copy should be deleted so it doesn't drift into a stale third
version.

## Net effect on `phase4_pos_billing.md` Domain 6.7

Domain 6.7 shrinks from 4 tables to 2 (`vendors`, `eway_bills` +
`eway_api_logs` — 3 if you count logs separately), with `vendor_shipments`
retired in favor of Phase 5's `vendor_purchases`. Phase 4 ships just the
`vendors` master + the `eway_bills`/`eway_api_logs` machinery (needed for
**outbound** e-way on bills/stock_requests, which Phase 4 already owns);
Phase 5 adds `vendor_purchases`/`vendor_purchase_items` and starts writing
**inbound** rows into the same `eway_bills` table.

## Next steps

1. Get sign-off on Decision 5 (threshold value/keys) — the only item that
   isn't a mechanical schema fix.
2. Rewrite `phase6_vendor_purchases.md` → `phase5_vendor_purchases.md` with
   Decisions 1-4 applied (renumbered, `vendors` reused not recreated,
   `vendor_shipments` dropped, e-way fields moved to `eway_bills` +
   `vendor_purchase_id` FK).
3. Patch `phase4_pos_billing.md` Domain 6.7 section: remove `vendor_shipments`
   (T22), renumber `eway_bills`/`eway_api_logs`, swap the `vendor_shipment_id`
   FK/index/constraint for `vendor_purchase_id`, and add a forward pointer to
   `phase5_vendor_purchases.md` for the inbound-anchor rationale.
4. Delete the stray root-level copy (Decision 6).
