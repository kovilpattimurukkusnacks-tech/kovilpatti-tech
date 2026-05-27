import { Fragment, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, ChevronDown, ChevronRight, FileEdit, Plus, Search } from 'lucide-react'
import {
  Alert, Box, Button, Chip, Collapse, IconButton, InputAdornment, Paper,
  Table, TableBody, TableCell, TableContainer, TableHead, TablePagination, TableRow, TextField,
} from '@mui/material'
import PageHeader from '../../components/PageHeader'
import { DispatchedCell } from '../../components/DispatchedCell'
import { useMyStockRequests, useShopDraft } from '../../hooks/useStockRequests'
import { formatINR } from '../../utils/format'
import { formatIstDateTime } from '../../utils/formatDate'
import DateRangeFilter, { istToday, dateRangeLabel } from '../../components/DateRangeFilter'
import { FilterBar, FilterRow, FilterPanel, type FilterPill } from '../../components/FilterBar'
import type { StockRequestDto, RequestStatus, StockRequestListFilters } from '../../api/stock-requests/types'

// Quick-filter chip presets — same row of chips the admin / inventory pages
// use, ordered along the request lifecycle. `undefined` status = show all.
type Preset = { key: string; label: string; status: RequestStatus | undefined }
const PRESETS: Preset[] = [
  { key: 'all',        label: 'All',        status: undefined    },
  { key: 'pending',    label: 'Pending',    status: 'Pending'    },
  { key: 'approved',   label: 'Approved',   status: 'Approved'   },
  { key: 'dispatched', label: 'Dispatched', status: 'Dispatched' },
  { key: 'received',   label: 'Received',   status: 'Received'   },
  { key: 'rejected',   label: 'Rejected',   status: 'Rejected'   },
  { key: 'cancelled',  label: 'Cancelled',  status: 'Cancelled'  },
]

const STATUS_COLOR: Record<RequestStatus, 'default' | 'primary' | 'success' | 'error' | 'warning' | 'info'> = {
  // Drafts surface only via the Resume Draft strip — they're filtered out
  // of the /mine list endpoint, so a Draft chip never renders here. Entry
  // kept to satisfy the exhaustive Record type.
  Draft:      'default',
  Pending:    'warning',
  Approved:   'info',
  Rejected:   'error',
  Dispatched: 'primary',
  Received:   'success',
  Cancelled:  'default',
}

export default function ShopRequests() {
  const navigate = useNavigate()
  // Default to All — shop user usually wants the full list of their requests.
  const [activePreset, setActivePreset] = useState<string>('all')
  const [search, setSearch] = useState<string>('')
  // Date range filter on submitted_at — defaults to today (both ends).
  const [fromDate, setFromDate] = useState<string>(istToday())
  const [toDate, setToDate]     = useState<string>(istToday())
  // Filter controls collapsed by default; active filters shown as pills.
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(10)
  // Only one row open at a time so the table stays scannable.
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const currentStatus = PRESETS.find(p => p.key === activePreset)?.status

  const handleDateChange = (from: string, to: string) => {
    setFromDate(from)
    setToDate(to)
    setPage(0)
  }

  const list = useMyStockRequests({
    status: currentStatus,
    search: search.trim() || undefined,
    page: page + 1,
    pageSize,
    fromDate: fromDate || undefined,
    toDate: toDate || undefined,
  } satisfies StockRequestListFilters)

  // Status-specific extra column — surfaces the most relevant per-status
  // info right after the Submitted column. Timestamp for approved /
  // dispatched / received / cancelled; rejection reason text for rejected.
  // NULL on the chips that don't have a meaningful extra signal
  // ("All", "Pending") so the table stays compact.
  const mutedDash = <span className="text-[#1F1F1F]/40">—</span>
  const extraCol: { header: string; render: (r: StockRequestDto) => React.ReactNode } | null =
      activePreset === 'approved'   ? { header: 'Approved',   render: r => r.approvedAt   ? formatIstDateTime(r.approvedAt)   : mutedDash }
    : activePreset === 'dispatched' ? { header: 'Dispatched', render: r => r.dispatchedAt ? formatIstDateTime(r.dispatchedAt) : mutedDash }
    : activePreset === 'received'   ? { header: 'Received',   render: r => r.receivedAt   ? formatIstDateTime(r.receivedAt)   : mutedDash }
    : activePreset === 'rejected'   ? { header: 'Reason',     render: r => r.rejectionReason ?? mutedDash }
    : activePreset === 'cancelled'  ? { header: 'Cancelled',  render: r => r.cancelledAt  ? formatIstDateTime(r.cancelledAt)  : mutedDash }
    : null
  // Total column count — used by the empty-state row and the expansion-row
  // colSpan so the layout stays correct whichever chip is active.
  const totalCols = extraCol ? 6 : 5

  // Shop's single live draft (or null). Resume Draft strip renders only when
  // this resolves to non-null.
  const draftQuery = useShopDraft()

  const rows  = list.data?.items ?? []
  const total = list.data?.total ?? 0

  // Active-filter pills shown when the panel is collapsed. Each ✕ clears that
  // one filter (date → all dates; status → All; search → empty).
  const activePills: FilterPill[] = []
  // Date pill has no ✕ — the date filter is always present (defaults to today)
  // and is changed via the expanded panel, not cleared from the summary.
  if (fromDate || toDate)
    activePills.push({ key: 'date', label: dateRangeLabel(fromDate, toDate) })
  if (activePreset !== 'all')
    activePills.push({
      key: 'status',
      label: PRESETS.find(p => p.key === activePreset)?.label ?? activePreset,
      onRemove: () => { setActivePreset('all'); setPage(0) },
    })
  if (search.trim())
    activePills.push({
      key: 'search',
      label: `“${search.trim()}”`,
      onRemove: () => { setSearch(''); setPage(0) },
    })

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

      {/* Resume Draft strip — visible only when the shop has a saved draft.
          Clicking takes the user to /new where the cart auto-seeds from
          the draft. Single live draft per shop, so there's at most one.
          The "Last saved" timestamp comes from the row's updated_at, which
          refreshes on every save (vs submitted_at which is the original
          create time). */}
      {draftQuery.data && (
        <Paper
          elevation={0}
          sx={{
            mb: 2,
            borderRadius: 2,
            border: '2px solid #1F1F1F',
            bgcolor: '#FFF8DC',
            px: 2,
            py: 1.5,
            display: 'flex',
            alignItems: 'center',
            gap: 2,
            flexWrap: 'wrap',
          }}
        >
          <FileEdit className="w-5 h-5 text-[#1F1F1F]" />
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Box sx={{ fontWeight: 700, fontSize: 14 }}>You have an unsent draft</Box>
            <Box sx={{ fontSize: 12, color: '#1F1F1F99' }}>
              {draftQuery.data.totalItems} {draftQuery.data.totalItems === 1 ? 'product' : 'products'}
              · {draftQuery.data.totalQty} {draftQuery.data.totalQty === 1 ? 'unit' : 'units'}
              · Last saved {formatIstDateTime(draftQuery.data.updatedAt)}
            </Box>
          </Box>
          <Button
            variant="contained"
            size="small"
            onClick={() => navigate('/shop/requests/new')}
            sx={{ textTransform: 'none', fontWeight: 700, whiteSpace: 'nowrap' }}
          >
            Resume Draft
          </Button>
        </Paper>
      )}

      <FilterPanel open={filtersOpen} onToggle={() => setFiltersOpen(o => !o)} pills={activePills}>
      <FilterBar>
        {/* Date row — search box sits at the right of this row. */}
        <FilterRow
          label="Date"
          right={
            <TextField
              size="small"
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(0) }}
              placeholder="Search by code"
              sx={{ minWidth: 220, '& .MuiOutlinedInput-root': { bgcolor: 'transparent' } }}
              slotProps={{
                input: {
                  startAdornment: (
                    <InputAdornment position="start">
                      <Search className="w-4 h-4 text-[#1F1F1F]" />
                    </InputAdornment>
                  ),
                },
              }}
            />
          }
        >
          <DateRangeFilter from={fromDate} to={toDate} onChange={handleDateChange} hideLabel />
        </FilterRow>

        {/* Status chips */}
        <FilterRow label="Status">
          {PRESETS.map(p => {
            const active = activePreset === p.key
            return (
              <Button
                key={p.key}
                onClick={() => { setActivePreset(p.key); setPage(0) }}
                disableElevation
                variant={active ? 'contained' : 'outlined'}
                size="small"
                sx={{
                  textTransform: 'none',
                  fontWeight: 700,
                  borderRadius: 999,
                  px: 2,
                  py: 0.5,
                  minHeight: 32,
                  ...(active
                    ? { bgcolor: '#1F1F1F', color: '#FCD835', '&:hover': { bgcolor: '#0A0A0A' } }
                    : {
                        bgcolor: '#FFFFFF', color: '#1F1F1F',
                        borderColor: 'rgba(31,31,31,0.25)',
                        '&:hover': { borderColor: '#1F1F1F', bgcolor: '#FFF8DC' },
                      }),
                }}
              >
                {p.label}
              </Button>
            )
          })}
        </FilterRow>
      </FilterBar>
      </FilterPanel>

      <Paper elevation={0} sx={{ borderRadius: 2, border: '2px solid #1F1F1F', bgcolor: '#FFFFFF', overflow: 'hidden' }}>
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow sx={{ bgcolor: '#FCD835' }}>
                <TableCell sx={{ width: 48 }} />
                <TableCell sx={HEAD_SX}>Code</TableCell>
                <TableCell sx={HEAD_SX}>Submitted</TableCell>
                {/* Status-specific extra column — only on Approved /
                    Dispatched chips today, more can be added by extending
                    the `extraCol` config above. Sits right after Submitted
                    so the pair reads as a timeline. */}
                {extraCol && <TableCell sx={HEAD_SX}>{extraCol.header}</TableCell>}
                <TableCell sx={{ ...HEAD_SX, width: 160 }} align="right">Total</TableCell>
                <TableCell sx={{ ...HEAD_SX, width: 140 }} align="center">Status</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.length === 0 && !list.isLoading && (
                <TableRow>
                  <TableCell colSpan={totalCols} align="center" sx={{ color: '#1F1F1F99', py: 4 }}>
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
                      <TableCell>{formatIstDateTime(row.submittedAt)}</TableCell>
                      {extraCol && (
                        <TableCell>{extraCol.render(row)}</TableCell>
                      )}
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
                      <TableCell colSpan={totalCols} sx={{ p: 0, border: 0 }}>
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
          <Row label="Received time"   value={row.receivedAt ? formatIstDateTime(row.receivedAt) : '—'} />
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
