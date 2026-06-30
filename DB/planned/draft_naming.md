# Draft Naming (godown dispatch drafts)

> **Status:** Planned — not built. Spec finalised 30-Jun-2026. Build cost
> ~2 hours; can be picked up any time after the back-order feature.

## Problem

The godown can keep up to ~10 dispatch drafts open at once (one per
in-flight stock request). Today the resume strip identifies each draft only
by its REQ code and shop name. When 6–8 drafts pile up the godown user
can't tell at a glance which one is "the morning Anna Nagar batch" vs
"the one waiting on pickle". They want a free-text label.

## Field

| Item | Value |
|---|---|
| Column | `stock_requests.draft_name VARCHAR(60)` |
| Nullable | yes — existing drafts and unnamed new ones stay `NULL` |
| Validation | trim whitespace; treat empty string as `NULL`; 60-char cap |
| Cleared when | request leaves draft state — `fn_stock_request_dispatch` and `fn_dispatch_draft_clear` set it to `NULL` alongside the qty fields |

No new table — the draft state already lives on the request row
(`draft_dispatched_qty`, `draft_updated_at`, etc.), so the name lives with it.

### SPs to touch

- `fn_dispatch_draft_save` — add optional `p_draft_name TEXT` parameter,
  write to the column.
- `fn_dispatch_draft_list` — include `draft_name` in the projection.
- `fn_dispatch_draft_clear` — already NULLs draft state; just add the new
  column to the same UPDATE.

## UI placement

### Resume strip — single draft

```
📝  ┃Morning dispatch — Anna Nagar batch┃  ✏️           [Resume]
    REQ0010 · SHP001 · 16 products · 78 units · Last saved 12:19pm
```

- **Title shows `draft_name`** when set, else falls back to today's
  `Resume dispatch draft — REQ####` text so the strip still reads well
  unnamed.
- **REQ code moves into the subtitle** as the first chip — always
  visible, regardless of whether a name is set.
- **Pencil icon next to the title** opens an inline `TextField`. Enter /
  blur saves; Esc / a small `×` reverts. Fires the existing
  `useSaveDispatchDraft` mutation with `{ draftName }` — same call site as
  auto-save, so persistence is free.
- **Empty-name placeholder** in the inline input: `Name this draft
  (optional)`.

### Resume strip — multiple drafts (expanded)

```
📝  3 dispatch drafts saved                                    [^ collapse]
┌──────────────────────────────────────────────────────────────────┐
│ 🔎 Filter by name…                                              │
├──────────────────────────────────────────────────────────────────┤
│ Morning dispatch — Anna Nagar batch     ✏️            [Resume]   │
│ REQ0010 · SHP001 · 16 products · 78 units · 12:19pm             │
├──────────────────────────────────────────────────────────────────┤
│ Waiting on pickle delivery               ✏️            [Resume]   │
│ REQ0011 · SHP004 · 8 products · 35 units · 11:50am              │
├──────────────────────────────────────────────────────────────────┤
│ Resume dispatch draft — REQ0009          ✏️            [Resume]   │
│ REQ0009 · SHP002 · 4 products · 12 units · 10:05am              │
└──────────────────────────────────────────────────────────────────┘
```

- **Search box at the top of the expanded list** — FE-only filter,
  case-insensitive substring match against `draft_name` (plus REQ code
  and shop name so unnamed drafts can still be searched by code or
  shop). No new API.
- Each row has the same name + pencil pattern as the single-draft strip.

### Save-as-Draft button (sticky bottom bar)

**No change.** Saves keep firing without prompting — naming is opt-in
and asynchronous. Most drafts won't get named at save time; the godown
adds a name later from the resume strip when they want to identify it.

### Permissions

**Any godown user can rename.** Dispatch is a shared workload, so any
inventory-role user with access to the request can edit the name. No
"created by" lock.

### Audit / history

**No audit trail for renames.** The value of naming is identification,
not history; tracking who changed the name when adds churn for no real
benefit at 10-draft scale.

## Build cost

| Layer | Effort |
|---|---|
| DB migration (1 column + 3 SP touches) | under 1 hour |
| BE (param through `SaveDispatchDraftRequest` DTO → repository → SP) | ~30 min |
| FE (pencil + inline TextField on the resume strip, search box on the expanded list, DTO type) | ~1 hour |
| **Total** | **~2½ hours** of build + test |

## Notes for the build pass

- The pencil icon should be visible (not hover-only) on touch devices —
  hover-to-reveal would hide the affordance on the godown's tablet.
- When the inline edit is open, **don't** auto-collapse the strip if
  the user is actively typing — let blur or Enter commit.
- The 60-char cap is generous; treat it as a hard limit (HTML `maxLength`)
  rather than a soft warning.
- Search box on the multi-draft list should debounce ~150ms — cheap, but
  avoids re-rendering on every keystroke when there are 10 drafts.
