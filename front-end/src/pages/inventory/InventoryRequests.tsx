import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, Printer } from 'lucide-react'
import { Alert, Box, Button, Chip, InputAdornment, Paper, TextField } from '@mui/material'
import { DataGrid, type GridColDef } from '@mui/x-data-grid'
import PageHeader from '../../components/PageHeader'
import { DispatchedCell } from '../../components/DispatchedCell'
import { useIncomingStockRequests } from '../../hooks/useStockRequests'
import { formatINR } from '../../utils/format'
import type { RequestStatus, StockRequestDto } from '../../api/stock-requests/types'
import '../Products.css'

const STATUS_COLOR: Record<RequestStatus, 'default' | 'primary' | 'success' | 'error' | 'warning' | 'info'> = {
  Pending: 'warning', Approved: 'info', Rejected: 'error',
  Dispatched: 'primary', Received: 'success', Cancelled: 'default',
}

// Quick-filter presets. Each maps to a single status the BE understands.
// `undefined` = show all statuses.
type Preset = { key: string; label: string; status: RequestStatus | undefined }
// Approval step was removed from the workflow — a freshly submitted request
// is Pending and goes straight to inventory for dispatch. Legacy rows still
// in Approved state remain dispatchable (BE allows both), but new traffic
// flows Pending → Dispatched → Received.
const PRESETS: Preset[] = [
  { key: 'pending',    label: 'Needs Action',  status: 'Pending'    },
  { key: 'dispatched', label: 'In Transit',    status: 'Dispatched' },
  { key: 'received',   label: 'Delivered',     status: 'Received'   },
  { key: 'all',        label: 'All',           status: undefined    },
]

export default function InventoryRequests() {
  const navigate = useNavigate()
  // Default: Needs Action (Approved)
  const [activePreset, setActivePreset] = useState<string>('pending')
  const [search, setSearch] = useState<string>('')
  const [paginationModel, setPaginationModel] = useState({ page: 0, pageSize: 10 })

  const currentStatus = PRESETS.find(p => p.key === activePreset)?.status

  const list = useIncomingStockRequests({
    status: currentStatus,
    search: search.trim() || undefined,
    page: paginationModel.page + 1,
    pageSize: paginationModel.pageSize,
  })

  const rows  = list.data?.items ?? []
  const total = list.data?.total ?? 0

  const columns = useMemo<GridColDef<StockRequestDto>[]>(() => [
    {
      // Most useful triage signal — date the request landed in the queue.
      // Date-only (no time) so it stays compact at the leading edge.
      field: 'submittedAt', headerName: 'Requested Date', width: 150, sortable: false, filterable: false,
      renderCell: ({ value }) => value
        ? new Date(value as string).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' })
        : <span className="text-[#1F1F1F]/40">—</span>,
    },
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
          variant={row.status === 'Received' ? 'filled' : 'outlined'}
        />
      ),
    },
  ], [])

  const errorMessage = list.isError
    ? (list.error instanceof Error ? list.error.message : 'Failed to load requests.')
    : null

  return (
    <div>
      <PageHeader
        title="Incoming Requests"
        subtitle={list.isLoading ? 'Loading…' : `${total} ${total === 1 ? 'request' : 'requests'}`}
        action={
          <Button
            variant="contained"
            startIcon={<Printer className="w-4 h-4" />}
            onClick={() => window.open('/print/cumulative', '_blank', 'noopener,noreferrer')}
            sx={{ textTransform: 'none', fontWeight: 600 }}
          >
            Print Cumulative
          </Button>
        }
      />

      {errorMessage && <Alert severity="error" sx={{ mb: 2 }}>{errorMessage}</Alert>}

      {/* Quick-filter chips + search */}
      <Box sx={{ display: 'flex', gap: 1.5, mb: 2, flexWrap: 'wrap', alignItems: 'center' }}>
        {PRESETS.map(p => {
          const active = activePreset === p.key
          return (
            <Button
              key={p.key}
              onClick={() => { setActivePreset(p.key); setPaginationModel(m => ({ ...m, page: 0 })) }}
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
    </div>
  )
}
