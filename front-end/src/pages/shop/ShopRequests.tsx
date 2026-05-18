import { Fragment, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, ChevronDown, ChevronRight, Plus } from 'lucide-react'
import {
  Alert, Box, Button, Chip, Collapse, IconButton, MenuItem, Paper,
  Table, TableBody, TableCell, TableContainer, TableHead, TablePagination, TableRow, TextField,
} from '@mui/material'
import PageHeader from '../../components/PageHeader'
import { DispatchedCell } from '../../components/DispatchedCell'
import { useMyStockRequests } from '../../hooks/useStockRequests'
import { formatINR } from '../../utils/format'
import type { StockRequestDto, RequestStatus, StockRequestListFilters } from '../../api/stock-requests/types'

const STATUS_OPTIONS: RequestStatus[] = ['Pending', 'Approved', 'Rejected', 'Dispatched', 'Received', 'Cancelled']

const STATUS_COLOR: Record<RequestStatus, 'default' | 'primary' | 'success' | 'error' | 'warning' | 'info'> = {
  Pending:    'warning',
  Approved:   'info',
  Rejected:   'error',
  Dispatched: 'primary',
  Received:   'success',
  Cancelled:  'default',
}

const fmtIst = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : '—'

export default function ShopRequests() {
  const navigate = useNavigate()
  const [filters, setFilters] = useState<{ status?: RequestStatus; search?: string }>({})
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(10)
  // Only one row open at a time so the table stays scannable.
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const list = useMyStockRequests({
    status: filters.status,
    search: filters.search,
    page: page + 1,
    pageSize,
  } satisfies StockRequestListFilters)

  const rows  = list.data?.items ?? []
  const total = list.data?.total ?? 0

  const errorMessage = list.isError
    ? (list.error instanceof Error ? list.error.message : 'Failed to load requests.')
    : null

  return (
    <div>
      <PageHeader
        title="Stock Requests"
        subtitle={list.isLoading ? 'Loading…' : `${total} ${total === 1 ? 'request' : 'requests'}`}
        action={
          <Button
            variant="contained"
            startIcon={<Plus className="w-4 h-4" />}
            onClick={() => navigate('/shop/requests/new')}
            sx={{ textTransform: 'none', fontWeight: 600 }}
          >
            New Request
          </Button>
        }
      />

      {errorMessage && <Alert severity="error" sx={{ mb: 2 }}>{errorMessage}</Alert>}

      <Box sx={{ display: 'flex', gap: 2, mb: 2, flexWrap: 'wrap' }}>
        <TextField
          select
          size="small"
          label="Status"
          value={filters.status ?? ''}
          onChange={e => {
            setFilters(f => ({ ...f, status: (e.target.value || undefined) as RequestStatus | undefined }))
            setPage(0)
          }}
          sx={{ minWidth: 180 }}
        >
          <MenuItem value="">All statuses</MenuItem>
          {STATUS_OPTIONS.map(s => <MenuItem key={s} value={s}>{s}</MenuItem>)}
        </TextField>
        <TextField
          size="small"
          label="Search by code"
          value={filters.search ?? ''}
          onChange={e => {
            setFilters(f => ({ ...f, search: e.target.value || undefined }))
            setPage(0)
          }}
          placeholder="e.g. REQ0001"
          sx={{ minWidth: 200 }}
        />
      </Box>

      <Paper elevation={0} sx={{ borderRadius: 2, border: '2px solid #1F1F1F', bgcolor: '#FFFFFF', overflow: 'hidden' }}>
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow sx={{ bgcolor: '#FCD835' }}>
                <TableCell sx={{ width: 48 }} />
                <TableCell sx={HEAD_SX}>Code</TableCell>
                <TableCell sx={HEAD_SX}>Submitted</TableCell>
                <TableCell sx={{ ...HEAD_SX, width: 160 }} align="right">Total</TableCell>
                <TableCell sx={{ ...HEAD_SX, width: 140 }} align="center">Status</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.length === 0 && !list.isLoading && (
                <TableRow>
                  <TableCell colSpan={5} align="center" sx={{ color: '#1F1F1F99', py: 4 }}>
                    No requests yet.
                  </TableCell>
                </TableRow>
              )}
              {rows.map(row => {
                const isOpen = expandedId === row.id
                return (
                  <Fragment key={row.id}>
                    <TableRow
                      hover
                      onClick={() => setExpandedId(isOpen ? null : row.id)}
                      sx={{
                        cursor: 'pointer',
                        // Only kill the bottom border when expanded, so the
                        // main row visually flows into the expansion panel.
                        // When collapsed, keep the default divider so rows
                        // don't look like one huge unbroken block.
                        ...(isOpen && {
                          bgcolor: '#FFFBE6',
                          '& > *': { borderBottom: 'unset' },
                        }),
                      }}
                    >
                      <TableCell sx={{ width: 48 }}>
                        <IconButton size="small" aria-label={isOpen ? 'Collapse' : 'Expand'}>
                          {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                        </IconButton>
                      </TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>{row.code}</TableCell>
                      <TableCell>{fmtIst(row.submittedAt)}</TableCell>
                      <TableCell align="right">
                        <TotalCell row={row} />
                      </TableCell>
                      <TableCell align="center">
                        <Chip
                          label={row.status}
                          size="small"
                          color={STATUS_COLOR[row.status]}
                          variant={row.status === 'Received' ? 'filled' : 'outlined'}
                        />
                      </TableCell>
                    </TableRow>

                    <TableRow>
                      <TableCell colSpan={5} sx={{ p: 0, border: 0 }}>
                        <Collapse in={isOpen} timeout="auto" unmountOnExit>
                          <ExpansionPanel
                            row={row}
                            onViewDetail={() => navigate(`/shop/requests/${row.id}`)}
                          />
                        </Collapse>
                      </TableCell>
                    </TableRow>
                  </Fragment>
                )
              })}
            </TableBody>
          </Table>
        </TableContainer>

        <TablePagination
          component="div"
          count={total}
          page={page}
          onPageChange={(_, p) => setPage(p)}
          rowsPerPage={pageSize}
          onRowsPerPageChange={e => {
            setPageSize(parseInt(e.target.value, 10))
            setPage(0)
          }}
          rowsPerPageOptions={[10, 25, 50, 100]}
        />
      </Paper>
    </div>
  )
}

// ───────────────────────────────────────────────────────────────

const HEAD_SX = {
  fontWeight: 700,
  textTransform: 'uppercase' as const,
  letterSpacing: 0.5,
  fontSize: 11,
}

function TotalCell({ row }: { row: StockRequestDto }) {
  const hasDispatch = row.totalDispatchedAmount != null
  const short = hasDispatch && row.totalDispatchedAmount! < row.totalAmount
  if (!hasDispatch) return <span>{formatINR(Number(row.totalAmount))}</span>
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', lineHeight: 1.2 }}>
      <Box sx={{ fontSize: 12, color: '#1F1F1F99', whiteSpace: 'nowrap' }}>
        {formatINR(Number(row.totalAmount))}
      </Box>
      <Box sx={{ fontSize: 13, fontWeight: 700, color: short ? '#C62828' : '#1F1F1F', whiteSpace: 'nowrap' }}>
        {formatINR(Number(row.totalDispatchedAmount))}
      </Box>
    </Box>
  )
}

function ExpansionPanel({ row, onViewDetail }: { row: StockRequestDto; onViewDetail: () => void }) {
  const hasDispatch = row.totalDispatchedQty != null
  const short = hasDispatch && row.totalDispatchedQty! < row.totalQty
  const isShortAmount = row.totalDispatchedAmount != null
    && row.totalDispatchedAmount < row.totalAmount

  return (
    <Box
      sx={{
        bgcolor: '#FFF8DC',
        borderTop: '1px solid rgba(31,31,31,0.15)',
        px: 3,
        py: 2.5,
      }}
      onClick={e => e.stopPropagation()}
    >
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(2, minmax(0, 1fr))' },
          gap: { xs: 2, md: 4 },
        }}
      >
        {/* Left — counts */}
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
          <SectionLabel>Quantities</SectionLabel>
          <Row label="Submitted items" value={`${row.totalItems}`} />
          <Row label="Submitted qty"   value={`${row.totalQty} ${row.totalQty === 1 ? 'unit' : 'units'}`} />
          <Row
            label="Dispatched qty"
            value={
              row.totalDispatchedQty == null
                ? '—'
                : `${row.totalDispatchedQty} ${row.totalDispatchedQty === 1 ? 'unit' : 'units'}`
            }
            danger={short}
            chip={<DispatchedCell qty={row.totalDispatchedQty} requested={row.totalQty} />}
          />
          <Row label="Dispatched by"   value={row.dispatchedByName ?? '—'} />
          <Row label="Received time"   value={row.receivedAt ? fmtIst(row.receivedAt) : '—'} />
        </Box>

        {/* Right — amounts */}
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
          <SectionLabel>Amounts</SectionLabel>
          <Row label="Requested amount" value={formatINR(row.totalAmount)} />
          {hasDispatch && (
            <Row
              label="Delivered amount"
              value={formatINR(row.totalDispatchedAmount)}
              danger={isShortAmount}
            />
          )}
        </Box>
      </Box>

      <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 2 }}>
        <Button
          variant="contained"
          size="small"
          endIcon={<ArrowRight className="w-4 h-4" />}
          onClick={onViewDetail}
          sx={{ textTransform: 'none', fontWeight: 600 }}
        >
          View full details
        </Button>
      </Box>
    </Box>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <Box sx={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: '#1F1F1F99', mb: 0.5 }}>
      {children}
    </Box>
  )
}

function Row({
  label, value, danger, chip,
}: {
  label: string
  value: string
  danger?: boolean
  chip?: React.ReactNode
}) {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 2, py: 0.4 }}>
      <Box sx={{ fontSize: 12, color: '#1F1F1F99' }}>{label}</Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, fontSize: 13, fontWeight: 600, color: danger ? '#C62828' : '#1F1F1F' }}>
        {chip ?? value}
      </Box>
    </Box>
  )
}
