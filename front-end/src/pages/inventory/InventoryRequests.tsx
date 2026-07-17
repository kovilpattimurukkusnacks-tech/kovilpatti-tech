import { useMemo, useState, useRef, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { FileEdit, Search, Printer, ChevronDown, ChevronUp, Pencil, X as XIcon, Pin, PinOff } from 'lucide-react'
import { SpecialRequestChip } from '../../components/SpecialRequestChip'
import { Alert, Box, Button, Chip, Collapse, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, InputAdornment, MenuItem, Paper, TextField, Tooltip } from '@mui/material'
import { DataGrid, type GridColDef } from '@mui/x-data-grid'
import PageHeader from '../../components/PageHeader'
import { DispatchedCell } from '../../components/DispatchedCell'
import { AdjustmentQtyCell } from '../../components/AdjustmentQtyCell'
import ConfirmDialog from '../../components/ConfirmDialog'
import {
  useIncomingStockRequests, useCumulativePending, useRequestCountByShop,
  useInventoryDispatchDrafts, useRenameDispatchDraft, usePinDispatchDraft,
} from '../../hooks/useStockRequests'
import { useDebouncedValue } from '../../hooks/useDebouncedValue'
import { formatINR } from '../../utils/format'
import { formatIstDateTime } from '../../utils/formatDate'
import type { RequestStatus, RequestType, StockRequestDto } from '../../api/stock-requests/types'
import '../Products.css'

// Consolidated into utils/statusChipStyle.ts so a color tweak lands in one place.
import { STATUS_COLOR, STATUS_CHIP_SX } from '../../utils/statusChipStyle'

// Quick-filter presets. Per client feedback (demo, 26 May 2026), the inventory
// list shows four lifecycle buckets:
//   • Needs Action = Pending (request just landed, not yet approved)
//   • In-Progress  = Approved (godown is working on it, shop can no longer edit)
//   • Delivered    = Received (shop confirmed receipt)
//   • All          = everything
// The previous "In Transit" (Dispatched) chip was dropped — dispatched rows
// surface under "All". "Approved" label was renamed to "In-Progress" to match
// how the client describes the workflow state.
// A fifth chip "Return" (added 28 May 2026) filters by request_type and cuts
// across statuses so the godown can see Pending Returns waiting for accept
// alongside Accepted ones in one place.
type Preset = {
  key: string
  label: string
  status?: RequestStatus
  requestType?: RequestType
  // 15-Jul-2026: is_special filter for the "Special Order" preset — lets
  // godown filter incoming requests to just Special (vendor-procurement)
  // orders across the lifecycle.
  isSpecial?: boolean
}
const PRESETS: Preset[] = [
  { key: 'pending',    label: 'Needs Action',  status: 'Pending'    },
  { key: 'approved',   label: 'In-Progress',   status: 'Approved'   },
  // 06-Jul-2026: Dispatched tab (client req) — godown needs a quick way
  // to see everything that's been shipped and is waiting on the shop's
  // receipt confirmation. Sits between In-Progress and Delivered to
  // mirror the request lifecycle: Pending → Approved → Dispatched → Received.
  { key: 'dispatched', label: 'Dispatched',    status: 'Dispatched' },
  { key: 'received',   label: 'Delivered',     status: 'Received'   },
  { key: 'all',        label: 'All',           status: undefined    },
  { key: 'return',     label: 'Return',        requestType: 'Return' },
  { key: 'special',    label: 'Special Order', isSpecial: true      },
]

export default function InventoryRequests() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  // Default: Needs Action (Pending). `?preset=` (e.g. from detail-page
  // navigations after Approve) overrides the default on first mount so
  // the user lands on the right tab. Guarded by PRESETS.some so a stale
  // deep-link with a removed preset key falls back cleanly.
  const initialPreset = (() => {
    const requested = searchParams.get('preset')
    return requested && PRESETS.some(p => p.key === requested) ? requested : 'pending'
  })()
  const [activePreset, setActivePreset] = useState<string>(initialPreset)
  // Optional second-level drill-down — clicking a shop chip toggles it.
  const [shopId, setShopId] = useState<string | undefined>(undefined)
  const [search, setSearch] = useState<string>('')
  const [paginationModel, setPaginationModel] = useState({ page: 0, pageSize: 10 })
  // Dispatch-drafts strip collapse state. With several drafts saved the list
  // eats most of the viewport; we keep it collapsed by default and let the
  // user expand on demand.
  const [draftsOpen, setDraftsOpen] = useState(false)
  // Draft-list search box (30-Jun-2026). FE-only filter over the already-loaded
  // dispatch-drafts list — at ≤10 max drafts there's no point fetching
  // server-side. Debounced 150ms so a quick burst of keystrokes doesn't
  // re-filter on every char.
  const [draftFilter, setDraftFilter] = useState('')
  const debouncedDraftFilter = useDebouncedValue(draftFilter, 150)

  // Consume the ?preset= query param once on mount. Once activePreset is
  // seeded from it, strip it from the URL so a subsequent F5 doesn't lock
  // the user back to that tab if they've since navigated to a different
  // preset. Guarded by an empty-dep useEffect so it fires exactly once.
  useEffect(() => {
    if (!searchParams.has('preset')) return
    const next = new URLSearchParams(searchParams)
    next.delete('preset')
    setSearchParams(next, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const currentPreset      = PRESETS.find(p => p.key === activePreset)
  const currentStatus      = currentPreset?.status
  const currentRequestType = currentPreset?.requestType
  const isSpecialFilter    = currentPreset?.isSpecial

  const list = useIncomingStockRequests({
    status: currentStatus,
    requestType: currentRequestType,
    shopId,
    search: search.trim() || undefined,
    page: paginationModel.page + 1,
    pageSize: paginationModel.pageSize,
    isSpecial: isSpecialFilter,
  })

  // Inventory user's own scope is enforced server-side, so no inventoryId
  // arg needed. We use it only to know whether the Print Cumulative button
  // should be enabled (empty queue → nothing to print).
  const cumulative = useCumulativePending()
  const hasPending = (cumulative.data?.length ?? 0) > 0

  // Per-shop chips for the active preset. BE forces the inventory scope to
  // this user's godown — so we only see shops served by it. When the Return
  // chip is active, both status and requestType collapse to a single filter
  // (requestType='Return', no status) so the chip row mirrors the table.
  const shopCounts = useRequestCountByShop({ status: currentStatus, requestType: currentRequestType })

  // Standalone Pending count (independent of the active preset) — drives the
  // confirmation dialog on the Print Cumulative button so the dispatcher
  // knows "X requests are still pending and won't be in this print" before
  // a tab opens. Same hook the shop-chip badges use, just filtered to
  // status='Pending' and summed across shops.
  const pendingShopCounts = useRequestCountByShop({ status: 'Pending' })
  const totalPending = useMemo(
    () => (pendingShopCounts.data ?? []).reduce((sum, r) => sum + r.requestCount, 0),
    [pendingShopCounts.data],
  )

  // Print Cumulative gating (30-Jun-2026): only enabled on the In-Progress
  // tab — the report itself is scoped to status='Approved' (= In-Progress)
  // rows, so allowing the print from other tabs is semantically wrong.
  // Other tabs render the button disabled with a tooltip explaining how
  // to enable it.
  const isInProgressTab = activePreset === 'approved'
  const canPrintCumulative = isInProgressTab && hasPending
  const printCumulativeTooltip =
    !isInProgressTab ? 'Switch to In-Progress tab to print the batch plan'
    : !hasPending    ? 'No in-progress requests to print'
    : totalPending > 0
      ? `${totalPending} request${totalPending === 1 ? ' is' : 's are'} still pending — you'll get a confirmation first`
      : undefined

  const [printConfirmOpen, setPrintConfirmOpen] = useState(false)
  // Selection dialog state (02-Jul-2026). Shop dropdown narrows the visible
  // request list; user then picks specific requests within that filter.
  // `printShopFilter = ''` → all shops.
  const [printSelectionOpen, setPrintSelectionOpen] = useState(false)
  const [selectedRequestIds, setSelectedRequestIds] = useState<Set<string>>(new Set())
  const [printShopFilter, setPrintShopFilter] = useState<string>('')
  // Fetch the Approved request list ONLY when the selection dialog is open —
  // keeps the list page's query pool lean. pageSize 200 covers realistic
  // inventory queues without paging.
  const approvedForSelection = useIncomingStockRequests(
    { status: 'Approved', pageSize: 200 },
  )
  const approvedRows = approvedForSelection.data?.items ?? []

  // Distinct shops present in the approved queue — populates the filter
  // dropdown at the top of the selection dialog. `sort` gives a stable
  // alphabetical order regardless of the request-fetch ordering.
  const shopsInApproved = useMemo(() => {
    const map = new Map<string, string>()  // shopId → shopName
    for (const r of approvedRows) map.set(r.shopId, r.shopName)
    return Array.from(map.entries())
      .map(([shopId, shopName]) => ({ shopId, shopName }))
      .sort((a, b) => a.shopName.localeCompare(b.shopName))
  }, [approvedRows])

  // Rows visible under the currently-selected shop filter. Empty filter →
  // every approved row.
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
      // Also pass distinct shop names for the print header (03-Jul-2026).
      // Derived from approvedRows so the print page doesn't need to
      // re-fetch. Deduped + comma-joined; "Ambatur" for one shop,
      // "Ambatur, Anna Nagar" for multi-shop selections.
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
    // Pre-check every request so the "Print all" flow stays a single click.
    // Reset the shop dropdown to "All".
    setSelectedRequestIds(new Set(approvedRows.map(r => r.id)))
    setPrintShopFilter('')
    setPrintSelectionOpen(true)
  }
  const onPrintCumulativeClick = () => {
    if (totalPending > 0) setPrintConfirmOpen(true)
    else openPrintSelection()
  }
  // Re-seed selection whenever approved rows arrive (or the dialog opens
  // before the query resolves).
  useEffect(() => {
    if (!printSelectionOpen) return
    if (selectedRequestIds.size === 0 && approvedRows.length > 0) {
      setSelectedRequestIds(new Set(approvedRows.map(r => r.id)))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [printSelectionOpen, approvedRows.length])

  // Pending/Approved requests with a saved dispatch draft — surfaced as
  // strips below the page title so the user can jump back into any WIP
  // dispatch session in one click.
  const dispatchDrafts = useInventoryDispatchDrafts()
  // Fast-lookup set of request IDs that have a saved dispatch draft.
  // Drives the "Draft" chip on the list rows so the godown can spot
  // which incoming requests they've already WIP'd on. 02-Jul-2026.
  const draftIdSet = useMemo(
    () => new Set(dispatchDrafts.data?.map(d => d.id) ?? []),
    [dispatchDrafts.data],
  )
  // Apply the draft-list filter. Matches against (case-insensitive) draft
  // name, REQ code, and shop name — that way un-named drafts can still be
  // searched by code/shop without forcing the user to name them first.
  const filteredDrafts = useMemo(() => {
    const all = dispatchDrafts.data ?? []
    const q = debouncedDraftFilter.trim().toLowerCase()
    if (!q) return all
    return all.filter(d => {
      const haystack = `${d.draftName ?? ''} ${d.code} ${d.shopName}`.toLowerCase()
      return haystack.includes(q)
    })
  }, [dispatchDrafts.data, debouncedDraftFilter])
  const renameDraft = useRenameDispatchDraft()
  const pinDraft    = usePinDispatchDraft()

  const rows  = list.data?.items ?? []
  const total = list.data?.total ?? 0

  const columns = useMemo<GridColDef<StockRequestDto>[]>(() => {
    // Every chip shows date + time so the user can correlate timestamps
    // (requested at vs approved/dispatched/received at) at a glance.
    const codeCol: GridColDef<StockRequestDto> = {
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
          {/* Compact mode (07-Jul-2026): the code column is 180px wide; a
              long specialLabel like "Diwali offer" was pushing the full-
              label chip onto a second line where DataGrid's fixed row
              height clipped it. Compact renders a small "SP" pill with the
              label on hover — full text still visible on the sticky banner
              + detail strip. */}
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
    }
    const requestedDateCol: GridColDef<StockRequestDto> = {
      // Most useful triage signal — when the request landed in the queue.
      // Date + time on every chip including Needs Action and All, so the
      // godown user always sees how fresh the request is.
      field: 'submittedAt', headerName: 'Requested Date',
      width: 190,
      sortable: false, filterable: false,
      renderCell: ({ value }) => value
        ? formatIstDateTime(value as string)
        : <span className="text-[#1F1F1F]/40">—</span>,
    }

    // Code always leads — most reliable triage anchor across every chip
    // (Needs Action, In-Progress, Delivered, All). Date column(s) and
    // user / shop / qty columns follow.
    const cols: GridColDef<StockRequestDto>[] = [codeCol, requestedDateCol]
  // Lifecycle-specific second column — surfaces the timestamp of the state
  // each chip represents. Hidden on Needs Action / All to keep the grid
  // uncluttered. Date + time format matches the Requested Date column on
  // these chips so the pair reads consistently.
  if (activePreset === 'approved') {
    cols.push({
      field: 'approvedAt', headerName: 'In-Progress Since', width: 190, sortable: false, filterable: false,
      renderCell: ({ value }) => value
        ? formatIstDateTime(value as string)
        : <span className="text-[#1F1F1F]/40">—</span>,
    })
  }
  if (activePreset === 'received') {
    cols.push({
      field: 'receivedAt', headerName: 'Delivered On', width: 190, sortable: false, filterable: false,
      renderCell: ({ value }) => value
        ? formatIstDateTime(value as string)
        : <span className="text-[#1F1F1F]/40">—</span>,
    })
  }
  cols.push(
    {
      field: 'submittedByName', headerName: 'User', flex: 1, minWidth: 140, sortable: false, filterable: false,
      renderCell: ({ row }) =>
        row.submittedByName ?? <span className="text-[#1F1F1F]/40">—</span>,
    },
    {
      field: 'shopName', headerName: 'Shop', flex: 1, minWidth: 140, sortable: false, filterable: false,
    },
    {
      field: 'totalItems', headerName: 'Submitted Items', width: 140, sortable: false, filterable: false,
      align: 'right', headerAlign: 'right',
    },
    {
      field: 'totalQty', headerName: 'Submitted Qty', width: 140, sortable: false, filterable: false,
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
      // Shop-reported receipt discrepancy (03-Jul-2026). Signed.
      field: 'totalAdjustmentQty', headerName: 'Adjustment Qty', width: 150, sortable: false, filterable: false,
      align: 'right', headerAlign: 'right',
      renderCell: ({ row }) => <AdjustmentQtyCell value={row.totalAdjustmentQty} />,
    },
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
      field: 'status', headerName: 'Status', width: 120, sortable: false, filterable: false,
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

  const errorMessage = list.isError
    ? (list.error instanceof Error ? list.error.message : 'Failed to load requests.')
    : null

  return (
    <div>
      <PageHeader
        title="Incoming Requests"
        subtitle={list.isLoading ? 'Loading…' : `${total} ${total === 1 ? 'request' : 'requests'}`}
        // MUI Tooltip wraps a <span> so hover fires even when the Button
        // underneath is disabled — browsers swallow pointer events on
        // disabled buttons, so a native `title` attribute (or a Tooltip
        // directly on the button) never shows in the wrong-tab case.
        action={
          <Tooltip title={printCumulativeTooltip ?? ''} placement="bottom" arrow>
            <span style={{ display: 'inline-block' }}>
              <Button
                variant="outlined"
                startIcon={<Printer className="w-4 h-4" />}
                onClick={onPrintCumulativeClick}
                disabled={!canPrintCumulative}
                sx={{
                  textTransform: 'none',
                  fontWeight: 700,
                  bgcolor: '#FFF8E1',
                  color: '#1F1F1F',
                  borderColor: '#C28A00',
                  borderWidth: '1.5px',
                  '&:hover': {
                    bgcolor: '#FCD835',
                    borderColor: '#A07000',
                    borderWidth: '1.5px',
                  },
                  '&.Mui-disabled': {
                    bgcolor: '#FFFBE6',
                    color: 'rgba(31,31,31,0.4)',
                    borderColor: 'rgba(194,138,0,0.45)',
                  },
                }}
              >
                Print Cumulative
              </Button>
            </span>
          </Tooltip>
        }
      />

      {errorMessage && <Alert severity="error" sx={{ mb: 2 }}>{errorMessage}</Alert>}

      {/* Dispatch drafts — collapsed strip with a chevron toggle. When the
          inventory user has multiple drafts saved (one per in-flight request),
          the full stack of cards used to push the table off-screen. We now
          show a single summary row by default ("N dispatch drafts saved") and
          let the user expand to see / resume specific ones. */}
      {(dispatchDrafts.data?.length ?? 0) > 0 && (
        <Box sx={{ mb: 2 }}>
          <Paper
            elevation={0}
            onClick={() => setDraftsOpen(o => !o)}
            sx={{
              borderRadius: 2,
              border: '2px solid #1F1F1F',
              bgcolor: '#FFF8DC',
              px: 2,
              py: 1.25,
              display: 'flex',
              alignItems: 'center',
              gap: 1.5,
              cursor: 'pointer',
              userSelect: 'none',
              '&:hover': { bgcolor: '#FFF4B8' },
            }}
          >
            <FileEdit className="w-5 h-5 text-[#1F1F1F]" />
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Box sx={{ fontWeight: 700, fontSize: 14 }}>
                {dispatchDrafts.data!.length} dispatch draft{dispatchDrafts.data!.length === 1 ? '' : 's'} saved
              </Box>
              <Box sx={{ fontSize: 12, color: '#1F1F1F99' }}>
                {draftsOpen ? 'Click to collapse' : 'Click to expand and resume any of them'}
              </Box>
            </Box>
            {draftsOpen
              ? <ChevronUp   className="w-5 h-5 text-[#1F1F1F]" />
              : <ChevronDown className="w-5 h-5 text-[#1F1F1F]" />}
          </Paper>

          <Collapse in={draftsOpen} timeout="auto" unmountOnExit>
            <Box sx={{ mt: 1, display: 'flex', flexDirection: 'column', gap: 1 }}>
              {/* Filter search (30-Jun-2026). FE-only, debounced; matches
                  name + code + shop so un-named drafts can still be found
                  by their REQ code or shop. Hidden when there's only 1
                  draft — no point filtering a list of one. */}
              {dispatchDrafts.data!.length > 1 && (
                <TextField
                  size="small"
                  value={draftFilter}
                  onChange={e => setDraftFilter(e.target.value)}
                  placeholder="Filter by name, code, or shop…"
                  slotProps={{
                    input: {
                      startAdornment: (
                        <InputAdornment position="start">
                          <Search className="w-4 h-4 text-[#1F1F1F]/60" />
                        </InputAdornment>
                      ),
                      endAdornment: draftFilter ? (
                        <InputAdornment position="end">
                          <IconButton size="small" onClick={() => setDraftFilter('')}>
                            <XIcon className="w-3.5 h-3.5" />
                          </IconButton>
                        </InputAdornment>
                      ) : undefined,
                    },
                  }}
                  // bgcolor on the OutlinedInput slot (not the TextField root)
                  // so the whole field — icon adornment, input, clear button —
                  // shares one cream background. Setting it on the root left
                  // the input wrapper transparent → adornment patches showed
                  // through with the page bg. (30-Jun-2026 fix.)
                  sx={{ '& .MuiOutlinedInput-root': { bgcolor: '#FFFBE6' } }}
                />
              )}
              {filteredDrafts.length === 0 ? (
                <Box sx={{ textAlign: 'center', color: '#1F1F1F99', fontSize: 13, py: 2 }}>
                  No drafts match "{draftFilter}".
                </Box>
              ) : filteredDrafts.map(d => (
                <DraftRow
                  key={d.id}
                  draft={d}
                  renameInFlight={renameDraft.isPending}
                  pinInFlight={pinDraft.isPending}
                  onResume={() => navigate(`/inventory/requests/${d.id}`)}
                  onRename={(name) => renameDraft.mutate({ id: d.id, req: { name } })}
                  onTogglePin={() => pinDraft.mutate({ id: d.id, req: { pinned: !d.pinnedAt } })}
                />
              ))}
            </Box>
          </Collapse>
        </Box>
      )}

      {/* Status chips + search — inline single row. Inventory filters per
          client (demo, 26 May 2026): no date filter, no collapse panel,
          chips collapsed to Needs Action / In-Progress / Delivered / All.
          The Return chip (28 May 2026) is themed red to match the inline
          Return pill on rows + detail. */}
      <Box sx={{ display: 'flex', gap: 1.5, mb: 1.5, flexWrap: 'wrap', alignItems: 'center' }}>
        {PRESETS.map(p => {
          const active   = activePreset === p.key
          const isReturn = p.key === 'return'
          return (
            <Button
              key={p.key}
              onClick={() => {
                setActivePreset(p.key)
                // Drop the shop drill-down when the preset changes — a shop
                // that has rows in one bucket may have none in the next.
                setShopId(undefined)
                setPaginationModel(m => ({ ...m, page: 0 }))
              }}
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

        <Box sx={{ flex: 1 }} />

        <TextField
          size="small"
          value={search}
          onChange={e => { setSearch(e.target.value); setPaginationModel(m => ({ ...m, page: 0 })) }}
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
      </Box>

      {/* Per-shop drill-down chips for the active status filter. Server
          prunes zero-count shops; row hidden when nothing matches. Click a
          chip to filter; click again to clear. */}
      {(shopCounts.data?.length ?? 0) > 0 && (
        <Box sx={{ display: 'flex', gap: 1, mb: 2, flexWrap: 'wrap', alignItems: 'center' }}>
          <Box sx={{ fontSize: 12, fontWeight: 600, color: '#1F1F1F99', mr: 0.5 }}>
            By shop:
          </Box>
          {shopCounts.data!.map(s => {
            const active = shopId === s.shopId
            return (
              <Chip
                key={s.shopId}
                onClick={() => {
                  setShopId(prev => prev === s.shopId ? undefined : s.shopId)
                  setPaginationModel(m => ({ ...m, page: 0 }))
                }}
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
        </Box>
      )}

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
          onRowClick={(p) => navigate(`/inventory/requests/${p.id}`)}
          // Tint rows that need the godown's action so they pop visually.
          // Highlight rows the godown needs to act on. "Approved" stays in the
          // check for legacy rows that pre-date the approval-step removal.
          getRowClassName={(p) => p.row.status === 'Pending' || p.row.status === 'Approved' ? 'row-action' : ''}
          paginationMode="server"
          rowCount={total}
          paginationModel={paginationModel}
          onPaginationModelChange={setPaginationModel}
          pageSizeOptions={[10, 25, 50, 100]}
          sx={{
            '& .row-action':       { bgcolor: '#FFFBE6', cursor: 'pointer' },
            '& .row-action:hover': { bgcolor: '#FFF4B8 !important' },
            '& .MuiDataGrid-row':  { cursor: 'pointer' },
          }}
        />
      </Paper>

      {/* Print Cumulative confirmation — fires only when there are Pending
          requests that won't be included in the print (which sources only
          Approved/In-Progress data). Lets the dispatcher decide whether to
          wait for more approvals or print the current set as-is. */}
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

      {/* Selection dialog (02-Jul-2026). Lists every Approved request in
          scope; user un-checks the ones they don't want to pack in this
          batch. Print button opens the cumulative report scoped to only
          those IDs. Default: everything checked → one-click "Print all". */}
      <Dialog
        open={printSelectionOpen}
        onClose={(_e, reason) => {
          // Never close on backdrop or Escape — global rule; only the
          // explicit Cancel / X buttons should dismiss.
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
              {/* Shop filter dropdown — narrows the visible request list.
                  Doesn't touch selection: unchecked requests in a hidden
                  shop stay unchecked; checked ones stay checked. Plain
                  MUI Select — themed rounded menu, no search input. */}
              <TextField
                select
                size="small"
                fullWidth
                label="Shop"
                value={printShopFilter}
                onChange={e => setPrintShopFilter(e.target.value)}
                sx={{ mb: 1.5 }}
                slotProps={{
                  // Force the label to shrink so it doesn't sit on top of
                  // the "All shops (N)" text when the empty-string value
                  // is selected (default state).
                  inputLabel: { shrink: true },
                  select: {
                    // displayEmpty tells Select to render the MenuItem with
                    // value="" as the visible selection — otherwise MUI hides
                    // it and shows a blank input on the default state.
                    displayEmpty: true,
                    // Round the menu surface + soft shadow so it matches the
                    // dialog's rounded look. Native <select> would render
                    // OS-square corners, so we deliberately DON'T use it.
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
                // Selection counts + bulk-toggle affordances (06-Jul-2026,
                // client req). "Select all" and "Deselect all" operate on
                // the CURRENTLY VISIBLE rows only — so with a shop filter
                // active, bulk actions scope to that shop, matching the
                // scoped counter above. Union / diff patterns preserve
                // selections in other shops when the user switches back.
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
                          {/* Special-Request marker (06-Jul-2026, client req):
                              picker needs to know at selection time which
                              rows carry vendor-procurement so they can group
                              or route them differently on the batch plan. */}
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
            // When a shop filter is active, scope the print to the
            // visible+selected intersection ONLY — the user is looking at
            // Ambatur's rows and expects only Ambatur's cumulative.
            // Selections in other shops don't leak into this print run.
            // 03-Jul-2026.
            const scopedIds = printShopFilter
              ? visibleApprovedRows.filter(r => selectedRequestIds.has(r.id)).map(r => r.id)
              : Array.from(selectedRequestIds)
            const scopedCount = scopedIds.length
            // "All selected" fast-path only applies when NO shop filter
            // is active AND every approved row is checked.
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

// ───────────────────────────────────────────────────────────────
// Resume-strip row (30-Jun-2026). Owns the inline rename state so each row
// can be in its own edit mode independently. Click pencil → switch to
// TextField. Enter / blur commits (calls onRename with trimmed value).
// Esc / X reverts to the saved name. Empty / whitespace clears the name.
// Length cap matches the DB column (varchar(60)).

const DRAFT_NAME_MAX = 60

function DraftRow({ draft, renameInFlight, pinInFlight, onResume, onRename, onTogglePin }: {
  draft: StockRequestDto
  renameInFlight: boolean
  pinInFlight: boolean
  onResume: () => void
  onRename: (name: string | null) => void
  onTogglePin: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(draft.draftName ?? '')
  const inputRef = useRef<HTMLInputElement | null>(null)

  // When the underlying name changes (after a successful save), keep the
  // local input in sync — handles the case where the optimistic update
  // beats the server response.
  useEffect(() => {
    if (!editing) setValue(draft.draftName ?? '')
  }, [draft.draftName, editing])

  // Focus + select-all when entering edit mode so the user can immediately
  // overwrite an existing name without manually clearing it.
  useEffect(() => {
    if (editing) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [editing])

  const titleText = draft.draftName?.trim()
    ? draft.draftName
    : `Resume dispatch draft — ${draft.code}`

  const commit = () => {
    const trimmed = value.trim()
    const next = trimmed === '' ? null : trimmed
    // Skip the round-trip if nothing changed.
    if ((draft.draftName ?? null) !== next) {
      onRename(next)
    }
    setEditing(false)
  }

  const cancel = () => {
    setValue(draft.draftName ?? '')
    setEditing(false)
  }

  return (
    <Paper
      elevation={0}
      sx={{
        borderRadius: 2,
        border: '2px solid #1F1F1F',
        bgcolor: '#FFF8DC',
        px: 2,
        py: 1.25,
        display: 'flex',
        alignItems: 'center',
        gap: 2,
        flexWrap: 'wrap',
      }}
    >
      <FileEdit className="w-5 h-5 text-[#1F1F1F]" />
      {/* Pin toggle — pinned drafts sort to the top of the resume strip.
          Filled gold icon when pinned, muted outline when unpinned. */}
      <IconButton
        size="small"
        onClick={onTogglePin}
        disabled={pinInFlight}
        aria-label={draft.pinnedAt ? 'Unpin draft' : 'Pin draft to top'}
        title={draft.pinnedAt ? 'Unpin' : 'Pin to top'}
        sx={{
          p: 0.5,
          color: draft.pinnedAt ? '#C28A00' : 'rgba(31,31,31,0.4)',
          '&:hover': { bgcolor: 'rgba(31,31,31,0.06)', color: draft.pinnedAt ? '#A07000' : '#1F1F1F' },
        }}
      >
        {draft.pinnedAt
          ? <Pin    className="w-4 h-4" fill="currentColor" />
          : <PinOff className="w-4 h-4" />}
      </IconButton>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        {editing ? (
          <TextField
            inputRef={inputRef}
            size="small"
            value={value}
            onChange={e => setValue(e.target.value)}
            onBlur={commit}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); commit() }
              else if (e.key === 'Escape') { e.preventDefault(); cancel() }
            }}
            placeholder="Name this draft (optional)"
            disabled={renameInFlight}
            slotProps={{ htmlInput: { maxLength: DRAFT_NAME_MAX } }}
            sx={{ width: '100%', maxWidth: 480, bgcolor: '#FFFBE6', '& .MuiInputBase-input': { fontWeight: 700, fontSize: 14 } }}
          />
        ) : (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
            <Box sx={{ fontWeight: 700, fontSize: 14 }}>{titleText}</Box>
            {/* Draft badge — matches the list-row + detail-page chip so
                the "this row is a saved dispatch draft" signal is
                consistent everywhere it shows up. */}
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
            {/* Rename gate — ONLY the pencil enters edit mode. Clicking
                the title / badge no longer triggers it (dispatch-drafts
                title accidentally rename-flipped when the user just
                wanted to scan the row). */}
            <IconButton
              size="small"
              sx={{ p: 0.25 }}
              aria-label="Rename draft"
              title="Rename draft"
              onClick={() => setEditing(true)}
            >
              <Pencil className="w-3.5 h-3.5 text-[#1F1F1F]/60" />
            </IconButton>
          </Box>
        )}
        <Box sx={{ fontSize: 12, color: '#1F1F1F99' }}>
          {draft.code} · {draft.shopCode} · {draft.shopName}
          · {draft.totalItems} {draft.totalItems === 1 ? 'product' : 'products'}
          · {draft.totalQty} {draft.totalQty === 1 ? 'unit' : 'units'}
          · Last saved {formatIstDateTime(draft.updatedAt)}
        </Box>
      </Box>
      <Button
        variant="contained"
        size="small"
        onClick={onResume}
        sx={{ textTransform: 'none', fontWeight: 700, whiteSpace: 'nowrap' }}
      >
        Resume
      </Button>
    </Paper>
  )
}
