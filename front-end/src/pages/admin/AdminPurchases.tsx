import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { Alert, Box, Button, Chip, MenuItem, Paper, TextField, ToggleButton, ToggleButtonGroup } from '@mui/material'
import { DataGrid, type GridColDef } from '@mui/x-data-grid'
import PageHeader from '../../components/PageHeader'
import { useVendorPurchases } from '../../hooks/useVendorPurchases'
import { useVendors } from '../../hooks/useVendors'
import type { VendorPurchaseDto, VendorPurchaseStatus } from '../../api/vendor-purchases/types'
import { formatINR } from '../../utils/format'
import '../Products.css'

type StatusFilter = 'All' | VendorPurchaseStatus

export default function AdminPurchases() {
  const navigate = useNavigate()
  const [paginationModel, setPaginationModel] = useState({ page: 0, pageSize: 10 })
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('All')
  const [vendorFilter, setVendorFilter] = useState<string>('All')
  const [interstateOnly, setInterstateOnly] = useState(false)

  const vendorsQuery = useVendors()
  const list = useVendorPurchases({
    page: paginationModel.page + 1,
    pageSize: paginationModel.pageSize,
    status: statusFilter === 'All' ? undefined : statusFilter,
    vendorId: vendorFilter === 'All' ? undefined : vendorFilter,
    isInterstate: interstateOnly ? true : undefined,
  })

  const purchases = list.data?.items ?? []
  const total = list.data?.total ?? 0
  const vendorOptions = vendorsQuery.data ?? []

  const columns: GridColDef<VendorPurchaseDto>[] = [
    { field: 'code',          headerName: 'Code',     width: 110, sortable: false, filterable: false },
    { field: 'vendorName',    headerName: 'Vendor',   flex: 1.2, minWidth: 180, sortable: false, filterable: false },
    { field: 'godownName',    headerName: 'Godown',   width: 160, sortable: false, filterable: false },
    { field: 'invoiceNumber', headerName: 'Invoice #', width: 130, sortable: false, filterable: false },
    { field: 'invoiceDate',   headerName: 'Invoice Date', width: 130, sortable: false, filterable: false },
    {
      field: 'invoiceAmount', headerName: 'Amount', width: 140, sortable: false, filterable: false,
      renderCell: ({ value }) => formatINR(value),
    },
    {
      field: 'status', headerName: 'Status', width: 110, sortable: false, filterable: false,
      renderCell: ({ value }) => (
        <Chip label={value} size="small" variant={value === 'Received' ? 'filled' : 'outlined'} color={value === 'Received' ? 'success' : 'default'} />
      ),
    },
    {
      field: 'isInterstate', headerName: 'Interstate', width: 110, sortable: false, filterable: false,
      renderCell: ({ value }) => value
        ? <Chip label="Interstate" size="small" color="warning" variant="outlined" />
        : <span className="text-[#1F1F1F]/40">—</span>,
    },
    {
      // Phase 5b — at-a-glance compliance chip: gate matches + attached = green,
      // gate matches + missing = amber (blocks Receive), not required = muted dash.
      field: 'ewayStatus', headerName: 'E-way', width: 120, sortable: false, filterable: false,
      renderCell: ({ value }) => {
        if (value === 'Attached') {
          return <Chip label="Attached" size="small" sx={{ fontWeight: 700, bgcolor: '#EAF7EE', color: '#2E7D32', border: '1px solid #2E7D32' }} />
        }
        if (value === 'Missing') {
          return <Chip label="Missing" size="small" sx={{ fontWeight: 700, bgcolor: '#FFF3CD', color: '#8A6200', border: '1px solid #E0A800' }} />
        }
        return <span className="text-[#1F1F1F]/40">—</span>
      },
    },
    {
      field: 'actions', headerName: '', width: 110, sortable: false, filterable: false,
      align: 'right', headerAlign: 'right',
      renderCell: ({ row }) => (
        <Button size="small" onClick={() => navigate(`/admin/purchases/${row.id}`)} sx={{ textTransform: 'none', fontWeight: 600 }}>
          View
        </Button>
      ),
    },
  ]

  const errorMessage = list.isError
    ? (list.error instanceof Error ? list.error.message : 'Failed to load purchases.')
    : null

  return (
    <div>
      <PageHeader
        title="Purchases"
        subtitle={list.isLoading ? 'Loading…' : `${total} purchase records`}
        action={
          <Button
            variant="contained"
            color="primary"
            startIcon={<Plus className="w-4 h-4" />}
            onClick={() => navigate('/admin/purchases/new')}
            sx={{ textTransform: 'none', fontWeight: 600 }}
          >
            New Purchase
          </Button>
        }
      />

      {errorMessage && <Alert severity="error" sx={{ mb: 2 }}>{errorMessage}</Alert>}

      <Paper sx={{ p: 2, mb: 2, borderRadius: 2.5, border: '2px solid #1F1F1F', boxShadow: '4px 4px 0 0 #FCD835' }} elevation={0}>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, alignItems: 'center' }}>
          <ToggleButtonGroup
            size="small"
            value={statusFilter}
            exclusive
            onChange={(_e, v) => { if (v) { setStatusFilter(v); setPaginationModel(m => ({ ...m, page: 0 })) } }}
          >
            <ToggleButton value="All" sx={{ textTransform: 'none' }}>All</ToggleButton>
            <ToggleButton value="Ordered" sx={{ textTransform: 'none' }}>Ordered</ToggleButton>
            <ToggleButton value="Received" sx={{ textTransform: 'none' }}>Received</ToggleButton>
          </ToggleButtonGroup>

          <TextField
            select size="small" label="Vendor" value={vendorFilter}
            onChange={e => { setVendorFilter(e.target.value); setPaginationModel(m => ({ ...m, page: 0 })) }}
            sx={{ minWidth: 220 }}
          >
            <MenuItem value="All">All vendors</MenuItem>
            {vendorOptions.map(v => <MenuItem key={v.id} value={v.id}>{v.name}</MenuItem>)}
          </TextField>

          <Chip
            label="Interstate only"
            onClick={() => { setInterstateOnly(o => !o); setPaginationModel(m => ({ ...m, page: 0 })) }}
            color={interstateOnly ? 'warning' : 'default'}
            variant={interstateOnly ? 'filled' : 'outlined'}
          />
        </Box>
      </Paper>

      <Paper className="data-page-paper" sx={{ borderRadius: 2.5 }} elevation={0}>
        <DataGrid
          className="data-page-grid"
          rows={purchases}
          columns={columns}
          getRowId={r => r.id}
          loading={list.isLoading}
          autoHeight
          disableRowSelectionOnClick
          disableColumnMenu
          paginationMode="server"
          rowCount={total}
          paginationModel={paginationModel}
          onPaginationModelChange={setPaginationModel}
          pageSizeOptions={[10, 25, 50, 100]}
        />
      </Paper>
    </div>
  )
}
