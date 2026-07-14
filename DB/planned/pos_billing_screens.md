# POS Billing — Screens Needed (Suggestions)

> Drafted from mockup review (`mockups/pos-billing-mock.html`) vs spec
> (`DB/planned/pos_billing.md`). Lists all screens required, with suggestions
> for items not yet in the approved spec.

## Admin / Setup (prerequisite)

1. **Products form — add Barcode field**
   - Suggestion: two buttons — "Scan to capture" (for branded goods) and
     "Generate code" (for in-house items using existing product code).
2. **`/print/barcode-labels`** (new)
   - Bulk sticker/label sheet generator for in-house products.
3. **`AdminShopStock.tsx`** (new)
   - Per-shop on-hand stock table with inline adjust action.
4. **Opening-stock bulk import**
   - Dialog on same page, CSV/Excel import (reuse existing import pattern).

## ShopUser / Counter (core POS)

5. **`/shop/pos`** — Main billing screen
   - Scan zone (primary), manual-add tile picker (fallback for jar/loose
     items), on-screen numeric keypad, cart panel, GST toggle, totals,
     Complete Sale button.
6. **`/print/pos-sale/:id/thermal`**
   - Receipt print — item lines, GST split, total, no customer name.
7. **`/shop/pos-sales`** (new)
   - Sales history / bill list for the shop — reprint, void actions.
8. **`/shop/pos-sales/:id`** (new)
   - Bill detail — line items, totals, Void button (with reason).

## Suggested Additions (seen in mockup, need spec sign-off)

9. **Offline mode banner + sync queue**
   - Suggestion: simple local queue for bills when network drops, auto-sync
     when connection returns. Avoid full offline DB — keep it lightweight.
10. **Add Expense modal**
    - Suggestion: useful for petty cash tracking at the counter. Keep
      optional / toggleable per shop rather than mandatory.
11. **Count Cash Drawer (day-end reconciliation)**
    - Suggestion: make this a separate `/shop/cash-count` screen (not just a
      modal) so counts are reportable/auditable over time.
12. **Language toggle (EN / Tamil)**
    - Suggestion: scope to POS screen + receipt only for v1, not full app
      i18n — smaller effort, matches actual counter-staff need.

## Next Steps

- Get client confirmation on items 9–12 before backend/schema work starts.
- Cross-check with open decisions already listed in `pos_billing.md`
  (oversell policy, void window, bill code prefix, hold durability,
  discounts, barcode format, jar quick-pick).
