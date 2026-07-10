import { useMemo, useState } from 'react'
import {
  Alert, Autocomplete, Box, Button, Card, CardContent, Chip, Dialog, DialogActions,
  DialogContent, DialogTitle, IconButton, Paper, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, TextField, Typography,
} from '@mui/material'
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider'
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs'
import { DatePicker } from '@mui/x-date-pickers/DatePicker'
import dayjs from 'dayjs'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import PageHeader from '../../components/PageHeader'
import { useApp } from '../../context/AppContext'
import { useShop } from '../../hooks/useShops'
import { formatINR } from '../../utils/format'
import { GOLD_GRADIENT } from '../../theme'

// Well-known categories — plain text label + a colour pulled from the
// existing MUI theme palette (theme.ts) rather than inventing new hex
// values. No icons — plain text/colour only, no per-category pictograms.
// This is a set of SUGGESTIONS, not a hard enum — the Add Expense form is a
// free-typing Autocomplete (freeSolo) so a shop can log a category not in
// this list; an unrecognised category just falls back to "Others" below.
const CATEGORIES = [
  { key: 'Electricity',   color: '#FFA000' /* theme.warning */ },
  { key: 'Rent',          color: '#C28A00' /* gold-1, GOLD_GRADIENT stop */ },
  { key: 'Water',         color: '#0277BD' /* theme.info */ },
  { key: 'Staff Salary',  color: '#C62828' /* theme.error */ },
  { key: 'Maintenance',   color: '#FCD835' /* theme.secondary */ },
  { key: 'Internet/Wifi', color: '#2E7D32' /* theme.success */ },
  { key: 'Others',        color: '#3D3D3D' /* theme.text.secondary */ },
] as const
type Category = string

function categoryMeta(cat: string) {
  return CATEGORIES.find(c => c.key === cat) ?? CATEGORIES[CATEGORIES.length - 1]
}

// Same header-cell style as every other list table in the app
// (ShopRequests.tsx, InventoryRequests.tsx, AdminRequests.tsx).
const HEAD_SX = {
  fontWeight: 700,
  textTransform: 'uppercase' as const,
  letterSpacing: 0.5,
  fontSize: 11,
}

// "2026-07-05" → "05 Jul 2026". Built from parts (not `new Date(ymd)`) so an
// IST date string never shifts a day from a browser-local timezone parse.
function fmtDate(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

type Entry = {
  id: string
  date: string        // yyyy-mm-dd
  category: Category
  note: string
  amount: number
}

// Seed rows so the screen isn't empty on first load — this shop's own
// sample expenses only (no cross-shop data, unlike the admin-wide view).
const SEED_ENTRIES: Entry[] = [
  { id: 's1', date: '2026-07-05', category: 'Electricity',   note: 'EB bill — June',          amount: 2450 },
  { id: 's2', date: '2026-07-05', category: 'Rent',          note: 'Monthly shop rent',       amount: 9000 },
  { id: 's3', date: '2026-07-03', category: 'Staff Salary',  note: 'Part-time helper — June', amount: 4000 },
  { id: 's4', date: '2026-07-02', category: 'Maintenance',   note: 'Weighing scale repair',   amount: 850 },
  { id: 's5', date: '2026-07-01', category: 'Internet/Wifi', note: 'Monthly broadband',       amount: 700 },
  { id: 's6', date: '2026-07-01', category: 'Others',        note: 'Cleaning supplies',       amount: 350 },
]

export default function ShopUtilities() {
  const { currentUser } = useApp()
  const shopQuery = useShop(currentUser?.shopId ?? undefined)
  const shopName = shopQuery.data?.name ?? 'your shop'

  const [entries, setEntries] = useState<Entry[]>(SEED_ENTRIES)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)

  // Add/Edit form state — category starts blank (not pre-filled with a
  // default) so the dropdown always opens clean and the shop has to
  // actively pick or type one, rather than silently keeping "Electricity".
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

  function openEdit(entry: Entry) {
    setEditingId(entry.id)
    setFormCategory(entry.category)
    setFormAmount(String(entry.amount))
    setFormNote(entry.note)
    setFormDate(entry.date)
    setFormErr(null)
    setDialogOpen(true)
  }

  function handleDelete(id: string) {
    setEntries(prev => prev.filter(e => e.id !== id))
  }

  function handleSave() {
    if (!formCategory.trim()) {
      setFormErr('Pick or type a category.')
      return
    }
    const amount = parseFloat(formAmount)
    if (!Number.isFinite(amount) || amount <= 0) {
      setFormErr('Enter a valid amount greater than zero.')
      return
    }
    if (editingId) {
      setEntries(prev => prev.map(e => e.id === editingId
        ? { ...e, category: formCategory, note: formNote, amount, date: formDate }
        : e))
    } else {
      setEntries(prev => [
        { id: crypto.randomUUID(), category: formCategory, note: formNote, amount, date: formDate },
        ...prev,
      ])
    }
    setDialogOpen(false)
  }

  return (
    <div>
      <PageHeader
        title="Utilities"
        subtitle={`Track ${shopName}'s operating expenses — electricity, rent, staff, and more.`}
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

      <Alert severity="info" sx={{ mb: 2 }}>
        UI preview only — expense entries live in this page's local state and
        reset on reload. No backend/DB table exists for this yet; see
        <code style={{ margin: '0 4px' }}>DB/planned/pos_billing_screens.md</code>
        for the sign-off status before this gets wired up for real.
      </Alert>

      {/* KPI strip — cream cards with a plain dark border, matching the
          plain-Paper look used everywhere else (ShopRequests.tsx etc.) —
          no drop-shadow outline. */}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(4, minmax(200px, 1fr))' },
          gap: 2,
          mb: 3,
        }}
      >
        <KpiCard label="Total Utilities" value={formatINR(total)} />
        <KpiCard label="Entries Logged" value={String(entries.length)} sub={shopName} />
        <KpiCard
          label="Largest Category"
          value={largestCategory?.category ?? '—'}
          sub={largestCategory ? `${formatINR(largestCategory.amount)} (${Math.round((largestCategory.amount / (total || 1)) * 100)}%)` : undefined}
        />
        <KpiCard label="Net Impact" value={`− ${formatINR(total)}`} highlight />
      </Box>

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1.5fr 1fr' }, gap: 2, alignItems: 'flex-start' }}>
        {/* Entries table — same Paper/row treatment as ShopRequests.tsx and
            InventoryRequests.tsx (every list page reads the same): white
            Paper frame, gold header row, CREAM (#FFFBE6) data rows — not
            left to fall back to the default white Paper background. */}
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
                {entries.length === 0 ? (
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
                      {/* Fixed width + ellipsis truncation — a wrapping note was
                          making that one row taller than every other row, which
                          is what broke the clean grid alignment across columns. */}
                      <TableCell
                        title={e.note || undefined}
                        sx={{
                          fontSize: 12.5, color: '#1F1F1F99',
                          maxWidth: 220, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                        }}
                      >
                        {e.note || '—'}
                      </TableCell>
                      {/* Real columns (not one merged cell) — native table layout keeps
                          every row's date/amount flush regardless of digit count. Date
                          left-aligned (reads as a normal date column, starts flush at
                          the same left edge every row); Amount stays right-aligned
                          (currency convention). */}
                      <TableCell sx={{ whiteSpace: 'nowrap', fontSize: 12.5, color: '#1F1F1F99', fontWeight: 600 }}>
                        {fmtDate(e.date)}
                      </TableCell>
                      <TableCell align="right" sx={{ whiteSpace: 'nowrap', fontSize: 12.5, color: '#C62828', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                        − {formatINR(e.amount)}
                      </TableCell>
                      <TableCell align="right">
                        <IconButton size="small" onClick={() => openEdit(e)} aria-label="Edit">
                          <Pencil className="w-3.5 h-3.5" />
                        </IconButton>
                        <IconButton size="small" onClick={() => handleDelete(e.id)} aria-label="Delete" sx={{ color: '#C62828' }}>
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

        {/* Category breakdown — same plain-border card as the KPI strip
            above, plain divided rows instead of a one-off per-row style. */}
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

      {/* Add / Edit dialog */}
      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="xs" fullWidth slotProps={{ paper: { sx: { borderRadius: 3 } } }}>
        <DialogTitle sx={{ fontWeight: 600 }}>{editingId ? 'Edit' : 'Add'} Utility Expense</DialogTitle>
        <DialogContent dividers sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {/* Free-typing category — pick a suggestion or type a new one.
              No fixed chip list; unrecognised text just falls back to the
              "Others" icon/colour wherever it's displayed (categoryMeta). */}
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
            type="number"
            value={formAmount}
            onChange={e => setFormAmount(e.target.value)}
            size="small"
            fullWidth
            slotProps={{ htmlInput: { min: 0, step: '0.01' } }}
          />
          <TextField
            label="Note (optional)"
            value={formNote}
            onChange={e => setFormNote(e.target.value)}
            size="small"
            fullWidth
            placeholder="e.g. EB bill — July"
          />
          {/* Same MUI X DatePicker used on the Accounts dashboard's date
              filters (DateRangeFilter / AccountsFilterBar) — DD/MM/YYYY on
              every machine, not the OS-locale-dependent native input. */}
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
          <Button onClick={() => setDialogOpen(false)} variant="outlined" sx={{ textTransform: 'none', fontWeight: 600 }}>
            Cancel
          </Button>
          <Button onClick={handleSave} variant="contained" color="primary" sx={{ textTransform: 'none', fontWeight: 700 }}>
            {editingId ? 'Save Changes' : 'Save Expense'}
          </Button>
        </DialogActions>
      </Dialog>
    </div>
  )
}

// Matches components/accounts/KpiStrip.tsx's KpiCard exactly — same
// CardContent padding, same Typography variants/weights/opacity, so this
// page's KPI row is indistinguishable from the Accounts dashboard's.
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
