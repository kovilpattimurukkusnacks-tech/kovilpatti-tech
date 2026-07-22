import { useMemo, useState } from 'react'
import {
  Alert, Autocomplete, Box, Button, Card, CardContent, Chip, Dialog, DialogActions,
  DialogContent, DialogTitle, IconButton, MenuItem, Paper, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, TextField, Typography,
} from '@mui/material'
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider'
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs'
import { DatePicker } from '@mui/x-date-pickers/DatePicker'
import dayjs from 'dayjs'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import PageHeader from '../../components/PageHeader'
import ConfirmDialog from '../../components/ConfirmDialog'
import { useApp } from '../../context/AppContext'
import { useInventory } from '../../hooks/useInventories'
import {
  useInventoryExpenses, useCreateInventoryExpense,
  useUpdateInventoryExpense, useDeleteInventoryExpense,
} from '../../hooks/useInventoryExpenses'
import type { InventoryExpenseDto } from '../../api/inventory-expenses/types'
import { ValidationError } from '../../api/errors'
import { formatAmountInput, formatINR, stripAmountFormat } from '../../utils/format'
import { GOLD_GRADIENT } from '../../theme'

// Well-known godown expense categories — mirror of the shop-side list
// (client picked "same as shop" on 21-Jul-2026, since godowns also pay
// Rent / Electricity / Salary / Maintenance etc.). freeSolo Autocomplete
// still lets the inventory user type anything godown-specific (Loading
// Charges / Packing Material / Transport Fuel) — those unrecognised
// values fall back to the "Others" icon/colour.
const CATEGORIES = [
  { key: 'Electricity',   color: '#FFA000' /* theme.warning */ },
  { key: 'Rent',          color: '#C28A00' /* gold-1, GOLD_GRADIENT stop */ },
  { key: 'Water',         color: '#0277BD' /* theme.info */ },
  { key: 'Staff Salary',  color: '#7B1FA2' /* theme.dispatched */ },
  { key: 'Maintenance',   color: '#FCD835' /* theme.secondary */ },
  { key: 'Internet/Wifi', color: '#2E7D32' /* theme.success */ },
  { key: 'Others',        color: '#3D3D3D' /* theme.text.secondary */ },
] as const
type Category = string

function categoryMeta(cat: string) {
  return CATEGORIES.find(c => c.key === cat) ?? CATEGORIES[CATEGORIES.length - 1]
}

const HEAD_SX = {
  fontWeight: 700,
  textTransform: 'uppercase' as const,
  letterSpacing: 0.5,
  fontSize: 11,
}

function fmtDate(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

function monthBounds(yyyyMm: string): { from: string; to: string } {
  const [y, m] = yyyyMm.split('-').map(Number)
  const lastDay = new Date(y, m, 0).getDate()
  return { from: `${yyyyMm}-01`, to: `${yyyyMm}-${String(lastDay).padStart(2, '0')}` }
}

function monthOptions(count = 12): { value: string; label: string }[] {
  const now = new Date()
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    return { value, label: d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }) }
  })
}

export default function InventoryExpenses() {
  const { currentUser } = useApp()
  const inventoryQuery = useInventory(currentUser?.inventoryId ?? undefined)
  const inventoryName = inventoryQuery.data?.name ?? 'your godown'

  const [selectedMonth, setSelectedMonth] = useState(() => new Date().toISOString().slice(0, 7))
  const { from, to } = useMemo(() => monthBounds(selectedMonth), [selectedMonth])
  const months = useMemo(() => monthOptions(), [])

  const expensesQuery = useInventoryExpenses(from, to)
  const entries = useMemo(() => expensesQuery.data ?? [], [expensesQuery.data])
  const createMutation = useCreateInventoryExpense()
  const updateMutation = useUpdateInventoryExpense()
  const deleteMutation = useDeleteInventoryExpense()

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<InventoryExpenseDto | null>(null)

  const [formCategory, setFormCategory] = useState<Category>('')
  const [formAmount, setFormAmount] = useState('')
  const [formNote, setFormNote] = useState('')
  const [formDate, setFormDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [formErr, setFormErr] = useState<string | null>(null)

  const total = entries.reduce((s, e) => s + e.amount, 0)
  const byCategory = useMemo(() => {
    const map = new Map<Category, number>()
    for (const e of entries) map.set(e.category, (map.get(e.category) ?? 0) + e.amount)
    return Array.from(map.entries())
      .map(([category, amount]) => ({ category, amount }))
      .sort((a, b) => b.amount - a.amount)
  }, [entries])
  const largestCategory = byCategory[0]

  function openAdd() {
    setEditingId(null)
    setFormCategory('')
    setFormAmount('')
    setFormNote('')
    setFormDate(new Date().toISOString().slice(0, 10))
    setFormErr(null)
    setDialogOpen(true)
  }

  function openEdit(entry: InventoryExpenseDto) {
    setEditingId(entry.id)
    setFormCategory(entry.category)
    setFormAmount(String(entry.amount))
    setFormNote(entry.note ?? '')
    setFormDate(entry.expenseDate)
    setFormErr(null)
    setDialogOpen(true)
  }

  function handleDeleteClick(entry: InventoryExpenseDto) {
    setDeleteTarget(entry)
  }

  function confirmDelete() {
    if (!deleteTarget) return
    deleteMutation.mutate(deleteTarget.id)
    setDeleteTarget(null)
  }

  async function handleSave() {
    if (!formCategory.trim()) {
      setFormErr('Pick or type a category.')
      return
    }
    const amount = parseFloat(formAmount)
    if (!Number.isFinite(amount) || amount <= 0) {
      setFormErr('Enter a valid amount greater than zero.')
      return
    }
    setFormErr(null)
    const req = { category: formCategory.trim(), amount, note: formNote.trim() || undefined, expenseDate: formDate }
    try {
      if (editingId) {
        await updateMutation.mutateAsync({ id: editingId, req })
      } else {
        await createMutation.mutateAsync(req)
      }
      setDialogOpen(false)
    } catch (err) {
      setFormErr(
        err instanceof ValidationError ? err.flatten()
          : err instanceof Error ? err.message
          : 'Failed to save expense.',
      )
    }
  }

  const isSaving = createMutation.isPending || updateMutation.isPending

  return (
    <div>
      <PageHeader
        title="Godown Expenses"
        subtitle={`Track ${inventoryName}'s operating expenses — electricity, rent, staff, and more.`}
        action={
          <Button
            variant="contained"
            color="primary"
            startIcon={<Plus className="w-4 h-4" />}
            onClick={openAdd}
            sx={{ textTransform: 'none', fontWeight: 600 }}
          >
            Add Expense
          </Button>
        }
      />

      <Box sx={{ mb: 2 }}>
        <TextField
          select
          size="small"
          label="Month"
          value={selectedMonth}
          onChange={e => setSelectedMonth(e.target.value)}
          sx={{ minWidth: 200 }}
        >
          {months.map(m => (
            <MenuItem key={m.value} value={m.value}>{m.label}</MenuItem>
          ))}
        </TextField>
      </Box>

      {expensesQuery.isError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          Failed to load godown expenses. {expensesQuery.error instanceof Error ? expensesQuery.error.message : ''}
        </Alert>
      )}

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(4, minmax(200px, 1fr))' },
          gap: 2,
          mb: 3,
        }}
      >
        <KpiCard label="Total Godown Expenses" value={formatINR(total)} />
        <KpiCard label="Entries Logged" value={String(entries.length)} sub={inventoryName} />
        <KpiCard
          label="Largest Category"
          value={largestCategory?.category ?? '—'}
          sub={largestCategory ? `${formatINR(largestCategory.amount)} (${Math.round((largestCategory.amount / (total || 1)) * 100)}%)` : undefined}
        />
        <KpiCard label="Net Impact" value={`− ${formatINR(total)}`} highlight />
      </Box>

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1.5fr 1fr' }, gap: 2, alignItems: 'flex-start' }}>
        <Paper elevation={0} sx={{ borderRadius: 2, border: '2px solid #1F1F1F', bgcolor: '#FFFFFF', overflow: 'hidden' }}>
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow sx={{ bgcolor: '#FCD835' }}>
                  <TableCell sx={HEAD_SX}>Category</TableCell>
                  <TableCell sx={HEAD_SX}>Note</TableCell>
                  <TableCell sx={{ ...HEAD_SX, width: 110 }}>Date</TableCell>
                  <TableCell sx={{ ...HEAD_SX, width: 120 }} align="right">Amount</TableCell>
                  <TableCell sx={{ width: 90 }} />
                </TableRow>
              </TableHead>
              <TableBody>
                {expensesQuery.isLoading ? (
                  <TableRow><TableCell colSpan={5} align="center" sx={{ color: '#1F1F1F99', py: 4 }}>Loading…</TableCell></TableRow>
                ) : entries.length === 0 ? (
                  <TableRow><TableCell colSpan={5} align="center" sx={{ color: '#1F1F1F99', py: 4 }}>No entries.</TableCell></TableRow>
                ) : entries.map(e => {
                  return (
                    <TableRow key={e.id} hover sx={{ bgcolor: '#FFFBE6' }}>
                      <TableCell>
                        <Chip
                          size="small"
                          label={e.category}
                          sx={{ bgcolor: '#FFF8DC', fontWeight: 600, fontSize: 11.5 }}
                        />
                      </TableCell>
                      <TableCell
                        title={e.note || undefined}
                        sx={{
                          fontSize: 12.5, color: '#1F1F1F99',
                          maxWidth: 220, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                        }}
                      >
                        {e.note || '—'}
                      </TableCell>
                      <TableCell sx={{ whiteSpace: 'nowrap', fontSize: 12.5, color: '#1F1F1F99', fontWeight: 600 }}>
                        {fmtDate(e.expenseDate)}
                      </TableCell>
                      <TableCell align="right" sx={{ whiteSpace: 'nowrap', fontSize: 12.5, color: '#C62828', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                        − {formatINR(e.amount)}
                      </TableCell>
                      <TableCell align="right">
                        <IconButton size="small" onClick={() => openEdit(e)} aria-label="Edit">
                          <Pencil className="w-3.5 h-3.5" />
                        </IconButton>
                        <IconButton size="small" onClick={() => handleDeleteClick(e)} aria-label="Delete" sx={{ color: '#C62828' }}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </IconButton>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </TableContainer>
        </Paper>

        <Card sx={{ border: '2px solid #1F1F1F', boxShadow: 'none', background: '#FFFBE6' }}>
          <CardContent>
            <Box sx={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.6, fontSize: 12, color: '#1F1F1F99', mb: 1.5 }}>
              By Category
            </Box>
            {byCategory.length === 0 ? (
              <Box sx={{ fontSize: 13, color: '#1F1F1F99' }}>No expenses yet.</Box>
            ) : byCategory.map(({ category, amount }, i) => {
              const meta = categoryMeta(category)
              const pct = total > 0 ? Math.round((amount / total) * 100) : 0
              return (
                <Box
                  key={category}
                  sx={{
                    py: 1.1,
                    borderTop: i === 0 ? 'none' : '1px solid rgba(31,31,31,0.1)',
                  }}
                >
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, fontWeight: 600, mb: 0.5 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                      <Box sx={{ width: 10, height: 10, borderRadius: 0.5, bgcolor: meta.color }} />
                      {category}
                    </Box>
                    <Box sx={{ fontWeight: 700 }}>{formatINR(amount)}</Box>
                  </Box>
                  <Box sx={{ bgcolor: 'rgba(31,31,31,0.08)', borderRadius: 1, height: 6, overflow: 'hidden' }}>
                    <Box sx={{ width: `${pct}%`, height: '100%', bgcolor: meta.color, borderRadius: 1 }} />
                  </Box>
                </Box>
              )
            })}
          </CardContent>
        </Card>
      </Box>

      <Dialog
        open={dialogOpen}
        onClose={(_e, reason) => { if (reason !== 'backdropClick') setDialogOpen(false) }}
        maxWidth="xs"
        fullWidth
        slotProps={{ paper: { sx: { borderRadius: 3, bgcolor: '#FFFBE6' } } }}
      >
        <DialogTitle sx={{ fontWeight: 600 }}>{editingId ? 'Edit' : 'Add'} Godown Expense</DialogTitle>
        <DialogContent dividers sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Autocomplete
            freeSolo
            options={CATEGORIES.map(c => c.key)}
            value={formCategory}
            onChange={(_e, v) => setFormCategory(v ?? '')}
            onInputChange={(_e, v) => setFormCategory(v)}
            renderInput={(params) => (
              <TextField {...params} label="Category" size="small" fullWidth placeholder="Type or pick a category" />
            )}
          />

          <TextField
            label="Amount (₹)"
            type="text"
            value={formatAmountInput(formAmount)}
            onChange={e => setFormAmount(stripAmountFormat(e.target.value))}
            size="small"
            fullWidth
            slotProps={{ htmlInput: { inputMode: 'decimal', autoComplete: 'off' } }}
          />
          <TextField
            label="Note (optional)"
            value={formNote}
            onChange={e => setFormNote(e.target.value)}
            size="small"
            fullWidth
            placeholder="e.g. Loading charges — July"
          />
          <LocalizationProvider dateAdapter={AdapterDayjs}>
            <DatePicker
              label="Date"
              format="DD/MM/YYYY"
              value={formDate ? dayjs(formDate) : null}
              onChange={(v) => { if (v && v.isValid()) setFormDate(v.format('YYYY-MM-DD')) }}
              slotProps={{ textField: { size: 'small', fullWidth: true } }}
            />
          </LocalizationProvider>
          {formErr && <Alert severity="error">{formErr}</Alert>}
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button onClick={() => setDialogOpen(false)} variant="outlined" disabled={isSaving} sx={{ textTransform: 'none', fontWeight: 600 }}>
            Cancel
          </Button>
          <Button onClick={handleSave} variant="contained" color="primary" disabled={isSaving} sx={{ textTransform: 'none', fontWeight: 700 }}>
            {isSaving ? 'Saving…' : editingId ? 'Save Changes' : 'Save Expense'}
          </Button>
        </DialogActions>
      </Dialog>

      <ConfirmDialog
        open={deleteTarget !== null}
        title="Delete this expense?"
        message={deleteTarget
          ? `"${deleteTarget.category}" — ${formatINR(deleteTarget.amount)} on ${fmtDate(deleteTarget.expenseDate)}. This can't be undone.`
          : ''}
        confirmLabel="Delete"
        cancelLabel="Cancel"
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}

function KpiCard({ label, value, sub, highlight }: { label: string; value: string; sub?: string; highlight?: boolean }) {
  return (
    <Card sx={{ border: '2px solid #1F1F1F', boxShadow: 'none', background: highlight ? GOLD_GRADIENT : '#FFFBE6' }}>
      <CardContent sx={{ p: 2.25, '&:last-child': { pb: 2.25 } }}>
        <Typography variant="caption" sx={{ textTransform: 'uppercase', letterSpacing: 1, fontWeight: 700, fontSize: 11 }}>
          {label}
        </Typography>
        <Typography variant="h5" sx={{ fontWeight: 700, color: '#1F1F1F', lineHeight: 1.1 }}>
          {value}
        </Typography>
        <Typography variant="caption" sx={{ display: 'block', mt: 0.5, opacity: 0.7, fontWeight: 600 }}>
          {sub ?? ' '}
        </Typography>
      </CardContent>
    </Card>
  )
}
