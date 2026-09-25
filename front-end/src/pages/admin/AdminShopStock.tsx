import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Alert, Box, Button, InputAdornment, MenuItem, TextField, Typography } from '@mui/material'
import { DataGrid, type GridColDef } from '@mui/x-data-grid'
import { FileUp, Search, SlidersHorizontal } from 'lucide-react'
import PageHeader from '../../components/PageHeader'
import { GridPaper, SegmentedTabs, StatCard } from '../../components/sales/salesUi'
import { CREAM, GAIN_GREEN, gridSx, LOSS_RED } from '../../components/sales/salesTheme'
import StockAdjustDialog from '../../components/stock/StockAdjustDialog'
import OpeningImportDialog from '../../components/stock/OpeningImportDialog'
import ProductMovementsDialog from '../../components/stock/ProductMovementsDialog'
import { MOVEMENT_LABEL } from '../../components/stock/stockLabels'
import { useShops } from '../../hooks/useShops'
import { useDebouncedValue } from '../../hooks/useDebouncedValue'
import {
  useShopInventoryList, useShopInventoryLowStock, useShopInventoryMovements, useShopInventoryValuation,
} from '../../hooks/useShopInventory'
import type {
  ShopInventoryLowStockDto, ShopInventoryMovementDto, ShopInventoryRowDto,
} from '../../api/shop-inventory/types'
import { useToast } from '../../context/ToastContext'
import { formatINR } from '../../utils/format'
import { formatIstDateTime } from '../../utils/formatDate'
import { istDate } from '../../utils/istDate'

type TabKey = 'stock' | 'low' | 'movements'
const LOW_THRESHOLDS = [3, 5, 10, 20]

/**
 * Admin → Shop Stock (Phase 4d). What each shop has on the shelf right now:
 * on-hand list, low stock, recent movements, manual adjustments and the
 * opening-stock import. Shop stock goes up when stock requests are received
 * and down when the POS sells, so an opening import is needed once per shop
 * before billing starts.
 */
export default function AdminShopStock() {
  const [params, setParams] = useSearchParams()
  const toast = useToast()
  const shops = (useShops().data ?? []).slice().sort((a, b) => a.name.localeCompare(b.name))

  const shopId = shops.some(s => s.id === params.get('shop')) ? params.get('shop')! : ''
  const shop = shops.find(s => s.id === shopId)
  const tab = (['stock', 'low', 'movements'].includes(params.get('tab') ?? '') ? params.get('tab') : 'stock') as TabKey

  const setParam = (k: string, v: string) => {
    const next = new URLSearchParams(params)
    if (v) next.set(k, v); else next.delete(k)
    setParams(next, { replace: true })
  }

  const [adjustFor, setAdjustFor] = useState<{ productId: string; label: string; onHand: number } | null | 'new'>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [historyFor, setHistoryFor] = useState<{ id: string; label: string } | null>(null)

  return (
    <div>
      <PageHeader
        title="Shop Stock"
        subtitle="On-hand stock at each shop — adjust, check history, import opening stock"
        action={shop && (
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            <Button variant="outlined" startIcon={<FileUp size={16} />} onClick={() => setImportOpen(true)}
              sx={{ textTransform: 'none', fontWeight: 700, bgcolor: CREAM }}>
              Import opening stock
            </Button>
            <Button variant="contained" color="primary" startIcon={<SlidersHorizontal size={16} />} onClick={() => setAdjustFor('new')}
              sx={{ textTransform: 'none', fontWeight: 700 }}>
              Adjust stock
            </Button>
          </Box>
        )}
      />

      <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap', mb: 2 }}>
        <TextField
          select
          size="small"
          label="Shop"
          value={shopId}
          onChange={e => setParam('shop', e.target.value)}
          sx={{ minWidth: 260, bgcolor: CREAM }}
        >
          {shops.map(s => <MenuItem key={s.id} value={s.id}>{s.code} — {s.name}</MenuItem>)}
        </TextField>
        {shop && (
          <SegmentedTabs<TabKey>
            value={tab}
            onChange={k => setParam('tab', k)}
            options={[{ key: 'stock', label: 'Stock' }, { key: 'low', label: 'Low stock' }, { key: 'movements', label: 'Recent movements' }]}
          />
        )}
      </Box>

      {!shop && (
        <Alert severity="info">Choose a shop to see its stock.</Alert>
      )}

      {shop && (
        <>
          <StockSummary shopId={shop.id} />
          {tab === 'stock' && (
            <StockTab
              key={shop.id}
              shopId={shop.id}
              onHistory={setHistoryFor}
              onAdjust={row => setAdjustFor({ productId: row.productId, label: `${row.productCode} · ${row.productName}`, onHand: row.onHand })}
            />
          )}
          {tab === 'low' && <LowStockTab key={shop.id} shopId={shop.id} onHistory={setHistoryFor} />}
          {tab === 'movements' && <MovementsTab key={shop.id} shopId={shop.id} />}

          {adjustFor && (
            <StockAdjustDialog
              open
              shopId={shop.id}
              shopName={shop.name}
              preset={adjustFor === 'new' ? null : adjustFor}
              onClose={() => setAdjustFor(null)}
              onDone={msg => { setAdjustFor(null); toast.success({ title: 'Stock adjusted', description: msg }) }}
            />
          )}
          {importOpen && (
            <OpeningImportDialog
              shopId={shop.id}
              shopName={shop.name}
              onClose={() => setImportOpen(false)}
              onDone={msg => toast.success({ title: 'Opening stock imported', description: msg })}
            />
          )}
          <ProductMovementsDialog shopId={shop.id} product={historyFor} onClose={() => setHistoryFor(null)} />
        </>
      )}
    </div>
  )
}

function StockSummary({ shopId }: { shopId: string }) {
  const valuation = useShopInventoryValuation(shopId)
  const list = useShopInventoryList({ shopId, page: 1, pageSize: 1 })
  const low = useShopInventoryLowStock(5, shopId)
  return (
    <Box sx={{ display: 'grid', gap: 2, mb: 2, gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, 1fr)' } }}>
      <StatCard label="Stock value (at cost)" value={valuation.data} loading={valuation.isLoading} tone="gold" />
      <StatCard label="Products held" value={list.data?.total} loading={list.isLoading} money={false} />
      <StatCard label="Low stock (under 5)" value={low.data?.length} loading={low.isLoading} money={false}
        tone={low.data && low.data.length > 0 ? 'red' : undefined} />
    </Box>
  )
}

function StockTab({ shopId, onHistory, onAdjust }: {
  shopId: string
  onHistory: (p: { id: string; label: string }) => void
  onAdjust: (row: ShopInventoryRowDto) => void
}) {
  const [paging, setPaging] = useState({ page: 0, pageSize: 25 })
  const [searchInput, setSearchInput] = useState('')
  const search = useDebouncedValue(searchInput.trim(), 300)
  const [lastSearch, setLastSearch] = useState('')
  if (search !== lastSearch) { setLastSearch(search); if (paging.page !== 0) setPaging(p => ({ ...p, page: 0 })) }

  const list = useShopInventoryList({ shopId, search: search || undefined, page: paging.page + 1, pageSize: paging.pageSize })

  const columns: GridColDef<ShopInventoryRowDto>[] = [
    { field: 'productCode', headerName: 'Code', width: 90 },
    { field: 'productName', headerName: 'Product', flex: 1, minWidth: 200 },
    { field: 'categoryName', headerName: 'Category', width: 160 },
    { field: 'onHand', headerName: 'On hand', type: 'number', width: 100,
      renderCell: ({ value }) => (
        <span style={{ fontWeight: 800, color: (value as number) < 5 ? LOSS_RED : undefined }}>{value as number}</span>
      ) },
    { field: 'mrp', headerName: 'MRP', type: 'number', width: 100, valueFormatter: v => formatINR(v as number) },
    { field: 'avgCost', headerName: 'Avg cost', type: 'number', width: 105, valueFormatter: v => formatINR(v as number) },
    { field: 'stockValue', headerName: 'Value', type: 'number', width: 120, valueFormatter: v => formatINR(v as number) },
    { field: 'lastMovementAt', headerName: 'Last change', width: 160, valueFormatter: v => formatIstDateTime(v as string | null) },
    { field: 'actions', headerName: '', width: 100, sortable: false, align: 'right',
      renderCell: ({ row }) => (
        <Button size="small" onClick={e => { e.stopPropagation(); onAdjust(row) }}
          sx={{ textTransform: 'none', fontWeight: 700 }}
          aria-label={`Adjust stock of ${row.productName}`} title={`Adjust stock of ${row.productName}`}>
          Adjust
        </Button>
      ) },
  ]

  return (
    <Box>
      <TextField
        size="small"
        placeholder="Search code or name"
        value={searchInput}
        onChange={e => setSearchInput(e.target.value)}
        sx={{ mb: 2, minWidth: 280, bgcolor: CREAM }}
        slotProps={{ input: { startAdornment: <InputAdornment position="start"><Search size={16} /></InputAdornment> } }}
      />
      {list.isError && <Alert severity="error" sx={{ mb: 2 }}>{list.error instanceof Error ? list.error.message : 'Failed to load stock.'}</Alert>}
      <GridPaper>
        <DataGrid
          rows={list.data?.items ?? []}
          columns={columns}
          getRowId={r => r.productId}
          loading={list.isFetching}
          autoHeight
          disableRowSelectionOnClick
          disableColumnMenu
          paginationMode="server"
          rowCount={list.data?.total ?? 0}
          paginationModel={paging}
          onPaginationModelChange={setPaging}
          pageSizeOptions={[25, 50, 100]}
          onRowClick={p => onHistory({ id: p.row.productId, label: `${p.row.productCode} · ${p.row.productName}` })}
          sx={gridSx}
          localeText={{ noRowsLabel: search ? 'No product matches.' : 'This shop has no stock yet — use “Import opening stock”.' }}
        />
      </GridPaper>
      <Typography variant="caption" sx={{ display: 'block', mt: 0.75, opacity: 0.7 }}>
        Click a row to see its stock history.
      </Typography>
    </Box>
  )
}

function LowStockTab({ shopId, onHistory }: { shopId: string; onHistory: (p: { id: string; label: string }) => void }) {
  const [threshold, setThreshold] = useState(5)
  const low = useShopInventoryLowStock(threshold, shopId)

  const columns: GridColDef<ShopInventoryLowStockDto>[] = [
    { field: 'productCode', headerName: 'Code', width: 90 },
    { field: 'productName', headerName: 'Product', flex: 1, minWidth: 200 },
    { field: 'categoryPath', headerName: 'Category', flex: 1, minWidth: 180, valueFormatter: v => (v as string) ?? '—' },
    { field: 'onHand', headerName: 'On hand', type: 'number', width: 100,
      renderCell: ({ value }) => <span style={{ fontWeight: 800, color: LOSS_RED }}>{value as number}</span> },
    { field: 'mrp', headerName: 'MRP', type: 'number', width: 100, valueFormatter: v => formatINR(v as number) },
  ]

  return (
    <Box>
      <TextField select size="small" label="Show products with fewer than" value={threshold}
        onChange={e => setThreshold(Number(e.target.value))} sx={{ mb: 2, minWidth: 240, bgcolor: CREAM }}>
        {LOW_THRESHOLDS.map(t => <MenuItem key={t} value={t}>{t} packets</MenuItem>)}
      </TextField>
      {low.isError && <Alert severity="error" sx={{ mb: 2 }}>{low.error instanceof Error ? low.error.message : 'Failed to load.'}</Alert>}
      <GridPaper>
        <DataGrid
          rows={low.data ?? []}
          columns={columns}
          getRowId={r => r.productId}
          loading={low.isLoading}
          autoHeight
          disableRowSelectionOnClick
          disableColumnMenu
          initialState={{ pagination: { paginationModel: { pageSize: 25 } } }}
          pageSizeOptions={[25, 50, 100]}
          onRowClick={p => onHistory({ id: p.row.productId, label: `${p.row.productCode} · ${p.row.productName}` })}
          sx={gridSx}
          localeText={{ noRowsLabel: 'Nothing is running low.' }}
        />
      </GridPaper>
    </Box>
  )
}

function MovementsTab({ shopId }: { shopId: string }) {
  const [days, setDays] = useState(7)
  const moves = useShopInventoryMovements({ shopId, fromDate: istDate(-(days - 1)), toDate: istDate(), pageSize: 200 })

  const columns: GridColDef<ShopInventoryMovementDto>[] = [
    { field: 'createdAt', headerName: 'When', width: 165, valueFormatter: v => formatIstDateTime(v as string) },
    { field: 'productCode', headerName: 'Code', width: 90 },
    { field: 'productName', headerName: 'Product', flex: 1, minWidth: 180 },
    { field: 'movementType', headerName: 'What', width: 190,
      valueFormatter: v => MOVEMENT_LABEL[v as keyof typeof MOVEMENT_LABEL] ?? (v as string) },
    { field: 'qtyDelta', headerName: 'Change', type: 'number', width: 95,
      renderCell: ({ value }) => (
        <span style={{ fontWeight: 800, color: (value as number) < 0 ? LOSS_RED : GAIN_GREEN }}>
          {(value as number) > 0 ? `+${value}` : (value as number)}
        </span>
      ) },
    { field: 'qtyAfter', headerName: 'Stock after', type: 'number', width: 105 },
    { field: 'createdByName', headerName: 'By', width: 140, valueFormatter: v => (v as string) ?? '—' },
    { field: 'note', headerName: 'Note', flex: 1, minWidth: 160, valueFormatter: v => (v as string) ?? '' },
  ]

  return (
    <Box>
      <TextField select size="small" label="Period" value={days} onChange={e => setDays(Number(e.target.value))}
        sx={{ mb: 2, minWidth: 180, bgcolor: CREAM }}>
        <MenuItem value={1}>Today</MenuItem>
        <MenuItem value={7}>Last 7 days</MenuItem>
        <MenuItem value={30}>Last 30 days</MenuItem>
      </TextField>
      {moves.isError && <Alert severity="error" sx={{ mb: 2 }}>{moves.error instanceof Error ? moves.error.message : 'Failed to load.'}</Alert>}
      <GridPaper>
        <DataGrid
          rows={moves.data ?? []}
          columns={columns}
          getRowId={r => r.id}
          loading={moves.isLoading}
          autoHeight
          disableRowSelectionOnClick
          disableColumnMenu
          initialState={{ pagination: { paginationModel: { pageSize: 25 } } }}
          pageSizeOptions={[25, 50, 100]}
          sx={{ ...gridSx, '& .MuiDataGrid-row': { cursor: 'default' } }}
          localeText={{ noRowsLabel: 'No stock movements in this period.' }}
        />
      </GridPaper>
      {moves.data && moves.data.length >= 200 && (
        <Typography variant="caption" sx={{ display: 'block', mt: 0.75, opacity: 0.7 }}>
          Showing the latest 200 movements — pick a shorter period to see everything.
        </Typography>
      )}
    </Box>
  )
}
