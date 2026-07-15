import { useMemo, useState } from 'react'
import { Box, Button, Card, CardContent, CircularProgress, Tooltip, Typography } from '@mui/material'
import { DataGrid, type GridColDef } from '@mui/x-data-grid'
import { Download } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import type {
  AccountsFilters,
  AccountsShopRowDto,
  AccountsUtilityRowDto,
  AccountsView,
} from '../../api/accounts/types'
import { accountsExport } from '../../api/accounts/api'
import { utilitiesByShop as utilitiesByShopSelector } from '../../hooks/useAccounts'
import { formatINR } from '../../utils/format'
import {
  BreakdownCard,
  BreakdownDivider,
  BreakdownResult,
  BreakdownRow,
  BreakdownSignedSubtotal,
  BreakdownSumTotal,
  brandTooltipSlotProps,
} from './BreakdownTooltip'

type Props = {
  rows: AccountsShopRowDto[] | undefined
  loading: boolean
  filters: AccountsFilters
  /** Raw per-shop-per-category utility rows for the current range
   *  (15-Jul-2026). Optional — when undefined the Utilities / Net P&L
   *  columns are hidden entirely. We accept the raw rows (not a
   *  pre-summed map) so the hover tooltips can break down utilities by
   *  category without needing a second prop. */
  utilityRows?: AccountsUtilityRowDto[]
}

/**
 * Per-shop breakdown. Default sort = shop name (alphabetical). Clicking a
 * row jumps to the AdminRequests page filtered to that shop + the current
 * date range — the natural drill-down for "which requests made up this row?".
 *
 * Numeric columns use fixed widths (no flex) so a narrow viewport overflows
 * into the DataGrid's horizontal scrollbar instead of squishing the cells;
 * only the Shop name column flexes.
 */
export default function ShopBreakdownTable({ rows, loading, filters, utilityRows }: Props) {
  const navigate = useNavigate()
  const view: AccountsView = filters.view ?? 'all'
  // Excel export typically takes 2-5 seconds (BE renders the .xlsx +
  // streams it). Show a spinner during that window so the admin knows
  // the click registered.
  const [exporting, setExporting] = useState(false)

  // Fast-lookup map for per-shop utility totals — derived once per rows
  // change instead of summing inside every column's valueGetter/renderCell.
  // Filter-by-shop for the per-category hover tooltip stays cheap (small
  // arrays, only one tooltip renders at a time).
  const utilByShop = useMemo(
    () => utilityRows ? utilitiesByShopSelector(utilityRows) : undefined,
    [utilityRows],
  )

  // Full column set tagged by which view(s) it belongs to. Filtered before
  // handing to DataGrid so each view shows only its dimensional columns
  // (19-Jun-2026, client #13).
  type ShopCol = GridColDef<AccountsShopRowDto> & { showIn: ReadonlyArray<AccountsView> }
  const ALL: ReadonlyArray<AccountsView> = ['all', 'requested', 'dispatched', 'returns', 'purchased']
  const fmt = (v: unknown) => formatINR(v as number)

  const allColumns: ShopCol[] = [
    { field: 'shopCode',  headerName: 'Code',  width: 90,  showIn: ALL },
    { field: 'shopName',  headerName: 'Shop',  flex: 1, minWidth: 160, showIn: ALL },
    // Counts: Orders count belongs to requested / dispatched / purchased.
    { field: 'orderRequestCount',  headerName: 'Orders',   type: 'number', width: 85,
      showIn: ['all', 'requested', 'dispatched', 'purchased'] },
    { field: 'returnRequestCount', headerName: 'Returns',  type: 'number', width: 85,
      showIn: ['all', 'returns'] },
    // Quantities: physical qty travels with dispatched/purchased (same physical
    // units — the only thing that differs is the amount column's basis).
    { field: 'requestedQty',       headerName: 'Req Qty',      type: 'number', width: 95,
      showIn: ['all', 'requested'] },
    { field: 'dispatchedQty',      headerName: 'Disp Qty',     type: 'number', width: 95,
      showIn: ['all', 'dispatched', 'purchased'] },
    { field: 'returnedQty',        headerName: 'Returned Qty', type: 'number', width: 115,
      showIn: ['all', 'returns'] },
    // Amounts. Purchased (at Cost) leads the money columns per the client
    // ask (12-Jul-2026) — cost before the retail figures.
    { field: 'purchaseAmount',   headerName: 'Purchased (Cost)', type: 'number', width: 150,
      valueFormatter: fmt, showIn: ['all', 'dispatched', 'purchased'] },
    { field: 'requestedAmount',  headerName: 'Requested (MRP)',  type: 'number', width: 150,
      valueFormatter: fmt, showIn: ['all', 'requested'] },
    // Dispatched (MRP) shows in 'purchased' too — the revenue side of the
    // P&L pair. Client needs to see both cost + expected revenue to make
    // sense of the profit/loss column at the end.
    { field: 'dispatchedAmount', headerName: 'Dispatched (MRP)', type: 'number', width: 155,
      valueFormatter: fmt, showIn: ['all', 'dispatched', 'purchased'] },
    { field: 'returnsAmount',    headerName: 'Returns (MRP)',    type: 'number', width: 135,
      valueFormatter: fmt, cellClassName: 'returns-cell',
      showIn: ['all', 'returns'] },
    // Adjustments (MRP) — visible in 'purchased' too since qty edits
    // already flow into both Dispatched (MRP) and Purchased (Cost),
    // and client wants full context for the P&L number.
    { field: 'adjustmentsAmount', headerName: 'Adjustments (MRP)', type: 'number', width: 160,
      valueFormatter: fmt, showIn: ['all', 'dispatched', 'purchased'] },
    // Net (MRP) — visible on 'all' + 'purchased' (needed to explain the
    // Profit/Loss column: P&L = Net − Purchased).
    // Net (MRP) — same tooltip treatment as Gross P&L / Net P&L: hovering
    // shows the derivation (Dispatched − Returns = Net) for this shop.
    // cellClassName preserved so the parent 'net-cell' CSS rule still
    // paints the value in bold.
    { field: 'netAmount', headerName: 'Net (MRP)', type: 'number', width: 140,
      cellClassName: 'net-cell',
      showIn: ['all', 'purchased'],
      renderCell: ({ row }) => (
        <NetMrpRowTooltip row={row}>
          <span>{formatINR(row.netAmount)}</span>
        </NetMrpRowTooltip>
      ),
    },
    // Profit / Loss column (12-Jul-2026 client req) — SP returns the pair as
    // two mutually-exclusive columns (exactly one is non-zero per row). We
    // display it as ONE column: green +₹ when profit, red −₹ when loss.
    // Value = profit − loss so DataGrid can sort numerically end-to-end
    // (positive = profit, negative = loss, zero = break-even).
    //
    // Shown on 'all' + 'purchased' (both include cost + revenue, so P&L
    // reconciles). Hidden on the pure-dimension lenses ('requested' /
    // 'dispatched' / 'returns' single-side) which don't have both halves.
    { field: 'profitLoss', headerName: 'Gross P&L', type: 'number', width: 130,
      showIn: ['all', 'purchased'],
      valueGetter: (_v, row) => (row.profit ?? 0) - (row.loss ?? 0),
      renderCell: ({ row }) => {
        const p = row.profit ?? 0
        const l = row.loss ?? 0
        const value = p > 0
          ? <span style={{ color: '#2E7D32', fontWeight: 700 }}>+{formatINR(p)}</span>
          : l > 0
            ? <span style={{ color: '#C62828', fontWeight: 700 }}>−{formatINR(l)}</span>
            : <span style={{ color: '#1F1F1F66' }}>—</span>
        return <GrossPnLTooltip row={row}>{value}</GrossPnLTooltip>
      },
    },
    // Utilities (15-Jul-2026) — shop operating expenses in range. Feeds
    // Net P&L below. Rendered only when utilityRows was supplied (see the
    // filter after the array). Shops absent from the map = ₹0.
    { field: 'utilitiesAmount', headerName: 'Shop Expenses', type: 'number', width: 145,
      showIn: ['all', 'purchased'],
      valueGetter: (_v, row) => utilByShop?.get(row.shopId) ?? 0,
      renderCell: ({ row }) => {
        const u = utilByShop?.get(row.shopId) ?? 0
        const value = u > 0
          ? <span style={{ color: '#8A6D3B', fontWeight: 600 }}>{formatINR(u)}</span>
          : <span style={{ color: '#1F1F1F66' }}>—</span>
        // No tooltip when the shop has zero utilities in range — nothing
        // to break down.
        if (u === 0) return value
        return (
          <UtilitiesTooltip row={row} utilityRows={utilityRows ?? []}>
            {value}
          </UtilitiesTooltip>
        )
      },
    },
    // Net P&L (15-Jul-2026) — Gross P&L minus Utilities. Same signed
    // display convention as Gross P&L: positive = green, negative = red.
    // Sorted / filtered numerically via valueGetter's signed number.
    { field: 'netProfitLoss', headerName: 'Net P&L', type: 'number', width: 130,
      showIn: ['all', 'purchased'],
      valueGetter: (_v, row) => {
        const gross = (row.profit ?? 0) - (row.loss ?? 0)
        const util  = utilByShop?.get(row.shopId) ?? 0
        return gross - util
      },
      renderCell: ({ row }) => {
        const gross = (row.profit ?? 0) - (row.loss ?? 0)
        const util  = utilByShop?.get(row.shopId) ?? 0
        const net   = gross - util
        const value = net > 0
          ? <span style={{ color: '#2E7D32', fontWeight: 700 }}>+{formatINR(net)}</span>
          : net < 0
            ? <span style={{ color: '#C62828', fontWeight: 700 }}>−{formatINR(Math.abs(net))}</span>
            : <span style={{ color: '#1F1F1F66' }}>—</span>
        return <NetPnLTooltip row={row} utilities={util}>{value}</NetPnLTooltip>
      },
    },
  ]
  const columns = allColumns
    .filter(c => c.showIn.includes(view))
    // Hide utilities-derived columns entirely when the caller didn't
    // fetch utilities data — matches the KpiStrip behaviour so pages
    // that don't opt in stay unchanged.
    .filter(c => utilByShop != null
                 || (c.field !== 'utilitiesAmount' && c.field !== 'netProfitLoss'))

  return (
    <Card sx={{ border: '2px solid #1F1F1F', boxShadow: '4px 4px 0 0 #FCD835', background: '#FFFBE6' }}>
      <CardContent>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1.5 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>By shop</Typography>
          <Button
            size="small"
            variant="outlined"
            startIcon={exporting ? <CircularProgress size={14} thickness={5} sx={{ color: 'inherit' }} /> : <Download size={16} />}
            onClick={async () => {
              if (exporting) return
              setExporting(true)
              try { await accountsExport.byShop(filters) }
              finally { setExporting(false) }
            }}
            disabled={exporting || loading || !rows || rows.length === 0}
            sx={{ textTransform: 'none', fontWeight: 600 }}
          >
            {exporting ? 'Preparing…' : 'Export Excel'}
          </Button>
        </Box>
        <Box sx={{ '& .net-cell': { fontWeight: 700 }, '& .returns-cell': { color: '#C62828' } }}>
          <DataGrid
            className="data-page-grid"
            rows={rows ?? []}
            columns={columns}
            getRowId={(r) => r.shopId}
            loading={loading}
            disableRowSelectionOnClick
            disableColumnMenu
            density="compact"
            autoHeight
            initialState={{
              sorting: { sortModel: [{ field: 'shopName', sort: 'asc' }] },
              pagination: { paginationModel: { pageSize: 25 } },
            }}
            pageSizeOptions={[10, 25, 50, 100]}
            onRowClick={(p) => {
              // Drill-down: open AdminRequests filtered to that shop + range.
              // 19-Jun-2026 (client #13): when an Accounts view-mode is
              // active, also propagate a request-type preset so the
              // destination page shows the SAME slice the user clicked.
              //   • Returns view              → preset=return (Return-type only)
              //   • Requested / Dispatched   → preset=received (Received Orders —
              //                                 the only Orders Accounts counts)
              //   • All view                 → no preset (everything)
              const q = new URLSearchParams()
              q.set('shopId', String(p.row.shopId))
              q.set('from',   filters.from)
              q.set('to',     filters.to)
              if (view === 'returns')                            q.set('preset', 'return')
              else if (view === 'requested' || view === 'dispatched' || view === 'purchased') q.set('preset', 'received')
              navigate(`/admin/requests?${q.toString()}`)
            }}
            sx={{
              border: 'none',
              backgroundColor: 'transparent',
              '& .MuiDataGrid-row': { cursor: 'pointer' },
            }}
          />
        </Box>
      </CardContent>
    </Card>
  )
}

// ══════════════════ Breakdown tooltip infrastructure ══════════════════
//
// Premium hover cards in the Kovilpatti brand palette — cream ground,
// 2px black border, offset gold drop-shadow, dark text. Same visual
// language as the KPI cards / DataGrid so tooltips read as "part of
// the app", not floating dev overlays.
//
// Three tooltips share the same shell + row/divider primitives:
//   • GrossPnLTooltip  — hover on Gross P&L cell
//        Dispatched − Returns → Net → − Purchased → Gross P&L
//   • UtilitiesTooltip — hover on Utilities cell
//        per-category rows (Rent, Electricity, …) → total
//   • NetPnLTooltip    — hover on Net P&L cell (full derivation chain)
//        Dispatched − Returns → Net → − Purchased → Gross → − Utilities → Net P&L

/** MUI Tooltip wrapper with our brand slot styling.
 *
 *  The children arg is the raw cell value (spans etc.) — we wrap it in
 *  our own <Box> so:
 *    1. MUI Tooltip gets a real DOM-backed element (Box forwards refs
 *       natively) as its anchor. A plain function-component child would
 *       silently no-op because MUI has nothing to observe.
 *    2. The dashed underline hover cue lives on the same Box, so there's
 *       no wrapper-component ref-forwarding hoop to jump through.
 *
 *  slotProps.tooltip: strips MUI's default dark padding/bg so the child
 *  BreakdownCard owns all visual weight.
 *  slotProps.arrow:   tints the arrow cream + black hairline so the
 *  pointer visually extends the card's 2px black frame. */
/** Cell-level tooltip wrapper. Uses the shared brand slot styling and
 *  wraps children in an inline <Box component="span"> with a dashed
 *  underline hover cue so table cells discover the tooltip when scanned.
 *  For card-level tooltips (whole card is the anchor), wrap a <Card>
 *  directly in <Tooltip slotProps={brandTooltipSlotProps} ...> — no
 *  underline cue needed there. */
function BrandTooltip({ children, content }: {
  children: React.ReactNode
  content: React.ReactNode
}) {
  return (
    <Tooltip
      arrow
      placement="top"
      enterDelay={200}
      leaveDelay={100}
      title={content}
      slotProps={brandTooltipSlotProps}
    >
      <Box
        component="span"
        sx={{
          display: 'inline-flex', alignItems: 'center',
          borderBottom: '1px dashed transparent',
          transition: 'border-color 120ms ease',
          '&:hover': { borderBottomColor: '#1F1F1F55' },
        }}
      >
        {children}
      </Box>
    </Tooltip>
  )
}

// ══════════════════ Gross P&L breakdown ══════════════════

function GrossPnLTooltip({ row, children }: {
  row: AccountsShopRowDto
  children: React.ReactNode
}) {
  const dispatched = row.dispatchedAmount ?? 0
  const returns    = row.returnsAmount    ?? 0
  const net        = row.netAmount        ?? 0
  const cost       = row.purchaseAmount   ?? 0
  const gross      = (row.profit ?? 0) - (row.loss ?? 0)
  const resultLabel = gross > 0 ? 'Gross Profit' : gross === 0 ? 'Break-even' : 'Gross Loss'

  return (
    <BrandTooltip
      content={
        <BreakdownCard title="Gross P&L Breakdown" subtitle={row.shopName}>
          <BreakdownRow op=""  label="Dispatched (MRP)" value={dispatched} tone="input" />
          <BreakdownRow op="−" label="Returns (MRP)"    value={returns}    tone="subtract" />
          <BreakdownDivider dashed />
          <BreakdownRow op=""  label="Net (MRP)"        value={net}        tone="subtotal" />
          <BreakdownRow op="−" label="Purchased (Cost)" value={cost}       tone="subtract" />
          <BreakdownDivider />
          <BreakdownResult label={resultLabel} signed={gross} />
        </BreakdownCard>
      }
    >
      {children}
    </BrandTooltip>
  )
}

// ══════════════════ Utilities breakdown ══════════════════

function UtilitiesTooltip({ row, utilityRows, children }: {
  row: AccountsShopRowDto
  utilityRows: AccountsUtilityRowDto[]
  children: React.ReactNode
}) {
  // Rows for this shop only, biggest bill first. `expense_count` reveals
  // when the same category was logged multiple times in the range — we
  // show it as a subtle "×N" chip after the label rather than a separate
  // column so the two-column grid stays tight.
  const shopRows = utilityRows
    .filter(r => r.shopId === row.shopId)
    .sort((a, b) => b.amount - a.amount)
  const total = shopRows.reduce((s, r) => s + r.amount, 0)

  return (
    <BrandTooltip
      content={
        <BreakdownCard title="Shop Expenses Breakdown" subtitle={row.shopName}>
          {shopRows.map(r => (
            <BreakdownRow
              key={r.category}
              op=""
              label={r.expenseCount > 1 ? `${r.category}  ×${r.expenseCount}` : r.category}
              value={r.amount}
              tone="input"
            />
          ))}
          <BreakdownDivider />
          <BreakdownSumTotal label="Total Shop Expenses" value={total} />
        </BreakdownCard>
      }
    >
      {children}
    </BrandTooltip>
  )
}

// ══════════════════ Net (MRP) row breakdown ══════════════════

function NetMrpRowTooltip({ row, children }: {
  row: AccountsShopRowDto
  children: React.ReactNode
}) {
  const dispatched = row.dispatchedAmount ?? 0
  const returns    = row.returnsAmount    ?? 0
  const net        = row.netAmount        ?? 0

  return (
    <BrandTooltip
      content={
        <BreakdownCard title="Net (MRP) Breakdown" subtitle={row.shopName}>
          <BreakdownRow op=""  label="Dispatched (MRP)" value={dispatched} tone="input" />
          <BreakdownRow op="−" label="Returns (MRP)"    value={returns}    tone="subtract" />
          <BreakdownDivider />
          <BreakdownResult label="Net (at MRP)" signed={net} />
        </BreakdownCard>
      }
    >
      {children}
    </BrandTooltip>
  )
}

// ══════════════════ Net P&L breakdown ══════════════════

function NetPnLTooltip({ row, utilities, children }: {
  row: AccountsShopRowDto
  utilities: number
  children: React.ReactNode
}) {
  const dispatched = row.dispatchedAmount ?? 0
  const returns    = row.returnsAmount    ?? 0
  const net        = row.netAmount        ?? 0
  const cost       = row.purchaseAmount   ?? 0
  const gross      = (row.profit ?? 0) - (row.loss ?? 0)
  const netFinal   = gross - utilities
  const resultLabel = netFinal > 0 ? 'Net Profit' : netFinal === 0 ? 'Break-even' : 'Net Loss'

  return (
    <BrandTooltip
      content={
        <BreakdownCard title="Net P&L Breakdown" subtitle={row.shopName}>
          {/* Full derivation chain — client's ultimate answer, so we show
              the whole story instead of assuming they saw Gross P&L first. */}
          <BreakdownRow op=""  label="Dispatched (MRP)" value={dispatched} tone="input" />
          <BreakdownRow op="−" label="Returns (MRP)"    value={returns}    tone="subtract" />
          <BreakdownDivider dashed />
          <BreakdownRow op=""  label="Net (MRP)"        value={net}        tone="subtotal" />
          <BreakdownRow op="−" label="Purchased (Cost)" value={cost}       tone="subtract" />
          <BreakdownDivider dashed />
          {/* Gross P&L intermediate — bold subtotal with sign so a loss
              shows red without waiting for the final row. */}
          <BreakdownSignedSubtotal label="Gross P&L" signed={gross} />
          <BreakdownRow op="−" label="Shop Expenses"    value={utilities}  tone="subtract" />
          <BreakdownDivider />
          <BreakdownResult label={resultLabel} signed={netFinal} />
        </BreakdownCard>
      }
    >
      {children}
    </BrandTooltip>
  )
}

