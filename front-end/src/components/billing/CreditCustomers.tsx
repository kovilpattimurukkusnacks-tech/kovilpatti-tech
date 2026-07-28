import { useState } from 'react'
import {
  Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle,
  InputAdornment, MenuItem, Paper, Table, TableBody, TableCell, TableContainer, TableHead,
  TablePagination, TableRow, TextField,
} from '@mui/material'
import { Banknote, HandCoins, Receipt, Smartphone } from 'lucide-react'
import { formatINR } from '../../utils/format'
import { formatIstDateTime } from '../../utils/formatDate'
import { useCustomerList, useSettleCredit, useCustomerLedger } from '../../hooks/useCustomers'
import { useDebouncedValue } from '../../hooks/useDebouncedValue'
import type { CustomerDto, SettleMode } from '../../api/customers/types'

const HEAD_SX = {
  fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: 0.5,
  fontSize: 11, bgcolor: '#FFF8DC',
}

// ───────────────────────────────────────────────────────────────
// Credit customers (feature #4). Shop-scoped list with running balance;
// settle a repayment (Cash/UPI) or view the credit statement.
// ───────────────────────────────────────────────────────────────

export default function CreditCustomers() {
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(20)
  const debounced = useDebouncedValue(search.trim(), 300)
  const list = useCustomerList({ search: debounced || undefined, page: page + 1, pageSize })

  const [settleFor, setSettleFor] = useState<CustomerDto | null>(null)
  const [ledgerFor, setLedgerFor] = useState<CustomerDto | null>(null)

  const rows = list.data?.items ?? []
  const total = list.data?.total ?? 0

  return (
    <Box>
      <TextField
        fullWidth
        size="small"
        value={search}
        onChange={e => { setSearch(e.target.value); setPage(0) }}
        placeholder="Search customers by name or phone…"
        sx={{ mb: 2, maxWidth: 420, '& .MuiOutlinedInput-root': { bgcolor: '#FFFFFF' } }}
      />

      <Paper elevation={0} sx={{ borderRadius: 2, border: '2px solid #1F1F1F', bgcolor: '#FFFFFF', overflow: 'hidden' }}>
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow sx={{ bgcolor: '#FCD835' }}>
                <TableCell sx={HEAD_SX}>Customer</TableCell>
                <TableCell sx={HEAD_SX}>Phone</TableCell>
                <TableCell sx={HEAD_SX} align="right">Limit</TableCell>
                <TableCell sx={HEAD_SX} align="right">Balance due</TableCell>
                <TableCell sx={{ ...HEAD_SX, width: 200 }} align="center">Action</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.length === 0 && !list.isLoading && (
                <TableRow><TableCell colSpan={5} align="center" sx={{ color: '#1F1F1F99', py: 4 }}>No customers yet.</TableCell></TableRow>
              )}
              {rows.map(c => (
                <TableRow key={c.id} sx={{ bgcolor: '#FFFBE6' }}>
                  <TableCell sx={{ fontWeight: 700 }}>{c.name}</TableCell>
                  <TableCell>{c.phone}</TableCell>
                  <TableCell align="right">{c.creditLimit > 0 ? formatINR(c.creditLimit) : '—'}</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 700, color: c.creditBalance > 0 ? '#C62828' : '#2E7D32' }}>
                    {formatINR(c.creditBalance)}
                  </TableCell>
                  <TableCell align="center">
                    <Box sx={{ display: 'flex', gap: 0.5, justifyContent: 'center' }}>
                      <Button size="small" startIcon={<HandCoins className="w-3.5 h-3.5" />} disabled={c.creditBalance <= 0}
                        onClick={() => setSettleFor(c)} sx={{ textTransform: 'none', fontWeight: 700, color: '#1F1F1F' }}>
                        Settle
                      </Button>
                      <Button size="small" startIcon={<Receipt className="w-3.5 h-3.5" />}
                        onClick={() => setLedgerFor(c)} sx={{ textTransform: 'none', fontWeight: 700, color: '#1F1F1F' }}>
                        Statement
                      </Button>
                    </Box>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
        <TablePagination
          component="div"
          count={total}
          page={page}
          onPageChange={(_, p) => setPage(p)}
          rowsPerPage={pageSize}
          onRowsPerPageChange={e => { setPageSize(parseInt(e.target.value, 10)); setPage(0) }}
          rowsPerPageOptions={[20, 50, 100]}
        />
      </Paper>

      <SettleDialog customer={settleFor} onClose={() => setSettleFor(null)} />
      <LedgerDialog customer={ledgerFor} onClose={() => setLedgerFor(null)} />
    </Box>
  )
}

function SettleDialog({ customer, onClose }: { customer: CustomerDto | null; onClose: () => void }) {
  const settle = useSettleCredit()
  const [amount, setAmount] = useState('')
  const [mode, setMode] = useState<SettleMode>('Cash')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)

  const close = () => { setAmount(''); setMode('Cash'); setNote(''); setError(null); onClose() }

  const handleSettle = () => {
    if (!customer) return
    const amt = parseFloat(amount)
    if (!amt || amt <= 0) { setError('Enter an amount greater than zero.'); return }
    setError(null)
    settle.mutate(
      { id: customer.id, req: { amount: amt, mode, note: note.trim() || null } },
      {
        onSuccess: () => close(),
        onError: err => setError(err instanceof Error ? err.message : 'Could not record the settlement.'),
      },
    )
  }

  return (
    <Dialog open={!!customer} onClose={close} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ fontWeight: 700 }}>Settle credit · {customer?.name}</DialogTitle>
      <DialogContent>
        <Box sx={{ fontSize: 13, color: '#1F1F1F99', mb: 2 }}>
          Outstanding: <strong>{customer ? formatINR(customer.creditBalance) : ''}</strong>
        </Box>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <TextField
          fullWidth autoFocus type="number" label="Amount received"
          value={amount} onChange={e => setAmount(e.target.value)}
          slotProps={{ input: { startAdornment: <InputAdornment position="start">₹</InputAdornment> } }}
          sx={{ mb: 2 }}
        />
        <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
          {([
            { m: 'Cash' as const, icon: <Banknote className="w-4 h-4" /> },
            { m: 'UPI' as const, icon: <Smartphone className="w-4 h-4" /> },
          ]).map(({ m, icon }) => (
            <Button key={m} fullWidth disableElevation variant={mode === m ? 'contained' : 'outlined'}
              startIcon={icon} onClick={() => setMode(m)}
              sx={{ textTransform: 'none', fontWeight: 700,
                ...(mode === m
                  ? { background: 'linear-gradient(90deg, #C28A00 0%, #E6B800 35%, #FFD700 65%, #FFF1A6 100%)', color: '#1F1F1F' }
                  : { color: '#1F1F1F', borderColor: 'rgba(31,31,31,0.35)' }) }}>
              {m}
            </Button>
          ))}
        </Box>
        <TextField fullWidth multiline minRows={2} label="Note (optional)" value={note}
          onChange={e => setNote(e.target.value)} inputProps={{ maxLength: 500 }} />
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={close} sx={{ textTransform: 'none', fontWeight: 700 }}>Cancel</Button>
        <Button variant="contained" disabled={settle.isPending} onClick={handleSettle}
          sx={{ textTransform: 'none', fontWeight: 700 }}>
          {settle.isPending ? 'Saving…' : 'Record Settlement'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

function LedgerDialog({ customer, onClose }: { customer: CustomerDto | null; onClose: () => void }) {
  const [page, setPage] = useState(0)
  const ledger = useCustomerLedger(customer?.id, page + 1)
  const rows = ledger.data?.items ?? []
  const total = ledger.data?.total ?? 0

  return (
    <Dialog open={!!customer} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontWeight: 700 }}>Credit statement · {customer?.name}</DialogTitle>
      <DialogContent dividers>
        {ledger.isLoading && <Box sx={{ textAlign: 'center', py: 3 }}><CircularProgress size={24} /></Box>}
        {!ledger.isLoading && (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={HEAD_SX}>When</TableCell>
                <TableCell sx={HEAD_SX}>Type</TableCell>
                <TableCell sx={HEAD_SX} align="right">Amount</TableCell>
                <TableCell sx={HEAD_SX} align="right">Balance</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.length === 0 && (
                <TableRow><TableCell colSpan={4} align="center" sx={{ color: '#1F1F1F99', py: 3 }}>No entries.</TableCell></TableRow>
              )}
              {rows.map(e => (
                <TableRow key={e.id}>
                  <TableCell sx={{ fontSize: 12 }}>{formatIstDateTime(e.createdAt)}</TableCell>
                  <TableCell>
                    {e.entryType === 'Credit' ? 'Credit taken' : `Settled${e.mode ? ` (${e.mode})` : ''}`}
                    {e.billCode ? ` · ${e.billCode}` : ''}
                  </TableCell>
                  <TableCell align="right" sx={{ fontWeight: 700, color: e.entryType === 'Credit' ? '#C62828' : '#2E7D32' }}>
                    {e.entryType === 'Credit' ? '+' : '−'}{formatINR(e.amount)}
                  </TableCell>
                  <TableCell align="right">{formatINR(e.balanceAfter)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <TablePagination
          component="div" count={total} page={page} onPageChange={(_, p) => setPage(p)}
          rowsPerPage={20} rowsPerPageOptions={[20]}
        />
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} variant="contained" sx={{ textTransform: 'none', fontWeight: 700 }}>Close</Button>
      </DialogActions>
    </Dialog>
  )
}
