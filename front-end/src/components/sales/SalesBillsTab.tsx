import { useEffect, useState } from 'react'
import { Alert, Box, InputAdornment, TextField } from '@mui/material'
import { DataGrid, type GridColDef } from '@mui/x-data-grid'
import { Search } from 'lucide-react'
import { useAdminBills } from '../../hooks/useAdminPos'
import type { AdminBillListItemDto } from '../../api/admin-pos/types'
import type { BillStatus, TenderMode } from '../../api/bills/types'
import { formatINR } from '../../utils/format'
import { formatIstDateTime } from '../../utils/formatDate'
import { BillStatusChip, GridPaper, SegmentedTabs } from './salesUi'
import { CREAM, gridSx, LOSS_RED } from './salesTheme'
import BillDetailDialog from './BillDetailDialog'
import type { SalesFilters } from './SalesFilterBar'

type StatusFilter = 'All' | BillStatus
type ModeFilter = 'All' | TenderMode

/** All bills across shops (feature #1) — server-paged, searchable. */
export default function SalesBillsTab({ filters }: { filters: SalesFilters }) {
  const [paging, setPaging] = useState({ page: 0, pageSize: 25 })
  const [status, setStatus] = useState<StatusFilter>('All')
  const [mode, setMode] = useState<ModeFilter>('All')
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)

  // Debounce the search box so typing doesn't fire a request per key.
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 350)
    return () => clearTimeout(t)
  }, [searchInput])

  // Any filter change goes back to page 1.
  const [pageKey, setPageKey] = useState('')
  const key = `${filters.from}|${filters.to}|${filters.shopId}|${status}|${mode}|${search}`
  if (key !== pageKey) {
    setPageKey(key)
    if (paging.page !== 0) setPaging(p => ({ ...p, page: 0 }))
  }

  const list = useAdminBills({
    shopId: filters.shopId || undefined,
    from: filters.from,
    to: filters.to,
    status: status === 'All' ? undefined : status,
    paymentMode: mode === 'All' ? undefined : mode,
    search: search || undefined,
    page: paging.page + 1,
    pageSize: paging.pageSize,
  })

  const columns: GridColDef<AdminBillListItemDto>[] = [
    { field: 'code', headerName: 'Bill', width: 110 },
    { field: 'createdAt', headerName: 'Date & time', width: 165, valueFormatter: v => formatIstDateTime(v as string) },
    { field: 'shopName', headerName: 'Shop', width: 150 },
    { field: 'createdByName', headerName: 'Cashier', width: 140, valueFormatter: v => (v as string) ?? '—' },
    { field: 'customerName', headerName: 'Customer', width: 150, valueFormatter: v => (v as string) ?? 'Walk-in' },
    { field: 'paymentMode', headerName: 'Paid by', width: 95 },
    { field: 'totalQty', headerName: 'Qty', type: 'number', width: 70 },
    { field: 'totalAmount', headerName: 'Total', type: 'number', width: 120,
      renderCell: ({ row }) => (
        <span style={{ fontWeight: 800, textDecoration: row.status === 'Cancelled' ? 'line-through' : undefined }}>
          {formatINR(row.totalAmount)}
        </span>
      ) },
    { field: 'returnedAmount', headerName: 'Returned', type: 'number', width: 110,
      renderCell: ({ value }) => (value as number) > 0
        ? <span style={{ color: LOSS_RED, fontWeight: 700 }}>−{formatINR(value as number)}</span>
        : <span style={{ opacity: 0.4 }}>—</span> },
    { field: 'status', headerName: 'Status', width: 115, renderCell: ({ value }) => <BillStatusChip status={value as string} /> },
  ]

  return (
    <Box>
      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center', mb: 2 }}>
        <SegmentedTabs<StatusFilter>
          value={status}
          onChange={setStatus}
          options={[{ key: 'All', label: 'All' }, { key: 'Issued', label: 'Issued' }, { key: 'Cancelled', label: 'Cancelled' }]}
        />
        <SegmentedTabs<ModeFilter>
          value={mode}
          onChange={setMode}
          options={[{ key: 'All', label: 'Any payment' }, { key: 'Cash', label: 'Cash' }, { key: 'UPI', label: 'UPI' }, { key: 'Credit', label: 'Credit' }]}
        />
        <TextField
          size="small"
          placeholder="Bill no, customer name or phone"
          value={searchInput}
          onChange={e => setSearchInput(e.target.value)}
          sx={{ minWidth: 280, flex: 1, maxWidth: 380, bgcolor: CREAM }}
          slotProps={{ input: { startAdornment: <InputAdornment position="start"><Search size={16} /></InputAdornment> } }}
        />
      </Box>

      {list.isError && <Alert severity="error" sx={{ mb: 2 }}>{list.error instanceof Error ? list.error.message : 'Failed to load bills.'}</Alert>}

      <GridPaper>
        <DataGrid
          rows={list.data?.items ?? []}
          columns={columns}
          getRowId={r => r.id}
          loading={list.isFetching}
          autoHeight
          disableRowSelectionOnClick
          disableColumnMenu
          paginationMode="server"
          rowCount={list.data?.total ?? 0}
          paginationModel={paging}
          onPaginationModelChange={setPaging}
          pageSizeOptions={[25, 50, 100]}
          onRowClick={p => setOpenId(p.row.id)}
          sx={gridSx}
          localeText={{ noRowsLabel: 'No bills for these filters.' }}
        />
      </GridPaper>

      <BillDetailDialog billId={openId} onClose={() => setOpenId(null)} />
    </Box>
  )
}
