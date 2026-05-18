import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Printer } from 'lucide-react'
import { Alert, Box, Button, Chip, MenuItem, Paper, TextField } from '@mui/material'
import { DataGrid, type GridColDef } from '@mui/x-data-grid'
import PageHeader from '../../components/PageHeader'
import { DispatchedCell } from '../../components/DispatchedCell'
import { useAllStockRequests } from '../../hooks/useStockRequests'
import { formatINR } from '../../utils/format'
import type { RequestStatus, StockRequestDto } from '../../api/stock-requests/types'
import '../Products.css'

const STATUS_OPTIONS: RequestStatus[] = ['Pending', 'Approved', 'Rejected', 'Dispatched', 'Received', 'Cancelled']

const STATUS_COLOR: Record<RequestStatus, 'default' | 'primary' | 'success' | 'error' | 'warning' | 'info'> = {
  Pending:    'warning',
  Approved:   'info',
  Rejected:   'error',
  Dispatched: 'primary',
  Received:   'success',
  Cancelled:  'default',
}

export default function AdminRequests() {
  const navigate = useNavigate()
  const [filters, setFilters] = useState<{ status?: RequestStatus; search?: string }>({})
  const [paginationModel, setPaginationModel] = useState({ page: 0, pageSize: 10 })

  const list = useAllStockRequests({
    status: filters.status,
    search: filters.search,
    page: paginationModel.page + 1,
    pageSize: paginationModel.pageSize,
  })

  const rows  = list.data?.items ?? []
  const total = list.data?.total ?? 0

  const columns = useMemo<GridColDef<StockRequestDto>[]>(() => [
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
      renderCell: ({ value }) => value ? new Date(value as string).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : '—',
    },
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
      // Null until the shop user confirms receipt. Muted "—" otherwise.
      field: 'receivedAt', headerName: 'Received Time', flex: 1, minWidth: 170, sortable: false, filterable: false,
      renderCell: ({ value }) => value
        ? new Date(value as string).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })
        : <span className="text-[#1F1F1F]/40">—</span>,
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
  ], [])

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
            sx={{ textTransform: 'none', fontWeight: 600 }}
          >
            Print Cumulative
          </Button>
        }
      />

      {errorMessage && <Alert severity="error" sx={{ mb: 2 }}>{errorMessage}</Alert>}

      <Box sx={{ display: 'flex', gap: 2, mb: 2, flexWrap: 'wrap' }}>
        <TextField
          select size="small" label="Status" value={filters.status ?? ''}
          onChange={e => {
            setFilters(f => ({ ...f, status: (e.target.value || undefined) as RequestStatus | undefined }))
            setPaginationModel(m => ({ ...m, page: 0 }))
          }}
          sx={{ minWidth: 180 }}
        >
          <MenuItem value="">All statuses</MenuItem>
          {STATUS_OPTIONS.map(s => <MenuItem key={s} value={s}>{s}</MenuItem>)}
        </TextField>
        <TextField
          size="small" label="Search by code"
          value={filters.search ?? ''}
          onChange={e => {
            setFilters(f => ({ ...f, search: e.target.value || undefined }))
            setPaginationModel(m => ({ ...m, page: 0 }))
          }}
          placeholder="e.g. REQ0001"
          sx={{ minWidth: 200 }}
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
