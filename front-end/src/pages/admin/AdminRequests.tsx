import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, Printer } from 'lucide-react'
import { Alert, Box, Button, Chip, InputAdornment, Paper, TextField } from '@mui/material'
import { DataGrid, type GridColDef } from '@mui/x-data-grid'
import PageHeader from '../../components/PageHeader'
import { DispatchedCell } from '../../components/DispatchedCell'
import { useAllStockRequests, useCumulativePending, useRequestCountByShop } from '../../hooks/useStockRequests'
import { formatINR } from '../../utils/format'
import { formatIstDateTime } from '../../utils/formatDate'
import type { RequestStatus, StockRequestDto } from '../../api/stock-requests/types'
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
}

// Quick-filter chip presets. `undefined` = show all statuses (default).
type Preset = { key: string; label: string; status: RequestStatus | undefined }
const PRESETS: Preset[] = [
  { key: 'all',        label: 'All',        status: undefined    },
  { key: 'pending',    label: 'Pending',    status: 'Pending'    },
  { key: 'approved',   label: 'Approved',   status: 'Approved'   },
  { key: 'dispatched', label: 'Dispatched', status: 'Dispatched' },
  { key: 'received',   label: 'Received',   status: 'Received'   },
  { key: 'rejected',   label: 'Rejected',   status: 'Rejected'   },
  { key: 'cancelled',  label: 'Cancelled',  status: 'Cancelled'  },
]

export default function AdminRequests() {
  const navigate = useNavigate()
  // Default to All — admin usually wants the full picture, not a single bucket.
  const [activePreset, setActivePreset] = useState<string>('all')
  // Optional second-level filter — clicking a shop chip toggles it.
  const [shopId, setShopId] = useState<string | undefined>(undefined)
  const [search, setSearch] = useState<string>('')
  const [paginationModel, setPaginationModel] = useState({ page: 0, pageSize: 10 })

  const currentStatus = PRESETS.find(p => p.key === activePreset)?.status

  const list = useAllStockRequests({
    status: currentStatus,
    shopId,
    search: search.trim() || undefined,
    page: paginationModel.page + 1,
    pageSize: paginationModel.pageSize,
  })

  // Per-shop badge counts for the active status filter. Refetches whenever
  // the status preset changes; shops with 0 matches are pruned server-side.
  const shopCounts = useRequestCountByShop({ status: currentStatus })

  // Admin sees all inventories — Print Cumulative button is enabled as long
  // as some Pending row exists anywhere across the system.
  const cumulative = useCumulativePending()
  const hasPending = (cumulative.data?.length ?? 0) > 0

  const rows  = list.data?.items ?? []
  const total = list.data?.total ?? 0

  const columns = useMemo<GridColDef<StockRequestDto>[]>(() => {
    const cols: GridColDef<StockRequestDto>[] = [
    { field: 'code', headerName: 'Code', width: 110, sortable: false, filterable: false },
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
          variant={row.status === 'Received' ? 'filled' : 'outlined'}
        />
      ),
    },
  )
  return cols
  }, [activePreset])

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
            title={hasPending ? undefined : 'No pending requests to print'}
            sx={{ textTransform: 'none', fontWeight: 600 }}
          >
            Print Cumulative
          </Button>
        }
      />

      {errorMessage && <Alert severity="error" sx={{ mb: 2 }}>{errorMessage}</Alert>}

      {/* Quick-filter chips + search — mirrors the Inventory list page */}
      <Box sx={{ display: 'flex', gap: 1.5, mb: 1.5, flexWrap: 'wrap', alignItems: 'center' }}>
        {PRESETS.map(p => {
          const active = activePreset === p.key
          return (
            <Button
              key={p.key}
              onClick={() => {
                setActivePreset(p.key)
                // Drop the shop drill-down when the status changes, otherwise
                // the user can land on a (status, shop) combo where that shop
                // has zero rows and the page looks broken.
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
                  ? { bgcolor: '#1F1F1F', color: '#FCD835', '&:hover': { bgcolor: '#0A0A0A' } }
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

        <Box sx={{ flex: 1 }} />

        <TextField
          size="small"
          value={search}
          onChange={e => { setSearch(e.target.value); setPaginationModel(m => ({ ...m, page: 0 })) }}
          placeholder="Search by code"
          sx={{
            minWidth: 220,
            '& .MuiOutlinedInput-root': { bgcolor: 'transparent' },
          }}
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

      {/* Per-shop count chips for the active status filter. Server omits
          zero-count shops; we render nothing when no shop has rows for this
          filter (also covers the loading-first-time case). Click to drill
          down; click the active chip again to clear. */}
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
                    ? { bgcolor: '#1F1F1F', color: '#FCD835', '&:hover': { bgcolor: '#0A0A0A' } }
                    : {
                        bgcolor: '#FFFFFF', color: '#1F1F1F',
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
          onRowClick={(p) => navigate(`/admin/requests/${p.id}`)}
          paginationMode="server"
          rowCount={total}
          paginationModel={paginationModel}
          onPaginationModelChange={setPaginationModel}
          pageSizeOptions={[10, 25, 50, 100]}
          sx={{ '& .MuiDataGrid-row': { cursor: 'pointer' } }}
        />
      </Paper>
    </div>
  )
}
