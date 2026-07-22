import { useMemo } from 'react'
import { Box, Card, CardContent, Tooltip, Typography } from '@mui/material'
import { DataGrid, type GridColDef } from '@mui/x-data-grid'
import type {
  AccountsGodownExpenseByInventoryRowDto,
  AccountsInventoryExpenseRowDto,
} from '../../api/accounts/types'
import { formatINR } from '../../utils/format'
import {
  BreakdownCard,
  BreakdownDivider,
  BreakdownRow,
  BreakdownSumTotal,
  brandTooltipSlotProps,
} from './BreakdownTooltip'

type Props = {
  /** Per-(inventory, category) operational expense rows (Rent /
   *  Electricity / Water / …). Absent inventories imply ₹0. */
  inventoryRows: AccountsInventoryExpenseRowDto[] | undefined
  /** Per-inventory staff-salary rollup. Absent inventories imply ₹0. */
  salaryRows:    AccountsGodownExpenseByInventoryRowDto[] | undefined
  loading:       boolean
}

/** One row per godown in the merged view: code + name + amounts. */
type GodownRow = {
  inventoryId:   string
  inventoryCode: string
  inventoryName: string
  operational:   number
  staffSalary:   number
  total:         number
  /** Per-category operational breakdown for the hover tooltip. */
  opsByCategory: { category: string; amount: number; count: number }[]
}

/**
 * Per-godown expenses breakdown — parallel to ShopBreakdownTable's "By
 * shop" panel (21-Jul-2026, client req). Merges two data sources by
 * inventory_id:
 *   • operational expenses (rent / electricity / …), from
 *     fn_accounts_inventory_expenses_breakdown
 *   • staff salary rollup, from fn_accounts_godown_expenses_by_inventory
 *
 * A godown appears in the table if it has ANY spend in the range — either
 * operational or salary. The Operational column hovers a per-category
 * card (same brand tooltip family as the shop-side Utilities hover).
 *
 * No Excel export + no row drill-down — there's no admin destination
 * page for a godown's expenses like AdminRequests is for a shop's
 * requests. If the client asks for either later, the shop-side pattern
 * on ShopBreakdownTable.tsx is the template.
 */
export default function ByGodownTable({ inventoryRows, salaryRows, loading }: Props) {
  const rows: GodownRow[] = useMemo(() => {
    // Build per-inventory buckets keyed by id, carrying code/name from
    // whichever data source saw the godown first.
    const buckets = new Map<string, {
      code: string; name: string
      operational: number
      staffSalary: number
      cats: Map<string, { amount: number; count: number }>
    }>()
    const bucket = (id: string, code: string, name: string) => {
      let b = buckets.get(id)
      if (!b) {
        b = { code, name, operational: 0, staffSalary: 0, cats: new Map() }
        buckets.set(id, b)
      } else {
        // Prefer a non-empty code/name if the first source had blanks.
        if (!b.code && code) b.code = code
        if (!b.name && name) b.name = name
      }
      return b
    }
    for (const r of inventoryRows ?? []) {
      const b = bucket(r.inventoryId, r.inventoryCode, r.inventoryName)
      b.operational += r.amount
      const prev = b.cats.get(r.category) ?? { amount: 0, count: 0 }
      prev.amount += r.amount
      prev.count  += r.expenseCount
      b.cats.set(r.category, prev)
    }
    for (const r of salaryRows ?? []) {
      const b = bucket(r.inventoryId, r.inventoryCode, r.inventoryName)
      b.staffSalary += r.amount
    }
    return Array.from(buckets.entries()).map(([id, b]) => ({
      inventoryId:   id,
      inventoryCode: b.code,
      inventoryName: b.name,
      operational:   b.operational,
      staffSalary:   b.staffSalary,
      total:         b.operational + b.staffSalary,
      opsByCategory: Array.from(b.cats.entries())
        .map(([category, v]) => ({ category, amount: v.amount, count: v.count }))
        .sort((a, b) => b.amount - a.amount),
    }))
  }, [inventoryRows, salaryRows])

  const fmt = (v: unknown) => formatINR(v as number)

  const columns: GridColDef<GodownRow>[] = [
    { field: 'inventoryCode', headerName: 'Code', width: 100 },
    { field: 'inventoryName', headerName: 'Godown', flex: 1, minWidth: 180 },
    {
      field: 'operational',
      headerName: 'Operational',
      type: 'number', width: 150,
      valueFormatter: fmt,
      renderCell: (params) => (
        <OperationalCell row={params.row} value={params.row.operational} />
      ),
    },
    {
      field: 'staffSalary',
      headerName: 'Staff Salary',
      type: 'number', width: 140,
      valueFormatter: fmt,
    },
    {
      field: 'total',
      headerName: 'Total',
      type: 'number', width: 150,
      cellClassName: 'total-cell',
      valueFormatter: fmt,
    },
  ]

  return (
    <Card sx={{ border: '2px solid #1F1F1F', boxShadow: '4px 4px 0 0 #FCD835', background: '#FFFBE6' }}>
      <CardContent>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1.5 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>By godown</Typography>
        </Box>
        <Box sx={{ '& .total-cell': { fontWeight: 700 } }}>
          <DataGrid
            className="data-page-grid"
            rows={rows}
            columns={columns}
            getRowId={(r) => r.inventoryId}
            loading={loading}
            disableRowSelectionOnClick
            disableColumnMenu
            density="compact"
            autoHeight
            initialState={{
              sorting:    { sortModel: [{ field: 'total', sort: 'desc' }] },
              pagination: { paginationModel: { pageSize: 25 } },
            }}
            pageSizeOptions={[10, 25, 50, 100]}
            sx={{
              border: 'none',
              backgroundColor: 'transparent',
              '& .MuiDataGrid-row': { cursor: 'pointer' },
            }}
          />
        </Box>
      </CardContent>
    </Card>
  )
}

// ══════════════════ Per-cell tooltip ══════════════════

/** Operational-expenses cell. Renders the amount with a dashed-underline
 *  hover cue; hovering pops the per-category breakdown for this godown
 *  (Rent / Electricity / Water / …). No tooltip when the amount is 0. */
function OperationalCell({ row, value }: { row: GodownRow; value: number }) {
  if (value <= 0 || row.opsByCategory.length === 0) {
    return <span>{formatINR(value)}</span>
  }
  return (
    <Tooltip
      arrow
      placement="top"
      enterDelay={200}
      leaveDelay={100}
      slotProps={brandTooltipSlotProps}
      title={
        <BreakdownCard title="Operational Expenses" subtitle={row.inventoryName}>
          {row.opsByCategory.map(c => (
            <BreakdownRow
              key={c.category}
              op=""
              label={c.count > 1 ? `${c.category}  ×${c.count}` : c.category}
              value={c.amount}
              tone="input"
            />
          ))}
          <BreakdownDivider />
          <BreakdownSumTotal label="Total Operational" value={value} />
        </BreakdownCard>
      }
    >
      <Box
        component="span"
        sx={{
          display: 'inline-flex', alignItems: 'center',
          cursor: 'pointer',
          borderBottom: '1px dashed transparent',
          transition: 'border-color 120ms ease',
          '&:hover': { borderBottomColor: '#1F1F1F55' },
        }}
      >
        {formatINR(value)}
      </Box>
    </Tooltip>
  )
}
