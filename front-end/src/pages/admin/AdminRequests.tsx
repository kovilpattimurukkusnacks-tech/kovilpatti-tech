import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Search, Printer, Plus, X as XIcon } from 'lucide-react'
import { Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, InputAdornment, MenuItem, Paper, TextField, Tooltip } from '@mui/material'
import { DataGrid, type GridColDef } from '@mui/x-data-grid'
import PageHeader from '../../components/PageHeader'
import ConfirmDialog from '../../components/ConfirmDialog'
import { DispatchedCell } from '../../components/DispatchedCell'
import { AdjustmentQtyCell } from '../../components/AdjustmentQtyCell'
import { useAllStockRequests, useCumulativePending, useRequestCountByShop, useInventoryDispatchDrafts } from '../../hooks/useStockRequests'
import { SpecialRequestChip } from '../../components/SpecialRequestChip'
import { formatINR } from '../../utils/format'
import { formatIstDateTime } from '../../utils/formatDate'
import DateRangeFilter, { istToday, dateRangeLabel } from '../../components/DateRangeFilter'
import { FilterBar, FilterRow, FilterPanel, type FilterPill } from '../../components/FilterBar'
import type { RequestStatus, RequestType, StockRequestDto } from '../../api/stock-requests/types'
import '../Products.css'

// Consolidated into utils/statusChipStyle.ts so a color tweak lands in one place.
import { STATUS_COLOR, STATUS_CHIP_SX } from '../../utils/statusChipStyle'

// Quick-filter chip presets. `undefined` = show all statuses (default).
// Last preset "Return" (added 28 May 2026) filters by request_type and cuts
// across statuses so admin can see every Return in one place.
type Preset = {
  key: string
  label: string
  status?: RequestStatus
  requestType?: RequestType
  // 15-Jul-2026: opt-in for the admin "My Drafts" preset. When true, the
  // list request asks the BE to include admin's own status='Draft' rows.
  // Only used by the 'drafts' preset — every other row leaves it undefined
  // so the URL stays clean.
  includeDrafts?: boolean
  // 15-Jul-2026: is_special filter for the "Special Order" preset.
  // undefined = no filter (default); true = specials only.
  isSpecial?: boolean
}
const PRESETS: Preset[] = [
  { key: 'all',        label: 'All',        status: undefined    },
  { key: 'pending',    label: 'Pending',    status: 'Pending'    },
  { key: 'approved',   label: 'Approved',   status: 'Approved'   },
  { key: 'dispatched', label: 'Dispatched', status: 'Dispatched' },
  { key: 'received',   label: 'Received',   status: 'Received'   },
  { key: 'rejected',   label: 'Rejected',   status: 'Rejected'   },
  { key: 'cancelled',  label: 'Cancelled',  status: 'Cancelled'  },
  { key: 'return',     label: 'Return',     requestType: 'Return' },
  // "Special Order" — is_special=true regardless of status/type. Cuts
  // across the request lifecycle so admin can see every vendor-procurement
  // request in one place (15-Jul-2026 client req).
  { key: 'special',    label: 'Special Order', isSpecial: true },
  // "My Drafts" — admin's unfinished New Requests. Client asked for
  // draft visibility on the list so back-navigation doesn't feel like
  // work is lost (15-Jul-2026). Drafts are user-scoped server-side.
  { key: 'drafts',     label: 'My Drafts',  includeDrafts: true },
]

export default function AdminRequests() {
  const navigate = useNavigate()
  // Filter state lives in the URL so a round-trip to a detail page and back
  // restores exactly what the admin had set — defaults to today's date +
  // "All" preset on a fresh load. Keys are short so the URL stays readable
  // when shared (?preset=pending&q=REQ0042&from=...&to=...).
  const [params, setParams] = useSearchParams()

  const activePreset = params.get('preset')  ?? 'all'
  const shopId       = params.get('shopId')  ?? undefined
  const search       = params.get('q')       ?? ''
  const fromDate     = params.get('from')    ?? istToday()
  const toDate       = params.get('to')      ?? istToday()
  const page         = Number(params.get('page'))     || 0
  const pageSize     = Number(params.get('pageSize')) || 10

  // Filter controls collapsed by default; UI-only, doesn't belong in the URL.
  const [filtersOpen, setFiltersOpen] = useState(false)

  // Patch helper — merges a partial set of URL params on top of the current
  // ones. Pass undefined / '' to delete a key. `replace: true` means filter
  // changes don't pile up in browser history (Back still takes you off the
  // page, not back through every filter tweak).
  const patchParams = useCallback((patch: Record<string, string | undefined | null>) => {
    setParams(prev => {
      const next = new URLSearchParams(prev)
      for (const [k, v] of Object.entries(patch)) {
        if (v == null || v === '') next.delete(k)
        else next.set(k, v)
      }
      return next
    }, { replace: true })
  }, [setParams])

  const setActivePreset    = (key: string) => patchParams({ preset: key === 'all' ? undefined : key, shopId: undefined, page: undefined })
  const setShopId          = (id: string | undefined) => patchParams({ shopId: id ?? undefined, page: undefined })
  const setSearch          = (q: string)   => patchParams({ q, page: undefined })
  const paginationModel    = { page, pageSize }
  const setPaginationModel = (m: { page: number; pageSize: number }) =>
    patchParams({ page: m.page ? String(m.page) : undefined, pageSize: m.pageSize === 10 ? undefined : String(m.pageSize) })

  const currentPreset      = PRESETS.find(p => p.key === activePreset)
  const currentStatus      = currentPreset?.status
  const currentRequestType = currentPreset?.requestType
  const includeDrafts      = currentPreset?.includeDrafts ?? false
  const isSpecialFilter    = currentPreset?.isSpecial

  const handleDateChange = (from: string, to: string) => {
    // Keep today's defaults out of the URL — only persist when admin picks
    // a non-today date, so the URL stays clean on the common case.
    const today = istToday()
    patchParams({
      from: from === today ? undefined : from,
      to:   to   === today ? undefined : to,
      page: undefined,
    })
  }

  const list = useAllStockRequests({
    status: currentStatus,
    requestType: currentRequestType,
    shopId,
    search: search.trim() || undefined,
    page: paginationModel.page + 1,
    pageSize: paginationModel.pageSize,
    // My Drafts preset is date-scope-agnostic — drafts have no
    // submitted_at yet, so clamping to a date range would hide them.
    // The SP also bypasses the date filter for Draft rows, but skipping
    // it here keeps the URL clean and the badge count honest.
    fromDate: includeDrafts ? undefined : (fromDate || undefined),
    toDate:   includeDrafts ? undefined : (toDate   || undefined),
    includeDrafts: includeDrafts || undefined,
    isSpecial: isSpecialFilter,
  })

  // Per-shop badge counts for the active preset. Refetches whenever the
  // preset OR date range changes; shops with 0 matches are pruned server-side,
  // so counts always match the date-filtered grid.
  const shopCounts = useRequestCountByShop({
    status: currentStatus,
    requestType: currentRequestType,
    fromDate: fromDate || undefined,
    toDate: toDate || undefined,
  })

  // Admin sees all inventories — Print Cumulative button is enabled as long
  // as some Pending row exists anywhere across the system.
  const cumulative = useCumulativePending()
  const hasPending = (cumulative.data?.length ?? 0) > 0

  // Standalone Pending count (independent of the active preset / date filter)
  // — drives the confirmation dialog on the Print Cumulative button so admin
  // knows "N requests are still pending and won't be in this print" before
  // a tab opens. Matches the inventory-side gating (see InventoryRequests).
  const pendingShopCounts = useRequestCountByShop({ status: 'Pending' })
  const totalPending = useMemo(
    () => (pendingShopCounts.data ?? []).reduce((sum, r) => sum + r.requestCount, 0),
    [pendingShopCounts.data],
  )

  // Print Cumulative gating: only enabled on the Approved tab — the report
  // itself is scoped to status='Approved' rows, so allowing the print from
  // other tabs is semantically wrong. Mirrors the inventory-side rule.
  const isInProgressTab = activePreset === 'approved'
  const canPrintCumulative = isInProgressTab && hasPending
  const printCumulativeTooltip =
    !isInProgressTab ? 'Switch to Approved tab to print the batch plan'
    : !hasPending    ? 'No in-progress requests to print'
    : totalPending > 0
      ? `${totalPending} request${totalPending === 1 ? ' is' : 's are'} still pending — you'll get a confirmation first`
      : undefined

  const [printConfirmOpen, setPrintConfirmOpen] = useState(false)
  const [printSelectionOpen, setPrintSelectionOpen] = useState(false)
  const [selectedRequestIds, setSelectedRequestIds] = useState<Set<string>>(new Set())
  const [printShopFilter, setPrintShopFilter] = useState<string>('')

  // Fetch the Approved request list ONLY when the selection dialog is open —
  // keeps the list page's query pool lean. pageSize 200 covers realistic
  // queues even for tenant-wide admin scope without pagination.
  const approvedForSelection = useAllStockRequests({ status: 'Approved', pageSize: 200 })
  const approvedRows = approvedForSelection.data?.items ?? []

  // Distinct shops present in the approved queue — populates the filter
  // dropdown at the top of the selection dialog.
  const shopsInApproved = useMemo(() => {
    const map = new Map<string, string>()
    for (const r of approvedRows) map.set(r.shopId, r.shopName)
    return Array.from(map.entries())
      .map(([shopId, shopName]) => ({ shopId, shopName }))
      .sort((a, b) => a.shopName.localeCompare(b.shopName))
  }, [approvedRows])

  const visibleApprovedRows = useMemo(
    () => printShopFilter
      ? approvedRows.filter(r => r.shopId === printShopFilter)
      : approvedRows,
    [approvedRows, printShopFilter],
  )

  const openPrintCumulative = (ids?: string[]) => {
    const qs = new URLSearchParams()
    if (ids && ids.length) {
      qs.set('requestIds', ids.join(','))
      const idSet = new Set(ids)
      const shopNames = Array.from(new Set(
        approvedRows.filter(r => idSet.has(r.id)).map(r => r.shopName),
      )).sort()
      if (shopNames.length > 0) qs.set('shopNames', shopNames.join(', '))
    }
    const suffix = qs.toString() ? `?${qs.toString()}` : ''
    window.open(`/print/cumulative${suffix}`, '_blank', 'noopener,noreferrer')
  }

  const openPrintSelection = () => {
    setSelectedRequestIds(new Set(approvedRows.map(r => r.id)))
    setPrintShopFilter('')
    setPrintSelectionOpen(true)
  }

  const onPrintCumulativeClick = () => {
    if (totalPending > 0) setPrintConfirmOpen(true)
    else openPrintSelection()
  }

  useEffect(() => {
    if (!printSelectionOpen) return
    if (selectedRequestIds.size === 0 && approvedRows.length > 0) {
      setSelectedRequestIds(new Set(approvedRows.map(r => r.id)))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [printSelectionOpen, approvedRows.length])

  // Tenant-wide dispatch-drafts snapshot → "Draft" chip on list rows.
  // 02-Jul-2026. Admin sees the badge across every inventory's queue.
  const dispatchDrafts = useInventoryDispatchDrafts()
  const draftIdSet = useMemo(
    () => new Set(dispatchDrafts.data?.map(d => d.id) ?? []),
    [dispatchDrafts.data],
  )

  const rows  = list.data?.items ?? []
  const total = list.data?.total ?? 0

  const columns = useMemo<GridColDef<StockRequestDto>[]>(() => {
    const cols: GridColDef<StockRequestDto>[] = [
    {
      field: 'code', headerName: 'Code', width: 180, sortable: false, filterable: false,
      renderCell: ({ row }) => (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 600 }}>{row.code}</span>
          {row.requestType === 'Return' && (
            <Chip
              label="Return"
              size="small"
              variant="outlined"
              sx={{
                borderColor: '#C62828',
                color: '#C62828',
                fontWeight: 700,
                fontSize: 10,
                height: 20,
                letterSpacing: 0.5,
              }}
            />
          )}
          {row.isSpecial && <SpecialRequestChip size="small" compact label={row.specialLabel} />}
          {draftIdSet.has(row.id) && (
            <Chip
              label="Draft"
              size="small"
              variant="outlined"
              sx={{
                borderColor: '#C28A00',
                color: '#7C4A00',
                bgcolor: '#FFF8E1',
                fontWeight: 700,
                fontSize: 10,
                height: 20,
                letterSpacing: 0.5,
              }}
            />
          )}
        </Box>
      ),
    },
    {
      field: 'submittedByName', headerName: 'User', flex: 1, minWidth: 140, sortable: false, filterable: false,
      renderCell: ({ row }) =>
        row.submittedByName ?? <span className="text-[#1F1F1F]/40">—</span>,
    },
    {
      field: 'shopName', headerName: 'Shop', flex: 1, minWidth: 140, sortable: false, filterable: false,
    },
    {
      field: 'submittedAt', headerName: 'Submitted Time', flex: 1, minWidth: 170, sortable: false, filterable: false,
      renderCell: ({ value }) => value
        ? formatIstDateTime(value as string)
        : <span className="text-[#1F1F1F]/40">—</span>,
    },
  ]

  // Approved chip — surface when each request was approved, immediately
  // after the Submitted Time column so the pair reads as a timeline.
  // Hidden on every other preset (column would be a dash for Pending,
  // redundant for finalised states).
  if (activePreset === 'approved') {
    cols.push({
      field: 'approvedAt', headerName: 'Approved Time', flex: 1, minWidth: 170, sortable: false, filterable: false,
      renderCell: ({ value }) => value
        ? formatIstDateTime(value as string)
        : <span className="text-[#1F1F1F]/40">—</span>,
    })
  }

  cols.push(
    {
      field: 'totalItems', headerName: 'Submitted Items', width: 130, sortable: false, filterable: false,
      align: 'right', headerAlign: 'right',
    },
    {
      field: 'totalQty', headerName: 'Submitted Qty', width: 130, sortable: false, filterable: false,
      align: 'right', headerAlign: 'right',
    },
    {
      // Sum of dispatched_qty across items. "—" until dispatch; red bold when
      // short; "Out of stock" chip when delivered nothing.
      field: 'totalDispatchedQty', headerName: 'Dispatched Qty', width: 160, sortable: false, filterable: false,
      align: 'right', headerAlign: 'right',
      renderCell: ({ row }) => <DispatchedCell qty={row.totalDispatchedQty} requested={row.totalQty} />,
    },
    {
      // Shop-reported receipt discrepancy (03-Jul-2026). Signed +N over,
      // -N short, 0 net-zero, — no discrepancy / not yet Received.
      field: 'totalAdjustmentQty', headerName: 'Adjustment Qty', width: 150, sortable: false, filterable: false,
      align: 'right', headerAlign: 'right',
      renderCell: ({ row }) => <AdjustmentQtyCell value={row.totalAdjustmentQty} />,
    },
  )

  // Received Time is meaningless on the Approved chip — an approved request
  // hasn't been received yet, so the column would just show "—" on every
  // row. Hidden there to keep the grid focused.
  if (activePreset !== 'approved') {
    cols.push({
      field: 'receivedAt', headerName: 'Received Time', flex: 1, minWidth: 170, sortable: false, filterable: false,
      renderCell: ({ value }) => value
        ? formatIstDateTime(value as string)
        : <span className="text-[#1F1F1F]/40">—</span>,
    })
  }

  cols.push(
    {
      // Pre-dispatch: single requested total.
      // Post-dispatch: requested (muted, top) + delivered (bold, red when short).
      field: 'totalAmount', headerName: 'Total', flex: 0.7, minWidth: 140, sortable: false, filterable: false,
      align: 'center', headerAlign: 'center',
      renderCell: ({ row }) => {
        const hasDispatch = row.totalDispatchedAmount != null
        const short = hasDispatch && row.totalDispatchedAmount! < row.totalAmount
        if (!hasDispatch) {
          return <span>{formatINR(Number(row.totalAmount))}</span>
        }
        return (
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', lineHeight: 1.2, py: 0.5 }}>
            <Box sx={{ fontSize: 12, color: '#1F1F1F99' }}>
              {formatINR(Number(row.totalAmount))}
            </Box>
            <Box sx={{ fontSize: 13, fontWeight: 700, color: short ? '#C62828' : '#1F1F1F' }}>
              {formatINR(Number(row.totalDispatchedAmount))}
            </Box>
          </Box>
        )
      },
    },
    {
      field: 'status', headerName: 'Status', width: 130, sortable: false, filterable: false,
      align: 'center', headerAlign: 'center',
      renderCell: ({ value, row }) => (
        <Chip
          label={value}
          size="small"
          color={STATUS_COLOR[value as RequestStatus]}
          variant={row.status === 'Received' || row.status === 'Accepted' ? 'filled' : 'outlined'}
          sx={STATUS_CHIP_SX[value as RequestStatus]}
        />
      ),
    },
  )
  return cols
  }, [activePreset, draftIdSet])

  // Active-filter pills shown when the panel is collapsed. Each ✕ clears that
  // one filter (date → all dates; status → All; shop → none; search → empty).
  const activePills: FilterPill[] = []
  // Date pill has no ✕ — the date filter is always present (defaults to today)
  // and is changed via the expanded panel, not cleared from the summary.
  if (fromDate || toDate)
    activePills.push({ key: 'date', label: dateRangeLabel(fromDate, toDate) })
  if (activePreset !== 'all')
    activePills.push({
      key: 'status',
      label: PRESETS.find(p => p.key === activePreset)?.label ?? activePreset,
      // setActivePreset already drops shopId + resets page — no extra calls needed.
      onRemove: () => setActivePreset('all'),
    })
  if (shopId)
    activePills.push({
      key: 'shop',
      label: shopCounts.data?.find(s => s.shopId === shopId)?.shopName ?? 'Shop',
      onRemove: () => setShopId(undefined),
    })
  if (search.trim())
    activePills.push({
      key: 'search',
      label: `“${search.trim()}”`,
      onRemove: () => setSearch(''),
    })

  const errorMessage = list.isError
    ? (list.error instanceof Error ? list.error.message : 'Failed to load requests.')
    : null

  return (
    <div>
      <PageHeader
        title="Stock Requests"
        subtitle={list.isLoading ? 'Loading…' : `${total} ${total === 1 ? 'request' : 'requests'} from all shops`}
        action={
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            {/* Admin direct-order (08-Jul-2026). Opens the same
                ShopRequestNew component with a shop picker at the top;
                bypasses the visit-category gate the shop-user flow
                enforces (admin orders are one-off, not routine). */}
            <Button
              variant="contained"
              disableElevation
              startIcon={<Plus className="w-4 h-4" />}
              onClick={() => navigate('/admin/requests/new')}
              sx={{
                textTransform: 'none', fontWeight: 700,
                color: '#1F1F1F',
                border: '1px solid #C28A00',
                background: 'linear-gradient(90deg, #C28A00 0%, #E6B800 35%, #FFD700 65%, #FFF1A6 100%)',
                boxShadow: '0 2px 6px rgba(194,138,0,0.25)',
                '&:hover': {
                  background: 'linear-gradient(90deg, #A07000 0%, #C28A00 35%, #E6B800 65%, #FFD700 100%)',
                  boxShadow: '0 3px 10px rgba(194,138,0,0.35)',
                },
              }}
            >
              New Request
            </Button>
            {/* MUI Tooltip wraps a <span> so hover fires even when the Button
                underneath is disabled — browsers swallow pointer events on
                disabled buttons, so a native `title` attribute never shows
                in the wrong-tab case. */}
            <Tooltip title={printCumulativeTooltip ?? ''} placement="bottom" arrow>
              <span style={{ display: 'inline-block' }}>
                <Button
                  variant="contained"
                  startIcon={<Printer className="w-4 h-4" />}
                  onClick={onPrintCumulativeClick}
                  disabled={!canPrintCumulative}
                  sx={{ textTransform: 'none', fontWeight: 600 }}
                >
                  Print Cumulative
                </Button>
              </span>
            </Tooltip>
          </Box>
        }
      />

      {errorMessage && <Alert severity="error" sx={{ mb: 2 }}>{errorMessage}</Alert>}

      <FilterPanel open={filtersOpen} onToggle={() => setFiltersOpen(o => !o)} pills={activePills}>
      <FilterBar>
        {/* Date row — search box sits at the right of this row. */}
        <FilterRow
          label="Date"
          right={
            <TextField
              size="small"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search by code"
              sx={{ minWidth: 220, '& .MuiOutlinedInput-root': { bgcolor: 'transparent' } }}
              slotProps={{
                input: {
                  startAdornment: (
                    <InputAdornment position="start">
                      <Search className="w-4 h-4 text-[#1F1F1F]" />
                    </InputAdornment>
                  ),
                },
              }}
            />
          }
        >
          <DateRangeFilter from={fromDate} to={toDate} onChange={handleDateChange} hideLabel />
        </FilterRow>

        {/* Status chips — last chip "Return" filters by request_type and is
            themed red to match the inline Return pill on rows + detail. */}
        <FilterRow label="Status">
          {PRESETS.map(p => {
            const active   = activePreset === p.key
            const isReturn = p.key === 'return'
            return (
              <Button
                key={p.key}
                // setActivePreset drops the shop drill-down + resets page itself,
                // so we don't have to repeat that here.
                onClick={() => setActivePreset(p.key)}
                disableElevation
                variant={active ? 'contained' : 'outlined'}
                size="small"
                sx={{
                  textTransform: 'none',
                  fontWeight: 700,
                  borderRadius: 999,
                  px: 2,
                  py: 0.5,
                  minHeight: 32,
                  ...(active
                    ? isReturn
                      ? { bgcolor: '#C62828', color: '#FFFFFF', '&:hover': { bgcolor: '#A82020' } }
                      : {
                          background: 'linear-gradient(90deg, #C28A00 0%, #E6B800 35%, #FFD700 65%, #FFF1A6 100%)',
                          color: '#1F1F1F',
                          borderColor: '#C28A00',
                          '&:hover': {
                            background: 'linear-gradient(90deg, #A07000 0%, #C28A00 35%, #E6B800 65%, #FFD700 100%)',
                          },
                        }
                    : isReturn
                    ? {
                        bgcolor: '#FFF8E1', color: '#C62828',
                        borderColor: 'rgba(198,40,40,0.45)',
                        '&:hover': { borderColor: '#C62828', bgcolor: 'rgba(198,40,40,0.06)' },
                      }
                    : {
                        bgcolor: '#FFF8E1', color: '#1F1F1F',
                        borderColor: 'rgba(31,31,31,0.25)',
                        '&:hover': { borderColor: '#1F1F1F', bgcolor: '#FFF8DC' },
                      }),
                }}
              >
                {p.label}
              </Button>
            )
          })}
        </FilterRow>

        {/* Per-shop count chips for the active status filter. Server omits
            zero-count shops; row hidden when nothing matches. Click to drill
            down; click the active chip again to clear. */}
        {(shopCounts.data?.length ?? 0) > 0 && (
          <FilterRow label="By shop">
            {shopCounts.data!.map(s => {
              const active = shopId === s.shopId
              return (
                <Chip
                  key={s.shopId}
                  // Click toggles — clicking the active shop clears the filter.
                  onClick={() => setShopId(active ? undefined : s.shopId)}
                  label={`${s.shopName} (${s.requestCount})`}
                  size="small"
                  variant={active ? 'filled' : 'outlined'}
                  sx={{
                    cursor: 'pointer',
                    borderRadius: 999,
                    fontWeight: 600,
                    ...(active
                      ? {
                          background: 'linear-gradient(90deg, #C28A00 0%, #E6B800 35%, #FFD700 65%, #FFF1A6 100%)',
                          color: '#1F1F1F',
                          borderColor: '#C28A00',
                          '&:hover': {
                            background: 'linear-gradient(90deg, #A07000 0%, #C28A00 35%, #E6B800 65%, #FFD700 100%)',
                          },
                        }
                      : {
                          bgcolor: '#FFF8E1', color: '#1F1F1F',
                          borderColor: 'rgba(31,31,31,0.2)',
                          '&:hover': { bgcolor: '#FFF8DC', borderColor: '#1F1F1F' },
                        }),
                  }}
                />
              )
            })}
          </FilterRow>
        )}
      </FilterBar>
      </FilterPanel>

      <Paper className="products-paper" sx={{ borderRadius: 2.5 }} elevation={0}>
        <DataGrid
          className="products-grid"
          rows={rows}
          columns={columns}
          getRowId={r => r.id}
          loading={list.isLoading}
          autoHeight
          disableRowSelectionOnClick
          disableColumnMenu
          onRowClick={(p) => {
            // 15-Jul-2026: Draft rows can't open the standard detail page
            // (fn_request_get filters status <> 'Draft'). Route them
            // instead to the New Request flow with the draft's shop
            // pre-selected — that page's useShopDraft(shopId) will pull
            // the saved cart/notes/special-flag from the server draft.
            if (p.row.status === 'Draft') {
              navigate(`/admin/requests/new?shopId=${p.row.shopId}`)
              return
            }
            navigate(`/admin/requests/${p.id}`)
          }}
          paginationMode="server"
          rowCount={total}
          paginationModel={paginationModel}
          onPaginationModelChange={setPaginationModel}
          pageSizeOptions={[10, 25, 50, 100]}
          // Cream-tinted rows — matches the warm look on InventoryRequests so
          // every list page shares the same table backdrop. !important wins
          // against the generic white row bg defined in Products.css.
          sx={{
            '& .MuiDataGrid-row':       { cursor: 'pointer', bgcolor: '#FFFBE6 !important' },
            '& .MuiDataGrid-row:hover': { bgcolor: '#FFF4B8 !important' },
          }}
        />
      </Paper>

      {/* Print Cumulative confirmation — fires only when there are Pending
          requests that won't be included in the print (which sources only
          Approved data). Lets admin decide whether to wait for more
          approvals or print the current set as-is. Mirrors the inventory
          flow so both roles get the same safety net. */}
      <ConfirmDialog
        open={printConfirmOpen}
        title={`${totalPending} ${totalPending === 1 ? 'request is' : 'requests are'} still pending`}
        message={`Only the in-progress (approved) requests will be included in this batch plan. Pending requests won't appear here until they're approved. Print anyway?`}
        confirmLabel="Yes, choose requests"
        cancelLabel="Cancel"
        onConfirm={() => {
          setPrintConfirmOpen(false)
          openPrintSelection()
        }}
        onCancel={() => setPrintConfirmOpen(false)}
      />

      {/* Selection dialog — lists every Approved request in scope; admin
          un-checks the ones they don't want to pack in this batch. Print
          button opens the cumulative report scoped to only those IDs.
          Default: everything checked → one-click "Print all". */}
      <Dialog
        open={printSelectionOpen}
        onClose={(_e, reason) => {
          if (reason === 'backdropClick' || reason === 'escapeKeyDown') return
          setPrintSelectionOpen(false)
        }}
        maxWidth="sm"
        fullWidth
        slotProps={{ paper: { sx: { borderRadius: 3 } } }}
      >
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontWeight: 700 }}>
          Select requests for the batch plan
          <IconButton size="small" onClick={() => setPrintSelectionOpen(false)}>
            <XIcon className="w-4 h-4" />
          </IconButton>
        </DialogTitle>
        <DialogContent dividers>
          {approvedForSelection.isLoading ? (
            <Box sx={{ p: 2, fontSize: 13, color: '#1F1F1F99' }}>Loading approved requests…</Box>
          ) : approvedRows.length === 0 ? (
            <Box sx={{ p: 2, fontSize: 13, color: '#1F1F1F99' }}>
              No approved requests in the queue.
            </Box>
          ) : (
            <>
              <TextField
                select
                size="small"
                fullWidth
                label="Shop"
                value={printShopFilter}
                onChange={e => setPrintShopFilter(e.target.value)}
                sx={{ mb: 1.5 }}
                slotProps={{
                  inputLabel: { shrink: true },
                  select: {
                    displayEmpty: true,
                    MenuProps: {
                      slotProps: {
                        paper: {
                          sx: {
                            borderRadius: 2,
                            boxShadow: '0 6px 18px rgba(31,31,31,0.18)',
                            border: '1px solid rgba(31,31,31,0.12)',
                          },
                        },
                      },
                    },
                  },
                }}
              >
                <MenuItem value="">All shops ({approvedRows.length})</MenuItem>
                {shopsInApproved.map(s => {
                  const count = approvedRows.filter(r => r.shopId === s.shopId).length
                  return (
                    <MenuItem key={s.shopId} value={s.shopId}>
                      {s.shopName} ({count})
                    </MenuItem>
                  )
                })}
              </TextField>

              {(() => {
                const visibleIds = visibleApprovedRows.map(r => r.id)
                const visibleChecked = visibleApprovedRows.filter(r => selectedRequestIds.has(r.id)).length
                const allVisibleChecked = visibleIds.length > 0 && visibleChecked === visibleIds.length
                const noneVisibleChecked = visibleChecked === 0
                const selectAll = () => setSelectedRequestIds(prev => {
                  const n = new Set(prev)
                  for (const id of visibleIds) n.add(id)
                  return n
                })
                const deselectAll = () => setSelectedRequestIds(prev => {
                  const n = new Set(prev)
                  for (const id of visibleIds) n.delete(id)
                  return n
                })
                return (
                  <Box sx={{ mb: 1, display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
                    <Box sx={{ fontSize: 12, color: '#1F1F1F99', flex: 1, minWidth: 0 }}>
                      {printShopFilter
                        ? `${visibleChecked} of ${visibleIds.length} selected in this shop`
                        : `${selectedRequestIds.size} of ${approvedRows.length} selected`}
                    </Box>
                    <Button
                      size="small"
                      onClick={selectAll}
                      disabled={allVisibleChecked || visibleIds.length === 0}
                      sx={{ textTransform: 'none', fontWeight: 700, minWidth: 'auto', px: 1 }}
                    >
                      Select all
                    </Button>
                    <Button
                      size="small"
                      onClick={deselectAll}
                      disabled={noneVisibleChecked}
                      sx={{ textTransform: 'none', fontWeight: 700, minWidth: 'auto', px: 1, color: '#C62828' }}
                    >
                      Deselect all
                    </Button>
                  </Box>
                )
              })()}

              <Box sx={{ maxHeight: 380, overflowY: 'auto', border: '1px solid rgba(31,31,31,0.15)', borderRadius: 1 }}>
                {visibleApprovedRows.map(r => {
                  const checked = selectedRequestIds.has(r.id)
                  return (
                    <Box
                      key={r.id}
                      onClick={() => {
                        setSelectedRequestIds(prev => {
                          const n = new Set(prev)
                          if (n.has(r.id)) n.delete(r.id); else n.add(r.id)
                          return n
                        })
                      }}
                      sx={{
                        display: 'flex', alignItems: 'center', gap: 1,
                        px: 1.5, py: 0.75,
                        borderBottom: '1px solid rgba(31,31,31,0.08)',
                        '&:last-child': { borderBottom: 'none' },
                        cursor: 'pointer',
                        bgcolor: checked ? '#FFFBE6' : 'transparent',
                        '&:hover': { bgcolor: '#FFF8DC' },
                      }}
                    >
                      <Box
                        component="input"
                        type="checkbox"
                        checked={checked}
                        onChange={() => {}}
                        sx={{ pointerEvents: 'none' }}
                      />
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Box sx={{ fontSize: 13, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap' }}>
                          {r.code}
                          {!printShopFilter && (
                            <Box component="span" sx={{ fontWeight: 500, color: '#1F1F1F99' }}>· {r.shopName}</Box>
                          )}
                          {r.isSpecial && (
                            <Box
                              component="span"
                              title={r.specialLabel?.trim() || 'Special Request'}
                              sx={{
                                display: 'inline-flex', alignItems: 'center', gap: 0.4,
                                px: 0.75, py: 0.15, borderRadius: 0.75,
                                bgcolor: '#FFB74D', border: '1px solid #E65100',
                                color: '#3E2500', fontSize: 10, fontWeight: 800,
                                letterSpacing: 0.4, textTransform: 'uppercase',
                                lineHeight: 1.2,
                                maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                              }}
                            >
                              ★ Special
                              {r.specialLabel?.trim() && (
                                <Box component="span" sx={{ fontWeight: 700, textTransform: 'none', letterSpacing: 0 }}>
                                  · {r.specialLabel.trim()}
                                </Box>
                              )}
                            </Box>
                          )}
                        </Box>
                        <Box sx={{ fontSize: 11, color: '#1F1F1F99' }}>
                          {r.totalItems} items · {r.totalQty} units · {formatIstDateTime(r.submittedAt)}
                        </Box>
                      </Box>
                    </Box>
                  )
                })}
                {visibleApprovedRows.length === 0 && (
                  <Box sx={{ p: 2, fontSize: 13, color: '#1F1F1F99' }}>
                    No approved requests for this shop.
                  </Box>
                )}
              </Box>
            </>
          )}
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button
            onClick={() => setPrintSelectionOpen(false)}
            variant="outlined"
            sx={{ textTransform: 'none', fontWeight: 600, borderColor: '#1F1F1F', color: '#1F1F1F' }}
          >
            Cancel
          </Button>
          {(() => {
            const scopedIds = printShopFilter
              ? visibleApprovedRows.filter(r => selectedRequestIds.has(r.id)).map(r => r.id)
              : Array.from(selectedRequestIds)
            const scopedCount = scopedIds.length
            const allSelected = !printShopFilter && scopedCount === approvedRows.length
            return (
              <Button
                variant="contained"
                disabled={scopedCount === 0}
                onClick={() => {
                  openPrintCumulative(allSelected ? undefined : scopedIds)
                  setPrintSelectionOpen(false)
                }}
                sx={{ textTransform: 'none', fontWeight: 700 }}
              >
                Print {scopedCount} selected
              </Button>
            )
          })()}
        </DialogActions>
      </Dialog>
    </div>
  )
}
