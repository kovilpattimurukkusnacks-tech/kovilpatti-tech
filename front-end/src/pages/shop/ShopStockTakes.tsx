import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Alert, Box, Button, Chip, CircularProgress, Paper,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography,
} from '@mui/material'
import { ClipboardCheck, Plus } from 'lucide-react'
import PageHeader from '../../components/PageHeader'
import { useStockTakes, useStartStockTake } from '../../hooks/useShopInventory'
import { ApiError } from '../../api/errors'
import { formatIstDateTime } from '../../utils/formatDate'
import type { StockTakeStatus, StockTakeSummaryDto } from '../../api/shop-inventory/types'

// Same status-chip visual family as StockRequests — colour keyed to status,
// muted enough to sit inside a data table row. Draft is amber (in-progress),
// Submitted is green (posted), Cancelled is grey.
const STATUS_STYLE: Record<StockTakeStatus, { bg: string; color: string; border: string }> = {
  Draft:     { bg: '#FFF8E1', color: '#7C4A00', border: 'rgba(194,138,0,0.45)' },
  Submitted: { bg: '#E8F5E9', color: '#1B5E20', border: 'rgba(46,125,50,0.45)' },
  Cancelled: { bg: '#F5F5F5', color: '#616161', border: 'rgba(0,0,0,0.15)' },
}

const PRESETS: { key: 'all' | StockTakeStatus; label: string }[] = [
  { key: 'all',       label: 'All'       },
  { key: 'Draft',     label: 'Draft'     },
  { key: 'Submitted', label: 'Submitted' },
  { key: 'Cancelled', label: 'Cancelled' },
]

const HEAD_SX = {
  fontWeight: 700,
  textTransform: 'uppercase' as const,
  letterSpacing: 0.5,
  fontSize: 11,
}

export default function ShopStockTakes() {
  const navigate = useNavigate()
  const [activePreset, setActivePreset] = useState<'all' | StockTakeStatus>('all')

  const listQuery = useStockTakes({
    status: activePreset === 'all' ? undefined : activePreset,
    page: 1,
    pageSize: 50,
  })
  const rows = useMemo(() => listQuery.data?.items ?? [], [listQuery.data])

  const startMutation = useStartStockTake()
  const [startErr, setStartErr] = useState<string | null>(null)

  const handleStart = async () => {
    setStartErr(null)
    try {
      const created = await startMutation.mutateAsync(undefined)
      navigate(`/shop/stock-takes/${created.id}`)
    } catch (err) {
      // BE raises 409 when a Draft is already open — steer the user to
      // the existing session instead of surfacing the raw error string.
      if (err instanceof ApiError && err.status === 409) {
        setStartErr('A draft stock-take is already open. Open it from the list below to continue.')
        return
      }
      setStartErr(err instanceof Error ? err.message : 'Failed to start stock-take.')
    }
  }

  return (
    <Box className="p-4 sm:p-6">
      <PageHeader
        title="Stock Count"
        subtitle="Physical shelf audit — count what's on the shelf vs what the system thinks. Submitting posts inventory adjustments."
        action={
          <Button
            variant="contained"
            startIcon={startMutation.isPending ? <CircularProgress size={14} thickness={5} sx={{ color: 'inherit' }} /> : <Plus size={18} />}
            onClick={handleStart}
            disabled={startMutation.isPending}
            sx={{ textTransform: 'none', fontWeight: 700 }}
          >
            {startMutation.isPending ? 'Starting…' : 'Start new count'}
          </Button>
        }
      />

      {startErr && (
        <Alert severity="warning" sx={{ mb: 2, borderRadius: 2 }} onClose={() => setStartErr(null)}>
          {startErr}
        </Alert>
      )}

      {/* Status preset chips — same visual family as ShopRequests presets. */}
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 2 }}>
        {PRESETS.map(p => {
          const isActive = activePreset === p.key
          return (
            <Chip
              key={p.key}
              label={p.label}
              onClick={() => setActivePreset(p.key)}
              sx={{
                fontWeight: 700, borderRadius: 999, px: 0.5,
                ...(isActive
                  ? { bgcolor: '#FCD835', color: '#1F1F1F', border: '1.5px solid #1F1F1F' }
                  : { bgcolor: 'transparent', color: '#1F1F1F', border: '1.5px solid rgba(31,31,31,0.25)' }),
                '&:hover': { bgcolor: isActive ? '#FCD835' : 'rgba(252,216,53,0.25)' },
              }}
            />
          )
        })}
      </Box>

      <Paper elevation={0} sx={{
        border: '2px solid #1F1F1F', boxShadow: '4px 4px 0 0 #FCD835',
        background: '#FFFBE6', borderRadius: 2,
      }}>
        {listQuery.isLoading ? (
          <Box sx={{ p: 6, display: 'flex', justifyContent: 'center' }}>
            <CircularProgress size={24} />
          </Box>
        ) : listQuery.error ? (
          <Alert severity="error" sx={{ m: 2 }}>
            {listQuery.error instanceof Error ? listQuery.error.message : 'Failed to load stock-takes.'}
          </Alert>
        ) : rows.length === 0 ? (
          <EmptyState onStart={handleStart} disabled={startMutation.isPending} />
        ) : (
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={HEAD_SX}>Code</TableCell>
                  <TableCell sx={HEAD_SX}>Status</TableCell>
                  <TableCell sx={HEAD_SX}>Started</TableCell>
                  <TableCell sx={HEAD_SX}>Submitted</TableCell>
                  <TableCell sx={HEAD_SX} align="right">Lines</TableCell>
                  <TableCell sx={HEAD_SX} align="right">Diffs</TableCell>
                  <TableCell sx={HEAD_SX} align="right">Net qty</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map(r => <StockTakeRow key={r.id} row={r} onOpen={() => navigate(`/shop/stock-takes/${r.id}`)} />)}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Paper>
    </Box>
  )
}

// ══════════════════ Row + empty state ══════════════════

function StockTakeRow({ row, onOpen }: { row: StockTakeSummaryDto; onOpen: () => void }) {
  const style = STATUS_STYLE[row.status]
  const netColor = row.netDiffQty === 0 ? '#1F1F1F99' : row.netDiffQty > 0 ? '#2E7D32' : '#C62828'
  const netPrefix = row.netDiffQty > 0 ? '+' : ''

  return (
    <TableRow
      hover
      onClick={onOpen}
      sx={{ cursor: 'pointer', '&:last-child td': { borderBottom: 0 } }}
    >
      <TableCell sx={{ fontWeight: 700, fontFamily: 'monospace' }}>{row.code}</TableCell>
      <TableCell>
        <Chip
          size="small"
          label={row.status}
          sx={{
            borderRadius: 999, fontWeight: 700, fontSize: 11,
            bgcolor: style.bg, color: style.color,
            border: `1px solid ${style.border}`,
          }}
        />
      </TableCell>
      <TableCell>{formatIstDateTime(row.startedAt)}</TableCell>
      <TableCell>{row.submittedAt ? formatIstDateTime(row.submittedAt) : <span style={{ color: '#1F1F1F55' }}>—</span>}</TableCell>
      <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{row.itemCount}</TableCell>
      <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{row.diffCount}</TableCell>
      <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700, color: netColor }}>
        {netPrefix}{row.netDiffQty}
      </TableCell>
    </TableRow>
  )
}

function EmptyState({ onStart, disabled }: { onStart: () => void; disabled: boolean }) {
  return (
    <Box sx={{ p: 6, textAlign: 'center' }}>
      <Box sx={{
        width: 56, height: 56, borderRadius: '50%',
        bgcolor: 'rgba(252,216,53,0.18)', border: '2px solid rgba(31,31,31,0.15)',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        mb: 2, color: '#7C4A00',
      }}>
        <ClipboardCheck size={26} />
      </Box>
      <Typography sx={{ fontWeight: 700, fontSize: 15, color: '#1F1F1F' }}>
        No stock-takes yet
      </Typography>
      <Typography sx={{ fontSize: 13, color: '#1F1F1F99', mt: 0.5, maxWidth: 380, mx: 'auto' }}>
        Run a physical count to reconcile shelf stock with the system. The first count sets a baseline.
      </Typography>
      <Button
        variant="contained"
        onClick={onStart}
        disabled={disabled}
        startIcon={<Plus size={18} />}
        sx={{ mt: 2.5, textTransform: 'none', fontWeight: 700 }}
      >
        Start new count
      </Button>
    </Box>
  )
}
