import { useMemo, useState } from 'react'
import {
  Alert, Box, Button, Card, CardContent, Chip, MenuItem, Paper, TextField, Tooltip, Typography,
} from '@mui/material'
import { DataGrid, type GridColDef } from '@mui/x-data-grid'
import type { LucideIcon } from 'lucide-react'
import { CircleCheck, Clock, Gift, IndianRupee, MinusCircle, Wallet } from 'lucide-react'
import SetSalaryDialog from './SetSalaryDialog'
import PaySalaryDialog from './PaySalaryDialog'
import DeductSalaryDialog from './DeductSalaryDialog'
import BonusDialog from './BonusDialog'
import { brandTooltipSlotProps } from '../accounts/BreakdownTooltip'
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

const DISABLED_HINT = 'Set a monthly salary for this staff first'

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

  // Same DataGrid + data-page-grid/data-page-paper convention every other
  // list page in the app uses (Staff Details tab, Products, Shops, …) —
  // client req: this table read as inconsistent/unclear next to the plain
  // MUI Table it had before; DataGrid gives it the same column alignment,
  // single-line header, and compact icon-button actions as everywhere else.
  const columns = useMemo<GridColDef<StaffSalaryRowDto>[]>(() => [
    {
      field: 'fullName', headerName: 'Staff', flex: 1, minWidth: 100, sortable: false, filterable: false,
      renderCell: ({ row }) => (
        <Box>
          <Box sx={{ fontWeight: 700 }}>{row.fullName}</Box>
          <Box sx={{ fontSize: 11, opacity: 0.65 }}>{row.role}</Box>
        </Box>
      ),
    },
    {
      field: 'mappedTo', headerName: 'Mapped To', flex: 1, minWidth: 105, sortable: false, filterable: false,
      valueGetter: (_v, row) => row.shopName ?? row.inventoryName ?? '—',
      renderCell: ({ row }) => (
        <Box>
          <Box>{row.shopName ?? row.inventoryName ?? '—'}</Box>
          {!row.inAccounts && (
            <Box sx={{ fontSize: 10.5, color: '#8A6D3B', fontWeight: 700, lineHeight: 1.2 }}>→ Godown Expenses</Box>
          )}
        </Box>
      ),
    },
    {
      // Shortened from "Monthly Salary" — the full label was truncating
      // to "MONTHLY S…" at a column width that actually fits the amount.
      field: 'monthlyAmount', headerName: 'Salary', width: 120, align: 'center', headerAlign: 'center',
      sortable: false, filterable: false,
      valueFormatter: (value) => formatINR(value as number),
    },
    {
      field: 'paid', headerName: 'Paid', width: 110, align: 'center', headerAlign: 'center', sortable: false, filterable: false,
      renderCell: ({ row }) => (
        <span style={{ color: row.paid > 0 ? '#2E7D32' : undefined }}>{formatINR(row.paid)}</span>
      ),
    },
    {
      field: 'deducted', headerName: 'Deducted', width: 120, align: 'center', headerAlign: 'center', sortable: false, filterable: false,
      renderCell: ({ row }) => (
        <span style={{ color: row.deducted < 0 ? '#C62828' : undefined }}>
          {row.deducted < 0 ? `− ${formatINR(Math.abs(row.deducted))}` : formatINR(row.deducted)}
        </span>
      ),
    },
    {
      field: 'net', headerName: 'Net', width: 110, align: 'center', headerAlign: 'center', sortable: false, filterable: false,
      renderCell: ({ row }) => <NetCell row={row} from={from} to={to} />,
    },
    {
      field: 'status', headerName: 'Status', width: 110, align: 'center', headerAlign: 'center', sortable: false, filterable: false,
      renderHeader: () => (
        <Tooltip
          arrow
          slotProps={brandTooltipSlotProps}
          title={
            <BrandTooltipCard title="Status Meaning">
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
                {(Object.keys(STATUS_MEANING) as Status[]).map(s => (
                  <Box key={s}>
                    <Typography component="span" sx={{ fontSize: 12.5, fontWeight: 800 }}>{s}</Typography>
                    <Typography component="span" sx={{ fontSize: 12.5, color: '#1F1F1FB3' }}> — {STATUS_MEANING[s]}</Typography>
                  </Box>
                ))}
              </Box>
            </BrandTooltipCard>
          }
        >
          <Box component="span">Status</Box>
        </Tooltip>
      ),
      renderCell: ({ row }) => {
        const status = rowStatus(row)
        return <Chip label={status} size="small" color={STATUS_COLOR[status]} variant={status === 'Not set' ? 'outlined' : 'filled'} />
      },
    },
    {
      // Widened + labeled buttons (was icon-only) — client req: name the
      // actions and give them breathing room instead of 3 cramped icons.
      field: 'actions', headerName: 'Actions', width: 300, align: 'right', headerAlign: 'right',
      sortable: false, filterable: false,
      renderCell: ({ row }) => {
        const disabled = rowStatus(row) === 'Not set'
        const disabledTooltip = disabled ? <BrandTooltipText>{DISABLED_HINT}</BrandTooltipText> : ''
        return (
          <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end' }}>
            <Tooltip slotProps={brandTooltipSlotProps} title={disabledTooltip}>
              <span>
                <Button
                  size="small" variant="outlined" color="success" disabled={disabled}
                  startIcon={<IndianRupee className="w-3.5 h-3.5" />}
                  onClick={() => setPayTarget(row)} sx={{ textTransform: 'none', fontWeight: 600, px: 1.25 }}
                >
                  Pay
                </Button>
              </span>
            </Tooltip>
            <Tooltip slotProps={brandTooltipSlotProps} title={disabledTooltip}>
              <span>
                <Button
                  size="small" variant="outlined" color="error" disabled={disabled}
                  startIcon={<MinusCircle className="w-3.5 h-3.5" />}
                  onClick={() => setDeductTarget(row)} sx={{ textTransform: 'none', fontWeight: 600, px: 1.25 }}
                >
                  Deduct
                </Button>
              </span>
            </Tooltip>
            <BonusButton row={row} disabled={disabled} onClick={() => setBonusTarget(row)} />
          </Box>
        )
      },
    },
  ], [from, to])

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

      <Paper className="data-page-paper" sx={{ borderRadius: 2.5, backgroundColor: '#FFFBE6 !important' }} elevation={0}>
        <DataGrid
          className="data-page-grid"
          rows={rows}
          columns={columns}
          getRowId={r => r.staffId}
          loading={salaryQuery.isLoading}
          autoHeight
          disableRowSelectionOnClick
          disableColumnMenu
          localeText={{ noRowsLabel: 'No staff configured yet.' }}
          // Scoped to just this table (sx, not the shared .data-page-grid
          // class other list pages rely on) — the shared class only creams
          // the header row and data rows, leaving the grid's own root/filler
          // background white wherever a row doesn't reach. Cover every
          // internal container slot that can show through.
          sx={{
            backgroundColor: '#FFFBE6 !important',
            '& .MuiDataGrid-main': { backgroundColor: '#FFFBE6 !important' },
            '& .MuiDataGrid-virtualScroller': { backgroundColor: '#FFFBE6 !important' },
            '& .MuiDataGrid-virtualScrollerContent': { backgroundColor: '#FFFBE6 !important' },
            '& .MuiDataGrid-filler': { backgroundColor: '#FFFBE6 !important' },
            '& .MuiDataGrid-scrollbarFiller': { backgroundColor: '#FFFBE6 !important' },
            '& .MuiDataGrid-footerContainer': { backgroundColor: '#FFF8DC !important' },
          }}
        />
      </Paper>

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

// ══════════════════ Brand-styled tooltip cards ══════════════════
// Same "Kovilpatti card grammar" as the Accounts Gross P&L / Net P&L
// hover cards (BreakdownTooltip.tsx) — cream ground, 2px black border,
// offset gold drop-shadow — so these tooltips read as the same app
// instead of MUI's default small dark tooltip. Combine with
// `slotProps={brandTooltipSlotProps}` on the <Tooltip> itself.

function BrandTooltipCard({ title, subtitle, children }: {
  title: string
  subtitle?: string
  children: React.ReactNode
}) {
  return (
    <Box sx={{
      minWidth: 250,
      bgcolor: '#FFFBE6',
      color: '#1F1F1F',
      border: '2px solid #1F1F1F',
      boxShadow: '4px 4px 0 0 #FCD835',
      borderRadius: 1,
      overflow: 'hidden',
      fontVariantNumeric: 'tabular-nums',
    }}>
      <Box sx={{ px: 1.75, pt: 1.25, pb: subtitle ? 1 : 0.75, borderBottom: '2px solid #FCD835' }}>
        <Typography sx={{ fontSize: 11, fontWeight: 800, letterSpacing: 1.2, textTransform: 'uppercase' }}>
          {title}
        </Typography>
        {subtitle && (
          <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: '#1F1F1FB3', mt: 0.25 }}>
            {subtitle}
          </Typography>
        )}
      </Box>
      <Box sx={{ px: 1.75, py: 1.25 }}>{children}</Box>
    </Box>
  )
}

// One-line variant for short hints (e.g. "why is this button disabled").
function BrandTooltipText({ children }: { children: React.ReactNode }) {
  return (
    <Box sx={{
      bgcolor: '#FFFBE6', color: '#1F1F1F', border: '2px solid #1F1F1F',
      boxShadow: '3px 3px 0 0 #FCD835', borderRadius: 1,
      px: 1.5, py: 0.85, fontSize: 12.5, fontWeight: 600, maxWidth: 220,
    }}>
      {children}
    </Box>
  )
}

// Bonus button — hovering shows when this staff last got a bonus
// (client req: "oru user ku last ah epo bonus kuduthanga nu history
// madhiri katanum"). Lazy: the last-bonus query only fires once the
// tooltip actually opens.
function BonusButton({ row, disabled, onClick }: { row: StaffSalaryRowDto; disabled: boolean; onClick: () => void }) {
  const [open, setOpen] = useState(false)
  const lastBonus = useStaffLastBonus(row.staffId, open)

  const content = disabled
    ? <BrandTooltipText>{DISABLED_HINT}</BrandTooltipText>
    : (
      <BrandTooltipCard title="Last Bonus" subtitle={row.fullName}>
        {lastBonus.isLoading ? (
          <Typography sx={{ fontSize: 12.5 }}>Loading…</Typography>
        ) : !lastBonus.data ? (
          <Typography sx={{ fontSize: 12.5, color: '#1F1F1FB3' }}>No bonus given yet.</Typography>
        ) : (
          <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1.5 }}>
            <Typography sx={{ fontSize: 12.5, color: '#1F1F1FB3' }}>{fmtShortDate(lastBonus.data.txnDate)}</Typography>
            <Typography sx={{ fontSize: 13, fontWeight: 800, color: '#2E7D32' }}>+{formatINR(lastBonus.data.amount)}</Typography>
          </Box>
        )}
      </BrandTooltipCard>
    )

  return (
    <Tooltip arrow open={open} onOpen={() => setOpen(true)} onClose={() => setOpen(false)} title={content} slotProps={brandTooltipSlotProps}>
      <span>
        <Button
          size="small" variant="outlined" disabled={disabled}
          startIcon={<Gift className="w-3.5 h-3.5" />}
          onClick={onClick}
          sx={{
            textTransform: 'none', fontWeight: 600, px: 1.25,
            color: disabled ? undefined : '#C28A00',
            borderColor: disabled ? undefined : '#C28A00',
          }}
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

  const content = (
    <BrandTooltipCard title="History" subtitle={row.fullName}>
      {txns.isLoading ? (
        <Typography sx={{ fontSize: 12.5 }}>Loading…</Typography>
      ) : !txns.data || txns.data.length === 0 ? (
        <Typography sx={{ fontSize: 12.5, color: '#1F1F1FB3' }}>No transactions this month.</Typography>
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.6, minWidth: 220 }}>
          {txns.data.map((t, i) => (
            <Box key={i} sx={{ display: 'flex', justifyContent: 'space-between', gap: 1.5 }}>
              <Typography sx={{ fontSize: 12.5, color: '#1F1F1FB3' }}>
                {fmtShortDate(t.txnDate)}{t.note ? ` — ${t.note}` : ''}
              </Typography>
              <Typography sx={{ fontSize: 12.5, fontWeight: 800, color: t.amount < 0 ? '#C62828' : '#2E7D32', whiteSpace: 'nowrap' }}>
                {t.amount < 0 ? '−' : '+'}{formatINR(Math.abs(t.amount))}
              </Typography>
            </Box>
          ))}
        </Box>
      )}
    </BrandTooltipCard>
  )

  return (
    <Tooltip arrow open={open} onOpen={() => setOpen(true)} onClose={() => setOpen(false)} title={content} slotProps={brandTooltipSlotProps}>
      <span style={{ fontWeight: 700, cursor: 'pointer' }}>{formatINR(row.net)}</span>
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
