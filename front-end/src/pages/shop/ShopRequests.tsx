import { Fragment, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, ChevronDown, ChevronRight, FileEdit, Package, Plus, Search } from 'lucide-react'
import {
  Alert, Box, Button, Chip, Collapse, IconButton, InputAdornment, Paper,
  Table, TableBody, TableCell, TableContainer, TableHead, TablePagination, TableRow, TextField,
} from '@mui/material'
import PageHeader from '../../components/PageHeader'
import { DispatchedCell } from '../../components/DispatchedCell'
import { useMyStockRequests, useShopDraft, useOutstandingBackorders } from '../../hooks/useStockRequests'
import { BackorderChip } from '../../components/BackorderChip'
import { Hourglass } from 'lucide-react'
import { formatINR } from '../../utils/format'
import { formatIstDateTime } from '../../utils/formatDate'
import type { StockRequestDto, RequestStatus, RequestType, StockRequestListFilters } from '../../api/stock-requests/types'

// Quick-filter chip presets. Per client feedback (demo, 26 May 2026), shop
// users only care about three lifecycle buckets — All / Pending / Received —
// plus a dedicated Return chip (added 28 May 2026) that cuts across statuses
// to show every Return regardless of where it sits in the flow. The Return
// preset filters by request_type; the others by status.
type Preset = {
  key: string
  label: string
  status?: RequestStatus
  requestType?: RequestType
}
const PRESETS: Preset[] = [
  { key: 'all',        label: 'All',        status: undefined },
  { key: 'pending',    label: 'Pending',    status: 'Pending'    },
  // Dispatched preset (01-Jul-2026 client req) — target of the "orders
  // awaiting your receipt" banner. Lets shop staff drill straight to the
  // list they need to confirm receipt on.
  { key: 'dispatched', label: 'Dispatched', status: 'Dispatched' },
  { key: 'received',   label: 'Received',   status: 'Received'   },
  { key: 'return',     label: 'Return',     requestType: 'Return' },
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
  // Returns' terminal state — green-success, same as Received, since the
  // goods have changed hands successfully (just in the opposite direction).
  Accepted:   'success',
}

export default function ShopRequests() {
  const navigate = useNavigate()
  // Default to Pending — shop user lands on what's still outstanding
  // (29-Jun-2026 client follow-up); they can switch to All any time.
  const [activePreset, setActivePreset] = useState<string>('pending')
  const [search, setSearch] = useState<string>('')
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(10)
  // Only one row open at a time so the table stays scannable.
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const currentPreset      = PRESETS.find(p => p.key === activePreset)
  const currentStatus      = currentPreset?.status
  const currentRequestType = currentPreset?.requestType

  const list = useMyStockRequests({
    status: currentStatus,
    requestType: currentRequestType,
    search: search.trim() || undefined,
    page: page + 1,
    pageSize,
  } satisfies StockRequestListFilters)

  // Status-specific extra column — only the Received chip surfaces a
  // timestamp (the moment the shop confirmed receipt). All / Pending have
  // no extra column so the table stays compact.
  const mutedDash = <span className="text-[#1F1F1F]/40">—</span>
  const extraCol: { header: string; render: (r: StockRequestDto) => React.ReactNode } | null =
      activePreset === 'received'   ? { header: 'Received',   render: r => r.receivedAt   ? formatIstDateTime(r.receivedAt)   : mutedDash }
    : activePreset === 'dispatched' ? { header: 'Dispatched', render: r => r.dispatchedAt ? formatIstDateTime(r.dispatchedAt) : mutedDash }
    : null
  // Total column count — used by the empty-state row and the expansion-row
  // colSpan so the layout stays correct whichever chip is active.
  const totalCols = extraCol ? 6 : 5

  // Shop's single live draft (or null). Resume Draft strip renders only when
  // this resolves to non-null.
  const draftQuery = useShopDraft()

  // Dispatched-orders peek (01-Jul-2026): a tiny page-size:1 query only to
  // read `total`. Powers the "N orders awaiting your receipt" banner at
  // the top of the page. Runs alongside the main list — different query
  // key, so no interference with the current-tab filter. Refetches
  // whenever the main list is mutated (React Query auto-invalidates
  // stock-requests queries on receive/dispatch actions).
  const dispatchedPeek = useMyStockRequests({
    status: 'Dispatched',
    page: 1,
    pageSize: 1,
  } satisfies StockRequestListFilters)
  const dispatchedCount = dispatchedPeek.data?.total ?? 0
  // Only surface the banner when there IS something to confirm AND the
  // user isn't already on the Dispatched tab (would be redundant).
  const showDispatchedBanner = dispatchedCount > 0 && activePreset !== 'dispatched'

  // Outstanding back-orders (02-Jul-2026). Pipeline snapshot — never date-
  // filtered so month-end back-orders stay visible until they close.
  const backordersQuery = useOutstandingBackorders()
  const outstandingBackorders = backordersQuery.data ?? []

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

      {/* Awaiting-receipt banner (01-Jul-2026 client req). Renders when the
          shop has Dispatched orders that they haven't confirmed yet — so
          shop staff can't miss the "you have work" signal even when their
          default Pending tab is empty. Clicking View jumps them straight
          to the Dispatched tab so the list is exactly what they need. */}
      {/* Outstanding back-orders banner (02-Jul-2026). Shows any Pending
          Backorder requests belonging to this shop — the godown is waiting
          on vendor stock. Pipeline-scoped, cross-month. */}
      {outstandingBackorders.length > 0 && (
        <Paper
          elevation={0}
          sx={{
            mb: 2, borderRadius: 2,
            border: '1px solid #E8A758',
            bgcolor: '#FFE0B2',
            px: 2, py: 1.5,
            display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap',
          }}
        >
          <Hourglass className="w-5 h-5" style={{ color: '#7C4A00' }} />
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Box sx={{ fontWeight: 700, fontSize: 14, color: '#7C4A00' }}>
              {outstandingBackorders.length} back-order{outstandingBackorders.length === 1 ? '' : 's'} outstanding
            </Box>
            <Box sx={{ fontSize: 12, color: '#7C4A00CC' }}>
              Items the godown is waiting to receive from vendors. You'll be notified when they're dispatched.
              {outstandingBackorders.some(b => b.expectedArrivalAt) && (
                <> ETAs: {outstandingBackorders.filter(b => b.expectedArrivalAt).slice(0, 3).map(b => (
                  <span key={b.id} style={{ marginRight: 8, fontWeight: 600 }}>
                    {b.code} → {new Date(b.expectedArrivalAt!).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                  </span>
                ))}</>
              )}
            </Box>
          </Box>
        </Paper>
      )}

      {showDispatchedBanner && (
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
          <Package className="w-5 h-5 text-[#1F1F1F]" />
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Box sx={{ fontWeight: 700, fontSize: 14 }}>
              {dispatchedCount} {dispatchedCount === 1 ? 'order' : 'orders'} awaiting your receipt
            </Box>
            <Box sx={{ fontSize: 12, color: '#1F1F1F99' }}>
              The godown has dispatched {dispatchedCount === 1 ? 'this order' : 'these orders'} — open each one and confirm you've received the goods.
            </Box>
          </Box>
          <Button
            variant="contained"
            size="small"
            onClick={() => { setActivePreset('dispatched'); setPage(0) }}
            sx={{ textTransform: 'none', fontWeight: 700, whiteSpace: 'nowrap' }}
          >
            View
          </Button>
        </Paper>
      )}

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

      {/* Status chips + search — inline single row. Shop user filters per
          client (demo, 26 May 2026): three status buckets, no date filter, no
          collapse panel. The fourth chip "Return" (added 28 May 2026) filters
          by request_type instead of status, and is themed red to match the
          inline Return pill on the row + detail page. */}
      <Box sx={{ display: 'flex', gap: 1.5, mb: 2, flexWrap: 'wrap', alignItems: 'center' }}>
        {PRESETS.map(p => {
          const active   = activePreset === p.key
          const isReturn = p.key === 'return'
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
                  ? isReturn
                    ? { bgcolor: '#C62828', color: '#FFFFFF', '&:hover': { bgcolor: '#A82020' } }
                    : {
                      background: 'linear-gradient(90deg, #C28A00 0%, #E6B800 35%, #FFD700 65%, #FFF1A6 100%)',
                      color: '#1F1F1F',
                      borderColor: '#C28A00',
                      '&:hover': {
                        background: 'linear-gradient(90deg, #A07000 0%, #C28A00 35%, #E6B800 65%, #FFD700 100%)',
                      },
                    }
                  : isReturn
                  ? {
                      bgcolor: '#FFF8E1', color: '#C62828',
                      borderColor: 'rgba(198,40,40,0.45)',
                      '&:hover': { borderColor: '#C62828', bgcolor: 'rgba(198,40,40,0.06)' },
                    }
                  : {
                      bgcolor: '#FFF8E1', color: '#1F1F1F',
                      borderColor: 'rgba(31,31,31,0.25)',
                      '&:hover': { borderColor: '#1F1F1F', bgcolor: '#FFF8DC' },
                    }),
              }}
            >
              {p.label}
            </Button>
          )
        })}

        <Box sx={{ flex: 1 }} />

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
      </Box>

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
                        // Cream-tinted row by default — matches the warm look
                        // on InventoryRequests so every list page reads the
                        // same. Goes slightly deeper when expanded.
                        bgcolor: isOpen ? '#FFF4B8' : '#FFFBE6',
                        // When expanded, drop the divider so the main row
                        // flows visually into the expansion panel; collapsed
                        // rows keep the divider so the table doesn't blob.
                        ...(isOpen && {
                          '& > *': { borderBottom: 'unset' },
                        }),
                      }}
                    >
                      <TableCell sx={{ width: 48 }}>
                        <IconButton size="small" aria-label={isOpen ? 'Collapse' : 'Expand'}>
                          {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                        </IconButton>
                      </TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                          <span>{row.code}</span>
                          {row.requestType === 'Return' && (
                            <Chip
                              label="Return"
                              size="small"
                              variant="outlined"
                              sx={{
                                borderColor: '#C62828',
                                color: '#C62828',
                                fontWeight: 700,
                                fontSize: 10,
                                height: 20,
                                letterSpacing: 0.5,
                              }}
                            />
                          )}
                          {row.requestType === 'Backorder' && <BackorderChip size="small" />}
                          {row.parentRequestCode && row.requestType !== 'Backorder' && null}
                        </Box>
                      </TableCell>
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
                          variant={row.status === 'Received' || row.status === 'Accepted' ? 'filled' : 'outlined'}
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
