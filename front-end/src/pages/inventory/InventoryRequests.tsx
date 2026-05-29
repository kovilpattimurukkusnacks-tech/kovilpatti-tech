import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FileEdit, Search, Printer } from 'lucide-react'
import { Alert, Box, Button, Chip, InputAdornment, Paper, TextField } from '@mui/material'
import { DataGrid, type GridColDef } from '@mui/x-data-grid'
import PageHeader from '../../components/PageHeader'
import { DispatchedCell } from '../../components/DispatchedCell'
import {
  useIncomingStockRequests, useCumulativePending, useRequestCountByShop,
  useInventoryDispatchDrafts,
} from '../../hooks/useStockRequests'
import { formatINR } from '../../utils/format'
import { formatIstDateTime } from '../../utils/formatDate'
import type { RequestStatus, RequestType, StockRequestDto } from '../../api/stock-requests/types'
import '../Products.css'

const STATUS_COLOR: Record<RequestStatus, 'default' | 'primary' | 'success' | 'error' | 'warning' | 'info'> = {
  // Inventory list excludes Draft server-side. Mapping kept for type-safety.
  Draft: 'default',
  Pending: 'warning', Approved: 'info', Rejected: 'error',
  Dispatched: 'primary', Received: 'success', Cancelled: 'default',
  // Returns' terminal state — green-success once goods are back at godown.
  Accepted: 'success',
}

// Quick-filter presets. Per client feedback (demo, 26 May 2026), the inventory
// list shows four lifecycle buckets:
//   • Needs Action = Pending (request just landed, not yet approved)
//   • In-Progress  = Approved (godown is working on it, shop can no longer edit)
//   • Delivered    = Received (shop confirmed receipt)
//   • All          = everything
// The previous "In Transit" (Dispatched) chip was dropped — dispatched rows
// surface under "All". "Approved" label was renamed to "In-Progress" to match
// how the client describes the workflow state.
// A fifth chip "Return" (added 28 May 2026) filters by request_type and cuts
// across statuses so the godown can see Pending Returns waiting for accept
// alongside Accepted ones in one place.
type Preset = {
  key: string
  label: string
  status?: RequestStatus
  requestType?: RequestType
}
const PRESETS: Preset[] = [
  { key: 'pending',  label: 'Needs Action', status: 'Pending'  },
  { key: 'approved', label: 'In-Progress',  status: 'Approved' },
  { key: 'received', label: 'Delivered',    status: 'Received' },
  { key: 'all',      label: 'All',          status: undefined  },
  { key: 'return',   label: 'Return',       requestType: 'Return' },
]

export default function InventoryRequests() {
  const navigate = useNavigate()
  // Default: Needs Action (Approved)
  const [activePreset, setActivePreset] = useState<string>('pending')
  // Optional second-level drill-down — clicking a shop chip toggles it.
  const [shopId, setShopId] = useState<string | undefined>(undefined)
  const [search, setSearch] = useState<string>('')
  const [paginationModel, setPaginationModel] = useState({ page: 0, pageSize: 10 })

  const currentPreset      = PRESETS.find(p => p.key === activePreset)
  const currentStatus      = currentPreset?.status
  const currentRequestType = currentPreset?.requestType

  const list = useIncomingStockRequests({
    status: currentStatus,
    requestType: currentRequestType,
    shopId,
    search: search.trim() || undefined,
    page: paginationModel.page + 1,
    pageSize: paginationModel.pageSize,
  })

  // Inventory user's own scope is enforced server-side, so no inventoryId
  // arg needed. We use it only to know whether the Print Cumulative button
  // should be enabled (empty queue → nothing to print).
  const cumulative = useCumulativePending()
  const hasPending = (cumulative.data?.length ?? 0) > 0

  // Per-shop chips for the active preset. BE forces the inventory scope to
  // this user's godown — so we only see shops served by it. When the Return
  // chip is active, both status and requestType collapse to a single filter
  // (requestType='Return', no status) so the chip row mirrors the table.
  const shopCounts = useRequestCountByShop({ status: currentStatus, requestType: currentRequestType })

  // Pending/Approved requests with a saved dispatch draft — surfaced as
  // strips below the page title so the user can jump back into any WIP
  // dispatch session in one click.
  const dispatchDrafts = useInventoryDispatchDrafts()

  const rows  = list.data?.items ?? []
  const total = list.data?.total ?? 0

  const columns = useMemo<GridColDef<StockRequestDto>[]>(() => {
    // Every chip shows date + time so the user can correlate timestamps
    // (requested at vs approved/dispatched/received at) at a glance.
    const codeCol: GridColDef<StockRequestDto> = {
      field: 'code', headerName: 'Code', width: 180, sortable: false, filterable: false,
      renderCell: ({ row }) => (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 600 }}>{row.code}</span>
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
        </Box>
      ),
    }
    const requestedDateCol: GridColDef<StockRequestDto> = {
      // Most useful triage signal — when the request landed in the queue.
      // Date + time on every chip including Needs Action and All, so the
      // godown user always sees how fresh the request is.
      field: 'submittedAt', headerName: 'Requested Date',
      width: 190,
      sortable: false, filterable: false,
      renderCell: ({ value }) => value
        ? formatIstDateTime(value as string)
        : <span className="text-[#1F1F1F]/40">—</span>,
    }

    // Code always leads — most reliable triage anchor across every chip
    // (Needs Action, In-Progress, Delivered, All). Date column(s) and
    // user / shop / qty columns follow.
    const cols: GridColDef<StockRequestDto>[] = [codeCol, requestedDateCol]
  // Lifecycle-specific second column — surfaces the timestamp of the state
  // each chip represents. Hidden on Needs Action / All to keep the grid
  // uncluttered. Date + time format matches the Requested Date column on
  // these chips so the pair reads consistently.
  if (activePreset === 'approved') {
    cols.push({
      field: 'approvedAt', headerName: 'In-Progress Since', width: 190, sortable: false, filterable: false,
      renderCell: ({ value }) => value
        ? formatIstDateTime(value as string)
        : <span className="text-[#1F1F1F]/40">—</span>,
    })
  }
  if (activePreset === 'received') {
    cols.push({
      field: 'receivedAt', headerName: 'Delivered On', width: 190, sortable: false, filterable: false,
      renderCell: ({ value }) => value
        ? formatIstDateTime(value as string)
        : <span className="text-[#1F1F1F]/40">—</span>,
    })
  }
  cols.push(
    {
      field: 'submittedByName', headerName: 'User', flex: 1, minWidth: 140, sortable: false, filterable: false,
      renderCell: ({ row }) =>
        row.submittedByName ?? <span className="text-[#1F1F1F]/40">—</span>,
    },
    {
      field: 'shopName', headerName: 'Shop', flex: 1, minWidth: 140, sortable: false, filterable: false,
    },
    {
      field: 'totalItems', headerName: 'Submitted Items', width: 140, sortable: false, filterable: false,
      align: 'right', headerAlign: 'right',
    },
    {
      field: 'totalQty', headerName: 'Submitted Qty', width: 140, sortable: false, filterable: false,
      align: 'right', headerAlign: 'right',
    },
    {
      // Sum of dispatched_qty across items. "—" until dispatch; red bold when
      // short; "Out of stock" chip when delivered nothing.
      field: 'totalDispatchedQty', headerName: 'Dispatched Qty', width: 160, sortable: false, filterable: false,
      align: 'right', headerAlign: 'right',
      renderCell: ({ row }) => <DispatchedCell qty={row.totalDispatchedQty} requested={row.totalQty} />,
    },
    {
      // Pre-dispatch: single requested total.
      // Post-dispatch: requested (muted, top) + delivered (bold, red when short).
      field: 'totalAmount', headerName: 'Total', flex: 0.7, minWidth: 140, sortable: false, filterable: false,
      align: 'center', headerAlign: 'center',
      renderCell: ({ row }) => {
        const hasDispatch = row.totalDispatchedAmount != null
        const short = hasDispatch && row.totalDispatchedAmount! < row.totalAmount
        if (!hasDispatch) {
          return <span>{formatINR(Number(row.totalAmount))}</span>
        }
        return (
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', lineHeight: 1.2, py: 0.5 }}>
            <Box sx={{ fontSize: 12, color: '#1F1F1F99' }}>
              {formatINR(Number(row.totalAmount))}
            </Box>
            <Box sx={{ fontSize: 13, fontWeight: 700, color: short ? '#C62828' : '#1F1F1F' }}>
              {formatINR(Number(row.totalDispatchedAmount))}
            </Box>
          </Box>
        )
      },
    },
    {
      field: 'status', headerName: 'Status', width: 120, sortable: false, filterable: false,
      align: 'center', headerAlign: 'center',
      renderCell: ({ value, row }) => (
        <Chip
          label={value}
          size="small"
          color={STATUS_COLOR[value as RequestStatus]}
          variant={row.status === 'Received' || row.status === 'Accepted' ? 'filled' : 'outlined'}
        />
      ),
    },
  )
  return cols
  }, [activePreset])

  const errorMessage = list.isError
    ? (list.error instanceof Error ? list.error.message : 'Failed to load requests.')
    : null

  return (
    <div>
      <PageHeader
        title="Incoming Requests"
        subtitle={list.isLoading ? 'Loading…' : `${total} ${total === 1 ? 'request' : 'requests'}`}
        action={
          <Button
            variant="contained"
            startIcon={<Printer className="w-4 h-4" />}
            onClick={() => window.open('/print/cumulative', '_blank', 'noopener,noreferrer')}
            disabled={!hasPending}
            title={hasPending ? undefined : 'No in-progress requests to print'}
            sx={{ textTransform: 'none', fontWeight: 600 }}
          >
            Print Cumulative
          </Button>
        }
      />

      {errorMessage && <Alert severity="error" sx={{ mb: 2 }}>{errorMessage}</Alert>}

      {/* Dispatch draft strips — one Paper per request that has WIP dispatch
          qtys saved. Mirrors the shop-side "Resume Draft" strip but can
          stack multiple cards since an inventory user may have drafts on
          several requests. Hidden when the list is empty. */}
      {(dispatchDrafts.data?.length ?? 0) > 0 && (
        <Box sx={{ mb: 2, display: 'flex', flexDirection: 'column', gap: 1 }}>
          {dispatchDrafts.data!.map(d => (
            <Paper
              key={d.id}
              elevation={0}
              sx={{
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
                <Box sx={{ fontWeight: 700, fontSize: 14 }}>
                  Resume dispatch draft — {d.code}
                </Box>
                <Box sx={{ fontSize: 12, color: '#1F1F1F99' }}>
                  {d.shopCode} · {d.shopName}
                  · {d.totalItems} {d.totalItems === 1 ? 'product' : 'products'}
                  · {d.totalQty} {d.totalQty === 1 ? 'unit' : 'units'}
                  · Last saved {formatIstDateTime(d.updatedAt)}
                </Box>
              </Box>
              <Button
                variant="contained"
                size="small"
                onClick={() => navigate(`/inventory/requests/${d.id}`)}
                sx={{ textTransform: 'none', fontWeight: 700, whiteSpace: 'nowrap' }}
              >
                Resume
              </Button>
            </Paper>
          ))}
        </Box>
      )}

      {/* Status chips + search — inline single row. Inventory filters per
          client (demo, 26 May 2026): no date filter, no collapse panel,
          chips collapsed to Needs Action / In-Progress / Delivered / All.
          The Return chip (28 May 2026) is themed red to match the inline
          Return pill on rows + detail. */}
      <Box sx={{ display: 'flex', gap: 1.5, mb: 1.5, flexWrap: 'wrap', alignItems: 'center' }}>
        {PRESETS.map(p => {
          const active   = activePreset === p.key
          const isReturn = p.key === 'return'
          return (
            <Button
              key={p.key}
              onClick={() => {
                setActivePreset(p.key)
                // Drop the shop drill-down when the preset changes — a shop
                // that has rows in one bucket may have none in the next.
                setShopId(undefined)
                setPaginationModel(m => ({ ...m, page: 0 }))
              }}
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
                      bgcolor: '#FFFFFF', color: '#C62828',
                      borderColor: 'rgba(198,40,40,0.45)',
                      '&:hover': { borderColor: '#C62828', bgcolor: 'rgba(198,40,40,0.06)' },
                    }
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

        <Box sx={{ flex: 1 }} />

        <TextField
          size="small"
          value={search}
          onChange={e => { setSearch(e.target.value); setPaginationModel(m => ({ ...m, page: 0 })) }}
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

      {/* Per-shop drill-down chips for the active status filter. Server
          prunes zero-count shops; row hidden when nothing matches. Click a
          chip to filter; click again to clear. */}
      {(shopCounts.data?.length ?? 0) > 0 && (
        <Box sx={{ display: 'flex', gap: 1, mb: 2, flexWrap: 'wrap', alignItems: 'center' }}>
          <Box sx={{ fontSize: 12, fontWeight: 600, color: '#1F1F1F99', mr: 0.5 }}>
            By shop:
          </Box>
          {shopCounts.data!.map(s => {
            const active = shopId === s.shopId
            return (
              <Chip
                key={s.shopId}
                onClick={() => {
                  setShopId(prev => prev === s.shopId ? undefined : s.shopId)
                  setPaginationModel(m => ({ ...m, page: 0 }))
                }}
                label={`${s.shopName} (${s.requestCount})`}
                size="small"
                variant={active ? 'filled' : 'outlined'}
                sx={{
                  cursor: 'pointer',
                  borderRadius: 999,
                  fontWeight: 600,
                  ...(active
                    ? {
                        background: 'linear-gradient(90deg, #C28A00 0%, #E6B800 35%, #FFD700 65%, #FFF1A6 100%)',
                        color: '#1F1F1F',
                        borderColor: '#C28A00',
                        '&:hover': {
                          background: 'linear-gradient(90deg, #A07000 0%, #C28A00 35%, #E6B800 65%, #FFD700 100%)',
                        },
                      }
                    : {
                        bgcolor: '#FFFFFF', color: '#1F1F1F',
                        borderColor: 'rgba(31,31,31,0.2)',
                        '&:hover': { bgcolor: '#FFF8DC', borderColor: '#1F1F1F' },
                      }),
                }}
              />
            )
          })}
        </Box>
      )}

      <Paper className="products-paper" sx={{ borderRadius: 2.5 }} elevation={0}>
        <DataGrid
          className="products-grid"
          rows={rows}
          columns={columns}
          getRowId={r => r.id}
          loading={list.isLoading}
          autoHeight
          disableRowSelectionOnClick
          disableColumnMenu
          onRowClick={(p) => navigate(`/inventory/requests/${p.id}`)}
          // Tint rows that need the godown's action so they pop visually.
          // Highlight rows the godown needs to act on. "Approved" stays in the
          // check for legacy rows that pre-date the approval-step removal.
          getRowClassName={(p) => p.row.status === 'Pending' || p.row.status === 'Approved' ? 'row-action' : ''}
          paginationMode="server"
          rowCount={total}
          paginationModel={paginationModel}
          onPaginationModelChange={setPaginationModel}
          pageSizeOptions={[10, 25, 50, 100]}
          sx={{
            '& .row-action':       { bgcolor: '#FFFBE6', cursor: 'pointer' },
            '& .row-action:hover': { bgcolor: '#FFF4B8 !important' },
            '& .MuiDataGrid-row':  { cursor: 'pointer' },
          }}
        />
      </Paper>
    </div>
  )
}
