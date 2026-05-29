import { useCallback, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Search, Printer } from 'lucide-react'
import { Alert, Box, Button, Chip, InputAdornment, Paper, TextField } from '@mui/material'
import { DataGrid, type GridColDef } from '@mui/x-data-grid'
import PageHeader from '../../components/PageHeader'
import { DispatchedCell } from '../../components/DispatchedCell'
import { useAllStockRequests, useCumulativePending, useRequestCountByShop } from '../../hooks/useStockRequests'
import { formatINR } from '../../utils/format'
import { formatIstDateTime } from '../../utils/formatDate'
import DateRangeFilter, { istToday, dateRangeLabel } from '../../components/DateRangeFilter'
import { FilterBar, FilterRow, FilterPanel, type FilterPill } from '../../components/FilterBar'
import type { RequestStatus, RequestType, StockRequestDto } from '../../api/stock-requests/types'
import '../Products.css'

const STATUS_COLOR: Record<RequestStatus, 'default' | 'primary' | 'success' | 'error' | 'warning' | 'info'> = {
  // 'Draft' is filtered out of all list endpoints by the BE; admin never
  // sees one. Mapping kept to satisfy the exhaustive Record type.
  Draft:      'default',
  Pending:    'warning',
  Approved:   'info',
  Rejected:   'error',
  Dispatched: 'primary',
  Received:   'success',
  Cancelled:  'default',
  // Returns' terminal state — green-success once goods are back at godown.
  Accepted:   'success',
}

// Quick-filter chip presets. `undefined` = show all statuses (default).
// Last preset "Return" (added 28 May 2026) filters by request_type and cuts
// across statuses so admin can see every Return in one place.
type Preset = {
  key: string
  label: string
  status?: RequestStatus
  requestType?: RequestType
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
    fromDate: fromDate || undefined,
    toDate: toDate || undefined,
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
        />
      ),
    },
  )
  return cols
  }, [activePreset])

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
          <Button
            variant="contained"
            startIcon={<Printer className="w-4 h-4" />}
            // noopener severs the parent↔child link so the new tab's
            // print dialog never blocks interaction on this tab.
            onClick={() => window.open('/print/cumulative', '_blank', 'noopener,noreferrer')}
            disabled={!hasPending}
            title={hasPending ? undefined : 'No in-progress requests to print'}
            sx={{ textTransform: 'none', fontWeight: 600 }}
          >
            Print Cumulative
          </Button>
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
                        bgcolor: '#FFFFFF', color: '#C62828',
                        borderColor: 'rgba(198,40,40,0.45)',
                        '&:hover': { borderColor: '#C62828', bgcolor: 'rgba(198,40,40,0.06)' },
                      }
                    : {
                        bgcolor: '#FFFFFF', color: '#1F1F1F',
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
                          bgcolor: '#FFFFFF', color: '#1F1F1F',
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
          onRowClick={(p) => navigate(`/admin/requests/${p.id}`)}
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
    </div>
  )
}
