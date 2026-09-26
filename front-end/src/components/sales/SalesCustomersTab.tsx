import { useEffect, useState } from 'react'
import {
  Alert, Box, Button, Chip, CircularProgress, InputAdornment, Pagination, Table, TableBody, TableCell,
  TableHead, TableRow, TextField, Typography,
} from '@mui/material'
import { DataGrid, type GridColDef } from '@mui/x-data-grid'
import { Search } from 'lucide-react'
import { useAdminCustomerLedger, useAdminCustomers, useAdminSetCreditLimit } from '../../hooks/useAdminPos'
import type { AdminCustomerDto } from '../../api/admin-pos/types'
import { formatINR } from '../../utils/format'
import { formatIstDateTime } from '../../utils/formatDate'
import { DetailDialog, Field, GridPaper } from './salesUi'
import { CREAM, GAIN_GREEN, gridSx, LOSS_RED } from './salesTheme'

/**
 * Credit (udhaar) customers across shops (feature #6). Not date-filtered —
 * an outstanding balance is a standing amount, not a period figure. The
 * shop filter from the page still applies.
 */
export default function SalesCustomersTab({ shopId }: { shopId: string }) {
  const [paging, setPaging] = useState({ page: 0, pageSize: 25 })
  const [outstandingOnly, setOutstandingOnly] = useState(true)
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState<AdminCustomerDto | null>(null)

  useEffect(() => {
    const t = setTimeout(() => { setSearch(searchInput.trim()); setPaging(p => ({ ...p, page: 0 })) }, 350)
    return () => clearTimeout(t)
  }, [searchInput])

  const list = useAdminCustomers({
    shopId: shopId || undefined,
    search: search || undefined,
    outstandingOnly,
    page: paging.page + 1,
    pageSize: paging.pageSize,
  })

  const columns: GridColDef<AdminCustomerDto>[] = [
    { field: 'name', headerName: 'Customer', flex: 1, minWidth: 160 },
    { field: 'phone', headerName: 'Phone', width: 130 },
    { field: 'shopName', headerName: 'Shop', width: 150 },
    { field: 'creditBalance', headerName: 'Outstanding', type: 'number', width: 135,
      renderCell: ({ value }) => (
        <span style={{ fontWeight: 800, color: (value as number) > 0 ? LOSS_RED : GAIN_GREEN }}>{formatINR(value as number)}</span>
      ) },
    { field: 'creditLimit', headerName: 'Limit', type: 'number', width: 115,
      valueFormatter: v => ((v as number) > 0 ? formatINR(v as number) : 'No limit') },
    { field: 'lastCreditAt', headerName: 'Last credit', width: 160, valueFormatter: v => formatIstDateTime(v as string | null) },
    { field: 'lastSettlementAt', headerName: 'Last repaid', width: 160, valueFormatter: v => formatIstDateTime(v as string | null) },
  ]

  return (
    <Box>
      <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center', flexWrap: 'wrap', mb: 2 }}>
        <Chip
          label="Only customers who owe money"
          onClick={() => { setOutstandingOnly(v => !v); setPaging(p => ({ ...p, page: 0 })) }}
          color={outstandingOnly ? 'warning' : 'default'}
          variant={outstandingOnly ? 'filled' : 'outlined'}
          sx={{ fontWeight: 700 }}
        />
        <TextField
          size="small"
          placeholder="Name, phone or code"
          value={searchInput}
          onChange={e => setSearchInput(e.target.value)}
          sx={{ minWidth: 240, bgcolor: CREAM }}
          slotProps={{ input: { startAdornment: <InputAdornment position="start"><Search size={16} /></InputAdornment> } }}
        />
        <Box sx={{ flex: 1 }} />
        {list.data && (
          <Typography sx={{ fontWeight: 800 }}>
            Total outstanding: <span style={{ color: LOSS_RED }}>{formatINR(list.data.totalOutstanding)}</span>
            <span style={{ opacity: 0.6, fontWeight: 600 }}> · {list.data.total} customer{list.data.total === 1 ? '' : 's'}</span>
          </Typography>
        )}
      </Box>

      {list.isError && <Alert severity="error" sx={{ mb: 2 }}>{list.error instanceof Error ? list.error.message : 'Failed to load customers.'}</Alert>}

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
          onRowClick={p => setOpen(p.row)}
          sx={gridSx}
          localeText={{ noRowsLabel: outstandingOnly ? 'Nobody owes money right now.' : 'No customers found.' }}
        />
      </GridPaper>

      <LedgerDialog customer={open} onClose={() => setOpen(null)} />
    </Box>
  )
}

function LedgerDialog({ customer, onClose }: { customer: AdminCustomerDto | null; onClose: () => void }) {
  const [page, setPage] = useState(1)
  const [shownFor, setShownFor] = useState<string | null>(null)
  // 25-Sep-2026: credit limits are admin-only — edited here. savedLimit
  // holds the new value until the list row (customer prop) refetches.
  const [limitInput, setLimitInput] = useState<string | null>(null)
  const [savedLimit, setSavedLimit] = useState<number | null>(null)
  const [limitError, setLimitError] = useState<string | null>(null)
  const setLimit = useAdminSetCreditLimit()
  if ((customer?.id ?? null) !== shownFor) {
    setShownFor(customer?.id ?? null); setPage(1)
    setLimitInput(null); setSavedLimit(null); setLimitError(null)
  }

  const ledger = useAdminCustomerLedger(customer?.id ?? null, page)
  const c = customer
  const pages = ledger.data ? Math.max(1, Math.ceil(ledger.data.total / ledger.data.pageSize)) : 1
  const limit = savedLimit ?? c?.creditLimit ?? 0

  const saveLimit = () => {
    if (!c || limitInput == null) return
    const v = Number(limitInput)
    if (limitInput.trim() === '' || !Number.isFinite(v) || v < 0) { setLimitError('Enter 0 or more (0 = no limit).'); return }
    setLimitError(null)
    setLimit.mutate(
      { customerId: c.id, creditLimit: Math.round(v * 100) / 100 },
      {
        onSuccess: updated => { setSavedLimit(updated.creditLimit); setLimitInput(null) },
        onError: e => setLimitError(e instanceof Error ? e.message : 'Failed to save the limit.'),
      },
    )
  }

  return (
    <DetailDialog open={!!c} onClose={onClose} title={c ? `${c.name} — credit history` : 'Credit history'}>
      {c && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(4, 1fr)' } }}>
            <Field label="Shop">{c.shopName}</Field>
            <Field label="Phone">{c.phone}</Field>
            <Field label="Outstanding"><span style={{ color: LOSS_RED, fontWeight: 800 }}>{formatINR(c.creditBalance)}</span></Field>
            <Field label="Limit">
              {limitInput == null ? (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  {limit > 0 ? formatINR(limit) : 'No limit'}
                  <Button size="small" onClick={() => { setLimitInput(String(limit)); setLimitError(null) }}
                    sx={{ textTransform: 'none', fontWeight: 700, minWidth: 0, p: 0.25 }}>
                    Edit
                  </Button>
                </Box>
              ) : (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <TextField
                    size="small" autoFocus value={limitInput}
                    onChange={e => { setLimitInput(e.target.value.replace(/[^d.]/g, '')); setLimitError(null) }}
                    sx={{ width: 110, bgcolor: CREAM }}
                    slotProps={{ htmlInput: { inputMode: 'decimal' } }}
                  />
                  <Button size="small" variant="contained" disabled={setLimit.isPending} onClick={saveLimit}
                    sx={{ textTransform: 'none', fontWeight: 700, minWidth: 0 }}>
                    {setLimit.isPending ? '…' : 'Save'}
                  </Button>
                  <Button size="small" disabled={setLimit.isPending} onClick={() => { setLimitInput(null); setLimitError(null) }}
                    sx={{ textTransform: 'none', minWidth: 0 }}>
                    Cancel
                  </Button>
                </Box>
              )}
            </Field>
          </Box>
          {limitError && <Alert severity="error">{limitError}</Alert>}
          {limitInput != null && (
            <Box sx={{ fontSize: 12, color: '#1F1F1F99' }}>
              0 = no limit. A limit below what they owe is allowed — it just blocks new credit until they pay down.
            </Box>
          )}
          {ledger.isLoading && <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}><CircularProgress size={24} /></Box>}
          {ledger.data && (
            <>
              <Table size="small">
                <TableHead>
                  <TableRow sx={{ bgcolor: '#FCD835' }}>
                    <TableCell sx={{ fontWeight: 800 }}>When</TableCell>
                    <TableCell sx={{ fontWeight: 800 }}>Entry</TableCell>
                    <TableCell sx={{ fontWeight: 800 }}>By</TableCell>
                    <TableCell sx={{ fontWeight: 800 }} align="right">Amount</TableCell>
                    <TableCell sx={{ fontWeight: 800 }} align="right">Balance</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {ledger.data.items.length === 0 && (
                    <TableRow><TableCell colSpan={5} sx={{ opacity: 0.6 }}>No entries.</TableCell></TableRow>
                  )}
                  {ledger.data.items.map(e => {
                    const adds = e.entryType === 'Credit'
                    return (
                      <TableRow key={e.id}>
                        <TableCell sx={{ fontSize: 12 }}>{formatIstDateTime(e.createdAt)}</TableCell>
                        <TableCell>
                          {e.entryType === 'Credit' ? 'Credit taken'
                            : e.entryType === 'Reversal'
                              ? (e.note?.startsWith('Return') ? 'Items returned — credit reduced' : 'Bill cancelled — credit reversed')
                            : `Repaid${e.mode ? ` (${e.mode})` : ''}`}
                          {e.billCode ? ` · ${e.billCode}` : ''}
                          {e.note && e.entryType !== 'Reversal' ? ` — ${e.note}` : ''}
                        </TableCell>
                        <TableCell>{e.createdByName ?? '—'}</TableCell>
                        <TableCell align="right" sx={{ fontWeight: 700, color: adds ? LOSS_RED : GAIN_GREEN }}>
                          {adds ? '+' : '−'}{formatINR(e.amount)}
                        </TableCell>
                        <TableCell align="right">{formatINR(e.balanceAfter)}</TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
              {pages > 1 && (
                <Box sx={{ display: 'flex', justifyContent: 'center' }}>
                  <Pagination count={pages} page={page} onChange={(_e, p) => setPage(p)} size="small" />
                </Box>
              )}
            </>
          )}
        </Box>
      )}
    </DetailDialog>
  )
}
