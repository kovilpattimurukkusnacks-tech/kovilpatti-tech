import { useEffect, useMemo, useRef, useState } from 'react'
import { Plus, Edit2, Trash2, X, Package, Upload, Filter as FilterIcon } from 'lucide-react'
import {
  Alert, Badge, Box, Button, Checkbox, Chip, Dialog, DialogActions, DialogContent, DialogTitle,
  IconButton, MenuItem, Paper, TextField,
} from '@mui/material'
import { DataGrid, type GridColDef } from '@mui/x-data-grid'
import PageHeader from '../components/PageHeader'
import ConfirmDialog from '../components/ConfirmDialog'
import { useProducts, useCreateProduct, useUpdateProduct, useDeleteProduct, useImportProducts } from '../hooks/useProducts'
import { useCategories } from '../hooks/useCategories'
import type {
  ProductDto, CreateProductRequest, UpdateProductRequest, ImportProductsResult, ProductListFilters,
} from '../api/products/types'
import type { CategoryDto } from '../api/categories/types'
import { ValidationError } from '../api/errors'
import './Products.css'

type FormMode =
  | { kind: 'closed' }
  | { kind: 'create' }
  | { kind: 'edit'; product: ProductDto }

type FormValues = {
  name: string
  categoryId: number
  type: string
  weightValue: string  // raw input, parsed on submit
  weightUnit: 'g' | 'kg'
  mrp: string
  purchasePrice: string
  active: boolean
}

export default function Products() {
  const [filters, setFilters] = useState<ProductListFilters>({})
  // DataGrid uses 0-indexed pages; BE uses 1-indexed. Convert on the wire.
  const [paginationModel, setPaginationModel] = useState({ page: 0, pageSize: 10 })

  const list = useProducts({
    ...filters,
    page: paginationModel.page + 1,
    pageSize: paginationModel.pageSize,
  })
  const categoriesQuery = useCategories()
  const create = useCreateProduct()
  const update = useUpdateProduct()
  const remove = useDeleteProduct()

  const [formMode, setFormMode] = useState<FormMode>({ kind: 'closed' })
  const [pendingDelete, setPendingDelete] = useState<ProductDto | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [filterOpen, setFilterOpen] = useState(false)

  const activeFilterCount =
    (filters.search ? 1 : 0) + (filters.categoryId != null ? 1 : 0)

  const products  = list.data?.items ?? []
  const total     = list.data?.total ?? 0
  const categories = categoriesQuery.data ?? []

  // Whenever filters change, jump back to page 0 so the user lands on the
  // first page of the newly-filtered result set instead of an empty page N.
  useEffect(() => {
    setPaginationModel(prev => ({ ...prev, page: 0 }))
  }, [filters.search, filters.categoryId])

  const closeForm = () => setFormMode({ kind: 'closed' })

  const handleSave = async (values: FormValues) => {
    const weightValue = values.weightValue.trim() ? Number(values.weightValue) : null
    const common = {
      name: values.name,
      categoryId: values.categoryId,
      type: values.type,
      weightValue,
      weightUnit: values.weightUnit,
      mrp: Number(values.mrp),
      purchasePrice: Number(values.purchasePrice),
    }

    if (formMode.kind === 'edit') {
      const req: UpdateProductRequest = { ...common, active: values.active }
      await update.mutateAsync({ id: formMode.product.id, req })
    } else if (formMode.kind === 'create') {
      const req: CreateProductRequest = { ...common, active: values.active }
      await create.mutateAsync(req)
    }
    closeForm()
  }

  const handleConfirmDelete = async () => {
    if (!pendingDelete) return
    try {
      await remove.mutateAsync(pendingDelete.id)
    } finally {
      setPendingDelete(null)
    }
  }

  const columns = useMemo<GridColDef<ProductDto>[]>(() => [
    { field: 'code',         headerName: 'Code',         width: 100, sortable: false, filterable: false },
    { field: 'name',         headerName: 'Product Name', flex: 1.5,  minWidth: 200, sortable: false, filterable: false },
    {
      field: 'categoryName', headerName: 'Category',     width: 130, sortable: false, filterable: false,
      renderCell: ({ value }) => <Chip label={value} size="small" variant="outlined" />,
    },
    { field: 'type',         headerName: 'Type',         width: 100, sortable: false, filterable: false },
    {
      field: 'weight',       headerName: 'Net Weight',   width: 130, sortable: false, filterable: false,
      valueGetter: (_v, row) =>
        row.weightValue != null ? `${row.weightValue} ${row.weightUnit ?? ''}`.trim() : '—',
    },
    {
      field: 'mrp',          headerName: 'MRP',          width: 110, sortable: false, filterable: false,
      renderCell: ({ value }) => <span>₹ {value}</span>,
    },
    {
      field: 'purchasePrice', headerName: 'Purchase Price', width: 130, sortable: false, filterable: false,
      renderCell: ({ value }) =>
        value == null ? <span className="text-[#1F1F1F]/40">—</span> : <span>₹ {value}</span>,
    },
    {
      field: 'active', headerName: 'Status', width: 100, sortable: false, filterable: false,
      renderCell: ({ value }) => (
        <Chip
          label={value ? 'Active' : 'Inactive'}
          size="small"
          variant={value ? 'filled' : 'outlined'}
          color={value ? 'success' : 'default'}
        />
      ),
    },
    {
      field: 'actions', headerName: 'Actions', width: 120, sortable: false, filterable: false,
      align: 'right', headerAlign: 'right',
      cellClassName: 'col-pin-right',
      headerClassName: 'col-pin-right',
      renderCell: ({ row }) => (
        <Box>
          <IconButton size="small" onClick={() => setFormMode({ kind: 'edit', product: row })}>
            <Edit2 className="w-4 h-4" />
          </IconButton>
          <IconButton size="small" color="error" onClick={() => setPendingDelete(row)}>
            <Trash2 className="w-4 h-4" />
          </IconButton>
        </Box>
      ),
    },
  ], [])

  const errorMessage = list.isError
    ? (list.error instanceof Error ? list.error.message : 'Failed to load products.')
    : null

  return (
    <div>
      <PageHeader
        title="Products"
        subtitle={
          list.isLoading
            ? 'Loading…'
            : `${total} ${total === 1 ? 'product' : 'products'} in catalog`
        }
        action={
          <Box sx={{ display: 'flex', gap: 1 }}>
            <Badge badgeContent={activeFilterCount} color="primary" overlap="rectangular">
              <Button
                variant="outlined"
                color="primary"
                startIcon={<FilterIcon className="w-4 h-4" />}
                onClick={() => setFilterOpen(true)}
                sx={{ textTransform: 'none', fontWeight: 600 }}
              >
                Filter
              </Button>
            </Badge>
            <Button
              variant="outlined"
              color="primary"
              startIcon={<Upload className="w-4 h-4" />}
              onClick={() => setImportOpen(true)}
              sx={{ textTransform: 'none', fontWeight: 600 }}
            >
              Import Products
            </Button>
            <Button
              variant="contained"
              color="primary"
              startIcon={<Plus className="w-4 h-4" />}
              onClick={() => setFormMode({ kind: 'create' })}
              sx={{ textTransform: 'none', fontWeight: 600 }}
              disabled={categories.length === 0 || categoriesQuery.isLoading}
            >
              Add Product
            </Button>
          </Box>
        }
      />

      {errorMessage && <Alert severity="error" sx={{ mb: 2 }}>{errorMessage}</Alert>}

      {!categoriesQuery.isLoading && categories.length === 0 && (
        <Box sx={{ mb: 2, p: 2, borderRadius: 2, bgcolor: '#FFF8DC', border: '1px solid #1F1F1F', fontSize: 14, color: '#1F1F1F' }}>
          No categories exist on the backend yet. Insert at least one category row before adding products.
        </Box>
      )}

      {activeFilterCount > 0 && (
        <Box sx={{ mb: 2, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1 }}>
          {filters.search && (
            <Chip
              label={`Search: "${filters.search}"`}
              size="small"
              onDelete={() => setFilters(f => ({ ...f, search: undefined }))}
            />
          )}
          {filters.categoryId != null && (
            <Chip
              label={`Category: ${categories.find(c => c.id === filters.categoryId)?.name ?? filters.categoryId}`}
              size="small"
              onDelete={() => setFilters(f => ({ ...f, categoryId: undefined }))}
            />
          )}
          <Button size="small" onClick={() => setFilters({})} sx={{ textTransform: 'none' }}>
            Clear all
          </Button>
        </Box>
      )}

      <Paper className="products-paper" sx={{ borderRadius: 2.5 }} elevation={0}>
        <DataGrid
          className="products-grid"
          rows={products}
          columns={columns}
          getRowId={r => r.id}
          loading={list.isLoading}
          autoHeight
          disableRowSelectionOnClick
          disableColumnMenu
          paginationMode="server"
          rowCount={total}
          paginationModel={paginationModel}
          onPaginationModelChange={setPaginationModel}
          pageSizeOptions={[10, 25, 50, 100]}
        />
      </Paper>

      <ProductFormDialog
        open={formMode.kind !== 'closed'}
        product={formMode.kind === 'edit' ? formMode.product : null}
        categories={categories}
        submitting={create.isPending || update.isPending}
        submitError={mutationErrorMessage(create.error) ?? mutationErrorMessage(update.error)}
        onClose={closeForm}
        onSave={handleSave}
      />

      <ConfirmDialog
        open={!!pendingDelete}
        title="Delete product"
        message={`Are you sure you want to delete "${pendingDelete?.name ?? ''}"? This will deactivate it.`}
        confirmLabel="Delete"
        onConfirm={handleConfirmDelete}
        onCancel={() => setPendingDelete(null)}
      />

      <ImportProductsDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
      />

      <FilterProductsDialog
        open={filterOpen}
        filters={filters}
        categories={categories}
        onClose={() => setFilterOpen(false)}
        onApply={(next) => { setFilters(next); setFilterOpen(false) }}
      />
    </div>
  )
}

function mutationErrorMessage(err: unknown): string | null {
  if (!err) return null
  if (err instanceof ValidationError) return err.flatten()
  if (err instanceof Error)           return err.message
  return 'Something went wrong.'
}

function ProductFormDialog({ open, product, categories, submitting, submitError, onClose, onSave }: {
  open: boolean
  product: ProductDto | null
  categories: CategoryDto[]
  submitting: boolean
  submitError: string | null
  onClose: () => void
  onSave: (values: FormValues) => Promise<void>
}) {
  const isEdit = !!product
  const [name, setName] = useState('')
  const [categoryId, setCategoryId] = useState<number | ''>('')
  const [type, setType] = useState('pack')
  const [weightValue, setWeightValue] = useState('')
  const [weightUnit, setWeightUnit] = useState<'g' | 'kg'>('g')
  const [mrp, setMrp] = useState('')
  const [purchasePrice, setPurchasePrice] = useState('')
  const [active, setActive] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setName(product?.name ?? '')
    setCategoryId(product?.categoryId ?? (categories[0]?.id ?? ''))
    setType(product?.type ?? 'pack')
    setWeightValue(product?.weightValue?.toString() ?? '')
    setWeightUnit((product?.weightUnit as 'g' | 'kg') ?? 'g')
    setMrp(product?.mrp?.toString() ?? '')
    setPurchasePrice(product?.purchasePrice?.toString() ?? '')
    setActive(product?.active ?? true)
    setErr(null)
  }, [open, product, categories])

  // Controlled-input filter for numeric fields:
  //   * onChange whitelist regex — only digits and one decimal point survive
  //   * caps decimal places (matches DB precision — 2 for prices, 3 for weight)
  //   * caps max value
  // Returns an onChange handler usable as { onChange={numericInput(...)} }
  const numericInput = (
    setter: (v: string) => void,
    opts: { max: number; decimals: number },
  ) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const raw = e.target.value
    if (raw === '') { setter(''); return }
    // Only digits and at most one decimal point. Rejects '-', '+', 'e', 'E', ',', etc.
    if (!/^[0-9]*\.?[0-9]*$/.test(raw)) return
    const parts = raw.split('.')
    if (parts[1] && parts[1].length > opts.decimals) return
    const num = parseFloat(raw)
    if (Number.isNaN(num)) {
      // Allow partial entries like "" or "." while user is typing.
      setter(raw)
      return
    }
    if (num < 0 || num > opts.max) return
    setter(raw)
  }

  // Block forbidden characters at the keyboard level so they never reach state.
  // type="number" inputs let you type 'e', '+', '-' even when min=0 is set.
  // MUI TextField's onKeyDown is typed against the wrapping <div>, not the input.
  const blockNonNumericKeys = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (['e', 'E', '+', '-', ','].includes(e.key)) e.preventDefault()
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim())                                   { setErr('Enter a product name'); return }
    if (typeof categoryId !== 'number')                 { setErr('Pick a category'); return }
    if (!type.trim())                                   { setErr('Enter a type'); return }
    const mrpNum = parseFloat(mrp)
    const ppNum  = parseFloat(purchasePrice)
    if (Number.isNaN(mrpNum) || mrpNum < 0)             { setErr('Enter a valid MRP'); return }
    if (Number.isNaN(ppNum)  || ppNum  < 0)             { setErr('Enter a valid Purchase Price'); return }
    if (weightValue.trim()) {
      const w = parseFloat(weightValue)
      if (Number.isNaN(w) || w <= 0)                    { setErr('Enter a valid net weight'); return }
    }
    setErr(null)

    try {
      await onSave({
        name: name.trim(),
        categoryId,
        type: type.trim(),
        weightValue,
        weightUnit,
        mrp: mrpNum.toString(),
        purchasePrice: ppNum.toString(),
        active,
      })
    } catch {
      // Surfaces via submitError prop
    }
  }

  return (
    <Dialog
      open={open}
      onClose={(_e, reason) => {
        if (reason === 'backdropClick' || submitting) return
        onClose()
      }}
      maxWidth="sm"
      fullWidth
      slotProps={{ paper: { sx: { borderRadius: 3 } } }}
    >
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontWeight: 600 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Package className="w-5 h-5" />
          {isEdit ? 'Edit Product' : 'Add Product'}
        </Box>
        <IconButton size="small" onClick={onClose} disabled={submitting}><X className="w-4 h-4" /></IconButton>
      </DialogTitle>
      <form onSubmit={handleSubmit}>
        <DialogContent dividers sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {isEdit && product && (
            <Box sx={{ display: 'flex', gap: 2, fontSize: 13, color: '#64748b' }}>
              <span><b>ID:</b> {product.id}</span>
              <span><b>Code:</b> {product.code}</span>
            </Box>
          )}
          <TextField label="Name" value={name} onChange={e => setName(e.target.value)} required size="small" disabled={submitting} />
          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
            <TextField select label="Category" value={categoryId} onChange={e => setCategoryId(Number(e.target.value))} size="small" required disabled={submitting}>
              {categories.map(c => (
                <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>
              ))}
            </TextField>
            <TextField select label="Type" value={type} onChange={e => setType(e.target.value)} required size="small" disabled={submitting}>
              <MenuItem value="pack">Pack</MenuItem>
              <MenuItem value="jar">Jar</MenuItem>
            </TextField>
          </Box>
          <Box sx={{ display: 'flex', gap: 1 }}>
            <TextField
              label="Net Weight"
              type="number"
              slotProps={{
                htmlInput: { step: 0.001, min: 0, max: 99999.999, inputMode: 'decimal' },
                inputLabel: { shrink: weightValue !== '' || undefined },
              }}
              value={weightValue}
              onChange={numericInput(setWeightValue, { max: 99999.999, decimals: 3 })}
              onKeyDown={blockNonNumericKeys}
              size="small"
              sx={{ flex: 2 }}
              placeholder="100"
              disabled={submitting}
            />
            <TextField
              select
              label="Unit"
              value={weightUnit}
              onChange={e => setWeightUnit(e.target.value as 'g' | 'kg')}
              size="small"
              sx={{ flex: 1, minWidth: 90 }}
              disabled={submitting}
            >
              <MenuItem value="g">g</MenuItem>
              <MenuItem value="kg">kg</MenuItem>
            </TextField>
          </Box>
          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
            <TextField
              label="MRP (₹)"
              type="number"
              slotProps={{
                htmlInput: { step: 0.01, min: 0, max: 99999999.99, inputMode: 'decimal' },
                inputLabel: { shrink: mrp !== '' || undefined },
              }}
              value={mrp}
              onChange={numericInput(setMrp, { max: 99999999.99, decimals: 2 })}
              onKeyDown={blockNonNumericKeys}
              required
              size="small"
              disabled={submitting}
            />
            <TextField
              label="Purchase Price (₹)"
              type="number"
              slotProps={{
                htmlInput: { step: 0.01, min: 0, max: 99999999.99, inputMode: 'decimal' },
                inputLabel: { shrink: purchasePrice !== '' || undefined },
              }}
              value={purchasePrice}
              onChange={numericInput(setPurchasePrice, { max: 99999999.99, decimals: 2 })}
              onKeyDown={blockNonNumericKeys}
              required
              size="small"
              disabled={submitting}
            />
          </Box>
          {/* Manual layout instead of FormControlLabel so only the checkbox itself toggles,
              not the label text or surrounding whitespace. */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Checkbox checked={active} onChange={e => setActive(e.target.checked)} disabled={submitting} sx={{ p: 0.5 }} />
            <Box component="span" sx={{ fontSize: 14, color: '#1F1F1F', userSelect: 'none' }}>Active</Box>
          </Box>
          {err && <Box sx={{ color: 'error.main', fontSize: 14 }}>{err}</Box>}
          {submitError && <Alert severity="error" sx={{ whiteSpace: 'pre-line' }}>{submitError}</Alert>}
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button onClick={onClose} variant="outlined" color="secondary" disabled={submitting} sx={{ textTransform: 'none', fontWeight: 500 }}>Cancel</Button>
          <Button type="submit" variant="contained" disabled={submitting} sx={{ textTransform: 'none', fontWeight: 600 }}>
            {submitting ? 'Saving…' : (isEdit ? 'Update' : 'Create')}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  )
}

function ImportProductsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [file, setFile] = useState<File | null>(null)
  const [result, setResult] = useState<ImportProductsResult | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const importMutation = useImportProducts()

  const submitting = importMutation.isPending
  const apiError = importMutation.error instanceof Error ? importMutation.error.message : null

  const handleClose = () => {
    if (submitting) return
    setFile(null)
    setResult(null)
    setFileError(null)
    importMutation.reset()
    if (inputRef.current) inputRef.current.value = ''
    onClose()
  }

  const handleFile = (f: File | null) => {
    setFileError(null)
    setResult(null)
    if (!f) { setFile(null); return }
    const ext = f.name.toLowerCase().split('.').pop() ?? ''
    if (ext !== 'xlsx' && ext !== 'csv') {
      setFileError('Only .xlsx and .csv files are supported.')
      setFile(null)
      return
    }
    setFile(f)
  }

  const handleSubmit = async () => {
    if (!file) return
    try {
      const res = await importMutation.mutateAsync(file)
      setResult(res)
    } catch {
      // Surface via apiError above.
    }
  }

  return (
    <Dialog
      open={open}
      onClose={(_e, reason) => {
        if (reason === 'backdropClick') return
        handleClose()
      }}
      maxWidth="sm"
      fullWidth
      slotProps={{ paper: { sx: { borderRadius: 3 } } }}
    >
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontWeight: 600 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Upload className="w-5 h-5" />
          Import Products
        </Box>
        <IconButton size="small" onClick={handleClose} disabled={submitting}><X className="w-4 h-4" /></IconButton>
      </DialogTitle>
      <DialogContent dividers sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {!result && (
          <>
            <Box sx={{ fontSize: 13, color: '#1F1F1F' }}>
              <p style={{ marginBottom: 8 }}>
                Upload a <b>.xlsx</b> or <b>.csv</b> file with the columns:
              </p>
              <Box component="code" sx={{ display: 'block', p: 1.5, bgcolor: '#FFF8DC', borderRadius: 1, border: '1px solid #1F1F1F', fontSize: 12 }}>
                name, category, type, weight_value, weight_unit, mrp, purchase_price, active
              </Box>
              <p style={{ marginTop: 8, color: '#1F1F1F99' }}>
                <b>category</b> must match an existing category name. Rows whose <b>name</b> already exists are skipped.
                If any row has a hard error, no products are imported.
              </p>
            </Box>

            <Button
              variant="outlined"
              component="label"
              startIcon={<Upload className="w-4 h-4" />}
              sx={{ textTransform: 'none', fontWeight: 600 }}
              disabled={submitting}
            >
              {file ? 'Change file' : 'Choose file'}
              <input
                ref={inputRef}
                type="file"
                accept=".xlsx,.csv"
                hidden
                onChange={e => handleFile(e.target.files?.[0] ?? null)}
              />
            </Button>
            {file && (
              <Box sx={{ fontSize: 13, color: '#1F1F1F' }}>
                Selected: <b>{file.name}</b> ({Math.ceil(file.size / 1024)} KB)
              </Box>
            )}
            {fileError && <Alert severity="error">{fileError}</Alert>}
            {apiError && <Alert severity="error">{apiError}</Alert>}
          </>
        )}

        {result && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {result.errors.length === 0 && result.imported > 0 && (
              <Alert severity="success">
                Imported <b>{result.imported}</b> of {result.totalRows} rows.
                {result.skipped.length > 0 && ` (${result.skipped.length} skipped — already existed.)`}
              </Alert>
            )}
            {result.errors.length === 0 && result.imported === 0 && (
              <Alert severity="info">
                No products imported. {result.skipped.length} of {result.totalRows} rows already existed.
              </Alert>
            )}
            {result.errors.length > 0 && (
              <Alert severity="error">
                Import failed — {result.errors.length} row{result.errors.length === 1 ? '' : 's'} had errors. Nothing was imported. Fix the file and try again.
              </Alert>
            )}

            {result.errors.length > 0 && (
              <Box>
                <Box sx={{ fontWeight: 600, mb: 1, fontSize: 13 }}>Errors:</Box>
                <Box sx={{ maxHeight: 200, overflow: 'auto', border: '1px solid #1F1F1F', borderRadius: 1, p: 1, bgcolor: '#FFF8F8' }}>
                  {result.errors.map(e => (
                    <Box key={e.rowNumber} sx={{ fontSize: 12, mb: 0.5, fontFamily: 'monospace' }}>
                      Row {e.rowNumber}: {e.message}
                    </Box>
                  ))}
                </Box>
              </Box>
            )}

            {result.skipped.length > 0 && (
              <Box>
                <Box sx={{ fontWeight: 600, mb: 1, fontSize: 13 }}>Skipped (name already exists):</Box>
                <Box sx={{ maxHeight: 160, overflow: 'auto', border: '1px solid #1F1F1F', borderRadius: 1, p: 1, bgcolor: '#FFF8DC' }}>
                  {result.skipped.map(s => (
                    <Box key={s.rowNumber} sx={{ fontSize: 12, mb: 0.5, fontFamily: 'monospace' }}>
                      Row {s.rowNumber}: {s.name}
                    </Box>
                  ))}
                </Box>
              </Box>
            )}
          </Box>
        )}
      </DialogContent>
      <DialogActions sx={{ p: 2 }}>
        {!result && (
          <>
            <Button onClick={handleClose} variant="outlined" color="secondary" disabled={submitting} sx={{ textTransform: 'none', fontWeight: 500 }}>Cancel</Button>
            <Button onClick={handleSubmit} variant="contained" disabled={!file || submitting} sx={{ textTransform: 'none', fontWeight: 600 }}>
              {submitting ? 'Importing…' : 'Import'}
            </Button>
          </>
        )}
        {result && (
          <Button onClick={handleClose} variant="contained" sx={{ textTransform: 'none', fontWeight: 600 }}>Close</Button>
        )}
      </DialogActions>
    </Dialog>
  )
}

function FilterProductsDialog({ open, filters, categories, onClose, onApply }: {
  open: boolean
  filters: ProductListFilters
  categories: CategoryDto[]
  onClose: () => void
  onApply: (filters: ProductListFilters) => void
}) {
  const [search, setSearch] = useState('')
  const [categoryId, setCategoryId] = useState<number | ''>('')

  useEffect(() => {
    if (!open) return
    setSearch(filters.search ?? '')
    setCategoryId(filters.categoryId ?? '')
  }, [open, filters])

  const handleApply = (e: React.FormEvent) => {
    e.preventDefault()
    onApply({
      search: search.trim() || undefined,
      categoryId: typeof categoryId === 'number' ? categoryId : undefined,
    })
  }

  const handleClear = () => {
    setSearch('')
    setCategoryId('')
    onApply({})
  }

  return (
    <Dialog
      open={open}
      onClose={(_e, reason) => {
        if (reason === 'backdropClick') return
        onClose()
      }}
      maxWidth="xs"
      fullWidth
      slotProps={{ paper: { sx: { borderRadius: 3 } } }}
    >
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontWeight: 600 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <FilterIcon className="w-5 h-5" />
          Filter Products
        </Box>
        <IconButton size="small" onClick={onClose}><X className="w-4 h-4" /></IconButton>
      </DialogTitle>
      <form onSubmit={handleApply}>
        <DialogContent dividers sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <TextField
            label="Search by name or code"
            value={search}
            onChange={e => setSearch(e.target.value)}
            size="small"
            placeholder="e.g. Murukku or P001"
            autoFocus
          />
          <TextField
            select
            label="Category"
            value={categoryId}
            onChange={e => setCategoryId(e.target.value === '' ? '' : Number(e.target.value))}
            size="small"
          >
            <MenuItem value="">All categories</MenuItem>
            {categories.map(c => (
              <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>
            ))}
          </TextField>
        </DialogContent>
        <DialogActions sx={{ p: 2, justifyContent: 'space-between' }}>
          <Button onClick={handleClear} sx={{ textTransform: 'none', fontWeight: 500 }}>Clear all</Button>
          <Box sx={{ display: 'flex', gap: 1 }}>
            <Button onClick={onClose} variant="outlined" color="secondary" sx={{ textTransform: 'none', fontWeight: 500 }}>Cancel</Button>
            <Button type="submit" variant="contained" sx={{ textTransform: 'none', fontWeight: 600 }}>Apply</Button>
          </Box>
        </DialogActions>
      </form>
    </Dialog>
  )
}
