import { useMemo, useState } from 'react'
import {
  Alert, Box, Button, Card, CardContent, Chip, MenuItem, Paper, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, TextField, Tooltip, Typography,
} from '@mui/material'
import type { LucideIcon } from 'lucide-react'
import { CircleCheck, Clock, Gift, Info, MinusCircle, Wallet } from 'lucide-react'
import SetSalaryDialog from './SetSalaryDialog'
import PaySalaryDialog from './PaySalaryDialog'
import DeductSalaryDialog from './DeductSalaryDialog'
import BonusDialog from './BonusDialog'
import { istFirstOfThisMonth } from '../../utils/istDate'
import { formatINR } from '../../utils/format'
import {
  useStaffSalaries, useSetStaffSalary, usePaySalary, useDeductSalary,
  useStaffSalaryTransactions, useStaffLastBonus,
} from '../../hooks/useStaffSalaries'
import type { StaffSalaryRowDto } from '../../api/staff-salaries/types'
import { ValidationError } from '../../api/errors'

// "2026-07" → { from: '2026-07-01', to: '2026-07-31' }
function monthBounds(yyyyMm: string): { from: string; to: string } {
  const [y, m] = yyyyMm.split('-').map(Number)
  const lastDay = new Date(y, m, 0).getDate()
  return { from: `${yyyyMm}-01`, to: `${yyyyMm}-${String(lastDay).padStart(2, '0')}` }
}

// Dropdown options — current month plus the previous 11, newest first.
function monthOptions(count = 12): { value: string; label: string }[] {
  const [curY, curM] = istFirstOfThisMonth().slice(0, 7).split('-').map(Number)
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(curY, curM - 1 - i, 1)
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    return { value, label: d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }) }
  })
}

type Status = 'Paid' | 'Partial' | 'Pending' | 'Not set'

function rowStatus(row: StaffSalaryRowDto): Status {
  if (row.monthlyAmount <= 0) return 'Not set'
  if (row.net >= row.monthlyAmount) return 'Paid'
  if (row.net <= 0) return 'Pending'
  return 'Partial'
}

const STATUS_COLOR: Record<Status, 'success' | 'warning' | 'error' | 'default'> = {
  Paid: 'success', Partial: 'warning', Pending: 'error', 'Not set': 'default',
}

// Vertical divider between header columns — matches the column separator
// every DataGrid-based list page (Staff Details tab, Products, Shops, …)
// already shows by default; this table uses plain MUI Table so it needs
// the same line added explicitly. Not applied to the last column.
const HEAD_SEP_SX = { borderRight: '1px solid rgba(31, 31, 31, 0.18)' }

const STATUS_MEANING: Record<Status, string> = {
  'Not set': 'No monthly salary configured yet for this staff.',
  Pending:   'Monthly salary is set, but nothing has been paid this month yet.',
  Partial:   'Some has been paid this month, but less than the monthly salary.',
  Paid:      'Net paid this month has reached the monthly salary.',
}

// "2026-07-05" → "05 Jul"
function fmtShortDate(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
}

export default function SalaryTab() {
  const [selectedMonth, setSelectedMonth] = useState(() => istFirstOfThisMonth().slice(0, 7))
  const { from, to } = useMemo(() => monthBounds(selectedMonth), [selectedMonth])
  const months = useMemo(() => monthOptions(), [])

  const salaryQuery = useStaffSalaries(from, to)
  const rows = useMemo(() => salaryQuery.data ?? [], [salaryQuery.data])

  const setSalary = useSetStaffSalary()
  const pay = usePaySalary()
  const deduct = useDeductSalary()

  const [setDialogOpen, setSetDialogOpen] = useState(false)
  const [payTarget, setPayTarget] = useState<StaffSalaryRowDto | null>(null)
  const [deductTarget, setDeductTarget] = useState<StaffSalaryRowDto | null>(null)
  const [bonusTarget, setBonusTarget] = useState<StaffSalaryRowDto | null>(null)

  const totals = useMemo(() => {
    const totalPayroll = rows.reduce((sum, r) => sum + r.monthlyAmount, 0)
    const paid         = rows.reduce((sum, r) => sum + r.paid, 0)
    const deducted     = rows.reduce((sum, r) => sum + r.deducted, 0)
    const pending       = rows.reduce((sum, r) => sum + Math.max(r.monthlyAmount - r.net, 0), 0)
    return { totalPayroll, paid, deducted, pending }
  }, [rows])

  const errorMessage = salaryQuery.isError
    ? (salaryQuery.error instanceof Error ? salaryQuery.error.message : 'Failed to load staff salary data.')
    : null

  const handleSetSalary = async (values: { staffId: string; monthlyAmount: number; effectiveFrom: string }) => {
    await setSalary.mutateAsync(values)
    setSetDialogOpen(false)
  }

  const handlePay = async (values: { amount: number; mode: string; txnDate: string; note: string }) => {
    if (!payTarget) return
    await pay.mutateAsync({ staffId: payTarget.staffId, ...values })
    setPayTarget(null)
  }

  const handleDeduct = async (values: { amount: number; reason: string; txnDate: string; note: string }) => {
    if (!deductTarget) return
    await deduct.mutateAsync({ staffId: deductTarget.staffId, ...values })
    setDeductTarget(null)
  }

  // A Bonus is just a Pay entry with mode fixed to "Bonus" — reuses the
  // exact same endpoint/ledger/tally as a regular payment, see BonusDialog.
  const handleBonus = async (values: { amount: number; txnDate: string; note: string }) => {
    if (!bonusTarget) return
    await pay.mutateAsync({ staffId: bonusTarget.staffId, mode: 'Bonus', ...values })
    setBonusTarget(null)
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1.5, mb: 2, flexWrap: 'wrap' }}>
        <TextField
          select size="small" value={selectedMonth} onChange={e => setSelectedMonth(e.target.value)}
          sx={{ minWidth: 180 }}
        >
          {months.map(m => <MenuItem key={m.value} value={m.value}>{m.label}</MenuItem>)}
        </TextField>
        <Button
          variant="contained" startIcon={<Wallet className="w-4 h-4" />}
          onClick={() => setSetDialogOpen(true)}
          sx={{ textTransform: 'none', fontWeight: 600 }}
        >
          Set Monthly Salary
        </Button>
      </Box>

      {errorMessage && <Alert severity="error" sx={{ mb: 2 }}>{errorMessage}</Alert>}

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(4, 1fr)' }, gap: 2, mb: 2 }}>
        <SalaryKpiCard label="Total Monthly Payroll" value={totals.totalPayroll} icon={Wallet} secondary={`${rows.length} staff configured`} />
        <SalaryKpiCard label="Paid This Month" value={totals.paid} icon={CircleCheck} accent="success" />
        <SalaryKpiCard label="Deductions This Month" value={Math.abs(totals.deducted)} icon={MinusCircle} accent="danger" />
        <SalaryKpiCard label="Pending This Month" value={totals.pending} icon={Clock} accent={totals.pending > 0 ? 'danger' : undefined} />
      </Box>

      {/* Cream background scoped to just this table (sx, not the shared
          .data-page-paper class) — every other data table in the app
          (Staff Details tab, Products, Shops, …) stays on the standard
          white card look; only this Salary tab is going cream. */}
      <TableContainer component={Paper} className="data-page-paper" sx={{ borderRadius: 2.5, backgroundColor: '#FFFBE6 !important' }} elevation={0}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell sx={HEAD_SEP_SX}>Staff</TableCell>
              <TableCell sx={HEAD_SEP_SX}>Mapped To</TableCell>
              <TableCell align="right" sx={HEAD_SEP_SX}>Monthly Salary</TableCell>
              <TableCell align="right" sx={HEAD_SEP_SX}>Paid</TableCell>
              <TableCell align="right" sx={HEAD_SEP_SX}>Deducted</TableCell>
              <TableCell align="right" sx={HEAD_SEP_SX}>Net</TableCell>
              <TableCell sx={HEAD_SEP_SX}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  Status
                  <Tooltip
                    arrow
                    title={
                      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, fontSize: 12 }}>
                        {(Object.keys(STATUS_MEANING) as Status[]).map(s => (
                          <span key={s}><b>{s}</b> — {STATUS_MEANING[s]}</span>
                        ))}
                      </Box>
                    }
                  >
                    <Box component="span" sx={{ display: 'inline-flex', color: '#1F1F1F80', cursor: 'help' }}>
                      <Info size={13} />
                    </Box>
                  </Tooltip>
                </Box>
              </TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map(row => {
              const status = rowStatus(row)
              return (
                <TableRow key={row.staffId} hover>
                  <TableCell>
                    <Box sx={{ fontWeight: 700 }}>{row.fullName}</Box>
                    <Box sx={{ fontSize: 11, opacity: 0.65 }}>{row.role}</Box>
                  </TableCell>
                  <TableCell>
                    {row.shopName ?? row.inventoryName ?? '—'}
                    {!row.inAccounts && (
                      <Box sx={{ fontSize: 10.5, color: '#8A6D3B', fontWeight: 700 }}>→ Godown Expenses in Accounts</Box>
                    )}
                  </TableCell>
                  <TableCell align="right">{formatINR(row.monthlyAmount)}</TableCell>
                  <TableCell align="right" sx={{ color: row.paid > 0 ? '#2E7D32' : undefined }}>{formatINR(row.paid)}</TableCell>
                  <TableCell align="right" sx={{ color: row.deducted < 0 ? '#C62828' : undefined }}>
                    {row.deducted < 0 ? `− ${formatINR(Math.abs(row.deducted))}` : formatINR(row.deducted)}
                  </TableCell>
                  <NetCell row={row} from={from} to={to} />
                  <TableCell>
                    <Chip label={status} size="small" color={STATUS_COLOR[status]} variant={status === 'Not set' ? 'outlined' : 'filled'} />
                  </TableCell>
                  <TableCell align="right">
                    <Box sx={{ display: 'flex', gap: 0.75, justifyContent: 'flex-end' }}>
                      <Tooltip title={status === 'Not set' ? 'Set a monthly salary for this staff first' : ''}>
                        <span>
                          <Button
                            size="small" variant="outlined" color="success" disabled={status === 'Not set'}
                            onClick={() => setPayTarget(row)} sx={{ textTransform: 'none', minWidth: 0, px: 1.25 }}
                          >
                            Pay
                          </Button>
                        </span>
                      </Tooltip>
                      <Tooltip title={status === 'Not set' ? 'Set a monthly salary for this staff first' : ''}>
                        <span>
                          <Button
                            size="small" variant="outlined" color="error" disabled={status === 'Not set'}
                            onClick={() => setDeductTarget(row)} sx={{ textTransform: 'none', minWidth: 0, px: 1.25 }}
                          >
                            Deduct
                          </Button>
                        </span>
                      </Tooltip>
                      <BonusButton row={row} disabled={status === 'Not set'} onClick={() => setBonusTarget(row)} />
                    </Box>
                  </TableCell>
                </TableRow>
              )
            })}
            {rows.length === 0 && !salaryQuery.isLoading && (
              <TableRow>
                <TableCell colSpan={8} align="center" sx={{ py: 4, opacity: 0.6 }}>No staff configured yet.</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <SetSalaryDialog
        open={setDialogOpen}
        staff={rows}
        submitting={setSalary.isPending}
        submitError={mutationErrorMessage(setSalary.error)}
        onClose={() => setSetDialogOpen(false)}
        onSave={handleSetSalary}
      />

      <PaySalaryDialog
        open={!!payTarget}
        staff={payTarget}
        submitting={pay.isPending}
        submitError={mutationErrorMessage(pay.error)}
        onClose={() => setPayTarget(null)}
        onSave={handlePay}
      />

      <DeductSalaryDialog
        open={!!deductTarget}
        staff={deductTarget}
        submitting={deduct.isPending}
        submitError={mutationErrorMessage(deduct.error)}
        onClose={() => setDeductTarget(null)}
        onSave={handleDeduct}
      />

      <BonusDialog
        open={!!bonusTarget}
        staff={bonusTarget}
        submitting={pay.isPending}
        submitError={mutationErrorMessage(pay.error)}
        onClose={() => setBonusTarget(null)}
        onSave={handleBonus}
      />
    </Box>
  )
}

// Bonus button — hovering shows when this staff last got a bonus (client
// req: "oru user ku last ah epo bonus kuduthanga nu history madhiri
// katanum"). Lazy: the last-bonus query only fires once the tooltip opens.
function BonusButton({ row, disabled, onClick }: { row: StaffSalaryRowDto; disabled: boolean; onClick: () => void }) {
  const [open, setOpen] = useState(false)
  const lastBonus = useStaffLastBonus(row.staffId, open)

  const content = disabled
    ? 'Set a monthly salary for this staff first'
    : lastBonus.isLoading
      ? 'Loading…'
      : !lastBonus.data
        ? 'No bonus given yet.'
        : `Last bonus: ${fmtShortDate(lastBonus.data.txnDate)} — ${formatINR(lastBonus.data.amount)}`

  return (
    <Tooltip arrow open={open} onOpen={() => setOpen(true)} onClose={() => setOpen(false)} title={content}>
      <span>
        <Button
          size="small" variant="outlined" color="warning" disabled={disabled}
          startIcon={<Gift size={14} />}
          onClick={onClick} sx={{ textTransform: 'none', minWidth: 0, px: 1.25 }}
        >
          Bonus
        </Button>
      </span>
    </Tooltip>
  )
}

// Net cell — hovering shows the dated Pay/Deduct history behind that
// number (client req: "net amount ah hover panna, history varanum").
// Lazy: the transactions query only fires once the tooltip actually opens.
function NetCell({ row, from, to }: { row: StaffSalaryRowDto; from: string; to: string }) {
  const [open, setOpen] = useState(false)
  const txns = useStaffSalaryTransactions(row.staffId, from, to, open)

  const content = txns.isLoading
    ? 'Loading…'
    : !txns.data || txns.data.length === 0
      ? 'No transactions this month.'
      : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, minWidth: 220 }}>
          {txns.data.map((t, i) => (
            <Box key={i} sx={{ display: 'flex', justifyContent: 'space-between', gap: 1.5, fontSize: 12 }}>
              <span>{fmtShortDate(t.txnDate)}{t.note ? ` — ${t.note}` : ''}</span>
              <span style={{ fontWeight: 700, color: t.amount < 0 ? '#FFCDD2' : '#C8E6C9', whiteSpace: 'nowrap' }}>
                {t.amount < 0 ? '−' : '+'}{formatINR(Math.abs(t.amount))}
              </span>
            </Box>
          ))}
        </Box>
      )

  return (
    <Tooltip
      arrow
      open={open}
      onOpen={() => setOpen(true)}
      onClose={() => setOpen(false)}
      title={content}
    >
      <TableCell align="right" sx={{ fontWeight: 700, cursor: 'help' }}>{formatINR(row.net)}</TableCell>
    </Tooltip>
  )
}

function mutationErrorMessage(err: unknown): string | null {
  if (!err) return null
  if (err instanceof ValidationError) return err.flatten()
  if (err instanceof Error)           return err.message
  return 'Something went wrong.'
}

// Same card recipe as Accounts' KpiCard (KpiStrip.tsx) — cream background,
// dark border, gold drop-shadow — so this tab reads as the same screen the
// user compares it against, not a different sub-app.
function SalaryKpiCard({ label, value, secondary, icon: Icon, accent }: {
  label: string
  value: number
  secondary?: string
  icon: LucideIcon
  accent?: 'success' | 'danger'
}) {
  const valueColor = accent === 'success' ? '#2E7D32' : accent === 'danger' ? '#C62828' : '#1F1F1F'
  return (
    <Card sx={{
      height: '100%',
      border: `2px solid ${accent === 'danger' ? '#C62828' : '#1F1F1F'}`,
      boxShadow: '4px 4px 0 0 #FCD835',
      background: accent === 'danger' ? '#FFEBEE' : '#FFFBE6',
      color: '#1F1F1F',
    }}>
      <CardContent sx={{ p: 2.25, '&:last-child': { pb: 2.25 } }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
          <Typography variant="caption" sx={{ textTransform: 'uppercase', letterSpacing: 1, fontWeight: 700, fontSize: 11 }}>
            {label}
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', opacity: 0.7 }}><Icon size={18} /></Box>
        </Box>
        <Typography variant="h5" sx={{ fontWeight: 700, color: valueColor, lineHeight: 1.1 }}>
          {formatINR(value)}
        </Typography>
        <Typography variant="caption" sx={{ display: 'block', mt: 0.5, opacity: 0.7, fontWeight: 600 }}>
          {secondary ?? ' '}
        </Typography>
      </CardContent>
    </Card>
  )
}
