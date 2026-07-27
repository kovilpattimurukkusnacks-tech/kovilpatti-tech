# Partial-Weight Dispatch — Inventory / Godown Side

> Godown user can dispatch a partial-weight quantity instead of an
> integer packet count, for scenarios where physical stock doesn't cover
> the full requested packets. E.g. shop requests 5 × 1 kg packets, godown
> has 3 full + one 500 g partial → godown dispatches **3.5 kg total**.
>
> Scope: **dispatch side only** (Option A confirmed 25-Jul-2026). Shop
> request side stays packet-count only. Partial-weight is a fulfilment
> capability, not a request capability.

## Business context

- Godown-side physical stock is NOT tracked in the system currently.
  Inventory user honor-declares what they can ship. This design records
  what was shipped; it doesn't validate available stock.
- Shop's request semantics unchanged: request_qty is still integer
  packets. Value at request time = requested_qty × unit_price.
- Partial-dispatch tracking mirrors the return-partial pattern
  (`return_weight_g` on Return items, 02-Jul-2026) — but on the outbound
  Order side. Same math: `line_value = (weight_g / pack_g) × unit_price`.

## Data model

### `stock_request_items` — new columns

```sql
ALTER TABLE stock_request_items
  ADD COLUMN dispatched_weight_g numeric(10,3),   -- inv dispatch partial
  ADD COLUMN received_weight_g   numeric(10,3);   -- shop receipt partial (mismatch)
```

**Semantics:**
- Both nullable; NULL = packet-count mode (existing behaviour)
- Only meaningful for products with `weight_unit IN ('g','kg')`
- **`dispatched_weight_g` and `dispatched_qty` are mutually exclusive per
  line** — pick one representation. Add a CHECK constraint.

```sql
ALTER TABLE stock_request_items
  ADD CONSTRAINT chk_dispatch_qty_xor_weight
    CHECK (
      dispatched_qty IS NULL
      OR dispatched_weight_g IS NULL
    );
```

Same rule for received side (`received_qty` XOR `received_weight_g`).

### `shop_inventory.on_hand` — no schema change needed

Column is already `numeric(12,3)`. Fractional receipts (e.g. 3.5 packets)
add cleanly. Stock-take handles the "3.5" system_qty display as-is.

### `shop_inventory_movements.qty_delta` — no schema change

Also numeric. Partial receipts write `qty_delta = weight_g / pack_g`.
Movement type stays `Receipt`.

## Valuation formula (used everywhere)

**Per-line dispatched-value derivation** — canonical formula in every
Accounts SP and the receipt/audit surface:

```sql
CASE
  -- Partial dispatch takes precedence (either was chosen, not both)
  WHEN it.dispatched_weight_g IS NOT NULL AND it.weight_value > 0 THEN
    it.dispatched_weight_g
      / (it.weight_value * CASE it.weight_unit WHEN 'kg' THEN 1000 ELSE 1 END)
      * it.unit_price
  ELSE
    COALESCE(it.received_qty, it.dispatched_qty, it.requested_qty) * it.unit_price
END
```

**Per-line dispatched-qty derivation** (for stock movement into shop
inventory + total_dispatched_qty rollups):

```sql
CASE
  WHEN it.dispatched_weight_g IS NOT NULL AND it.weight_value > 0 THEN
    it.dispatched_weight_g
      / (it.weight_value * CASE it.weight_unit WHEN 'kg' THEN 1000 ELSE 1 END)
  ELSE
    COALESCE(it.received_qty, it.dispatched_qty, it.requested_qty)
END
```

Received-side is analogous.

## SPs to update

**Dispatch flow:**
- `fn_request_dispatch` — accept `dispatched_weight_g` in items JSON;
  validate XOR against dispatched_qty; write into shop_inventory via the
  qty-derivation formula above
- `fn_request_dispatch_save_draft` — same, WIP version
- `fn_request_receive` — accept `received_weight_g`; on mismatch, still
  writes an audit adjustment (delta_amount computed via new valuation)

**Detail / list:**
- `fn_request_get` — return both new columns per item
- `fn_request_get_shop_draft` (wrapper — already needs the wider RETURNS
  TABLE alignment from the earlier 22-Jul fix)
- `fn_request_list_paged` — total_dispatched_qty needs to sum fractional
  from partial-weight rows; total_dispatched_amount uses valuation
  formula

**Accounts (P&L side — the "tally aaganum" part):**
- `fn_accounts_summary` — dispatched_amount + net_amount use valuation
  formula; purchase_amount uses qty-derivation formula
- `fn_accounts_trend` — same, per bucket
- `fn_accounts_by_shop` — same, per shop
- `fn_accounts_by_category` — same, per category
- `fn_accounts_top_products` — same, per product
- `fn_accounts_adjustments` — audit log's delta_amount uses valuation

**Movement / inventory:**
- `fn_shop_inventory_apply_movement` — accepts numeric qty_delta already
  (no change), just called with the fractional number by fn_request_receive
- `fn_shop_inventory_movement_summary` — total_qty rollups need to work
  with fractional numeric (probably already do, verify)

**Audit:**
- `fn_request_edit_audit_write` — if edit changed dispatched_weight_g
  instead of dispatched_qty, delta_amount computed via valuation

## BE changes

### Entities
- `StockRequestItem.cs` — add `Dispatched_Weight_G`, `Received_Weight_G`
  (nullable decimal)

### DTOs
- `StockRequestItemDto` (contract to FE) — add `dispatchedWeightG`,
  `receivedWeightG`
- `DispatchLineRequest` — add `dispatchedWeightG?`
- `ReceiveConfirmLineRequest` — add `receivedWeightG?`

### Validators
- Dispatch validator: XOR check on `dispatchedQty` vs `dispatchedWeightG`
- Weight range: `> 0` when set
- Product-side check: partial-weight only when `weight_unit IN ('g','kg')`

### Services
- `StockRequestService.DispatchAsync` — pass new fields through to SP
- `AccountsService.*` — no code change (SP does math)

### Utility
- Shared helper `ComputeLineDispatchedAmount(item)` in whichever central
  place delta_amount / values are computed BE-side (used by any BE-side
  export path that doesn't go through the SP)

## FE changes

### `InventoryRequestDetail.tsx` (godown dispatch screen) — main new UI

Per line, current input = integer `dispatched_qty`. New UX per row:

```
┌──────────────────────────────────────────────┐
│ Product | Req qty | [Full ▪️ Partial]        │
│                                              │
│ FULL mode:      [ 3 ] packets                │
│ PARTIAL mode:   [ 3500 ] g  (3.5 kg)         │
│                                              │
│ (Full/Partial toggle disabled if product     │
│  weight_unit not g/kg — packet count only)   │
└──────────────────────────────────────────────┘
```

Same toggle pattern as the Return-config dialog on ShopRequestNew
(`isPartial = line.returnWeightG != null`). Reuse the mental model.

### `ShopRequestDetail.tsx` — display

- "Dispatched" column shows either "3 packets" or "3 packets + 500g"
  (or "3.5 kg") based on which field is populated
- Value display uses computed line-value
- Shop's receive-confirm dialog: if dispatch was partial, allow shop
  to correct received_weight_g (same input pattern as return-partial)

### `AdminRequestDetail.tsx` — display + edit

- Same display logic
- Admin quantity edit dialog: allows partial-weight edits post-dispatch
  (same UX)

### List screens (`ShopRequests`, `AdminRequests`, `InventoryRequests`)

- Dispatched cell renders via shared formatter (new util)
- Shortfall calc: `requested_qty × pack_g − dispatched_weight_g` when
  partial

### Shared FE utility

`utils/formatDispatched.ts`:
```ts
export function formatDispatched(item: {
  dispatchedQty: number | null
  dispatchedWeightG: number | null
  weightValue: number | null
  weightUnit: string | null
}): string {
  if (item.dispatchedWeightG != null && item.weightValue && item.weightUnit) {
    return formatWeight(item.dispatchedWeightG, item.weightValue, item.weightUnit)
  }
  return item.dispatchedQty != null ? `${item.dispatchedQty} pack${item.dispatchedQty === 1 ? '' : 's'}` : '—'
}
```

### Types
- `api/stock-requests/types.ts` — add fields to `StockRequestItemDto`,
  `DispatchLineRequest`, `ReceiveConfirmLineRequest`

## Accounts tally — the "reflect in Accounts" ask

Once the SPs above land:

| KPI / Column | Before | After |
|---|---|---|
| Dispatched (at MRP) | Σ qty × price | Σ valuation per line (packet or partial) |
| Returns (at MRP) | Σ qty × price | Same for Return-partial (already works today) |
| Net (at MRP) | Dispatched − Returns | Same, via new valuation |
| Purchased (at Cost) | Σ qty × cost_snapshot | Σ qty-derivation × cost_snapshot |
| By Shop table | Per-shop rollups | Per-shop with mixed packet + partial |
| By Category / Top Products | Per-category / per-product | Same |
| Trend chart | Daily buckets | Same |
| Adjustments log | delta_amount | New delta accounts for partial edits |

**Every KPI, table, chart, and export will show the correct MRP + cost
figures for partial dispatches automatically** because valuation is
computed in the SPs, not the FE.

## Migration plan — sequence for a clean rollout

1. **DB baseline update** — `phase2_procedures.sql`, `phase3_procedures.sql`
   updates in place + a one-shot for UAT/PROD
2. **BE entities + DTOs + validators** — schema-level changes first
3. **BE services** — pass-through
4. **FE types + hooks** — schema alignment
5. **FE inventory dispatch screen** — the new UI
6. **FE display screens (shop / admin) + shared formatter** — read side
7. **FE receive-confirm dialog** — partial-weight receipt
8. **Manual QA matrix** — 6 scenarios below, then merge

### QA matrix

| # | Scenario | Expected |
|---|---|---|
| 1 | Full-pack dispatch (existing) | Unchanged — dispatched_qty only |
| 2 | Partial dispatch, shop receives full | dispatched_weight_g set; shop_inventory += weight_g/pack_g; Accounts uses valuation |
| 3 | Partial dispatch, shop reports mismatch | received_weight_g set; audit adjustment on delta_amount |
| 4 | Partial edit post-dispatch (admin) | delta_amount uses valuation |
| 5 | Return of partial-dispatched line | Existing return_weight_g flow — no change |
| 6 | Mixed request (some lines full, some partial) | Rollups work; UI shows mixed display cleanly |

### Estimated effort

- DB SP updates: ~1 day (careful edits, 12+ SPs)
- BE entities/DTOs/validators/services: ~0.5 day
- FE inventory dispatch UI: ~0.75 day
- FE display + shared formatter: ~0.5 day
- FE receive-confirm partial: ~0.5 day
- QA + fixes: ~0.75 day

**Total: ~4 dev days.**

## Open decisions — need sign-off before starting

1. **Mutually-exclusive rule OK?** Per line: either `dispatched_qty` OR
   `dispatched_weight_g`, never both. Simpler; matches return-partial.
   → Recommend YES.
2. **Received-weight column too?** Do we let shop confirm partial receipt
   with `received_weight_g` (transit loss on a partial dispatch)?
   → Recommend YES — otherwise transit-damage on a partial dispatch is
   silently absorbed. Symmetric with existing received_qty for full packs.
3. **Product constraint** — should the "Partial" toggle be hidden on
   products where `weight_unit NOT IN ('g','kg')` (e.g. unit='pack' or
   unit='piece')? → Recommend YES; disable the toggle for non-weight SKUs.
4. **Zero-partial edge** — a shop asks for 5 packs, godown enters
   `dispatched_weight_g = 0` (nothing available). Should that be blocked
   or allowed (0 = "explicitly nothing")? → Recommend BLOCK; users should
   pick "not dispatched" instead of a zero-weight dispatch. Use existing
   dispatched_qty=0 semantics.
5. **Value rounding** — display 3500 g as "3.5 kg" or "3,500 g"? What
   about 3502 g? → Recommend show kg when ≥ 1000 g and round to 2
   decimals ("3.50 kg"); show g when < 1000 ("500 g"). Add a shared util.
6. **Order of accounts SPs update** — parallel rollout OK, or sequenced?
   → All SPs update in ONE commit + ONE one-shot script since valuation
   is shared; can't half-adopt.
