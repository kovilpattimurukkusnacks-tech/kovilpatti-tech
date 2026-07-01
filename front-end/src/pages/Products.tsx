import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Edit2, Trash2, X, Package, Upload, Tag, CornerDownRight, Search } from 'lucide-react'
import {
  Alert, Box, Button, Checkbox, Chip, Dialog, DialogActions, DialogContent, DialogTitle,
  IconButton, InputAdornment, MenuItem, Paper, TextField,
} from '@mui/material'
import { DataGrid, type GridColDef } from '@mui/x-data-grid'
import PageHeader from '../components/PageHeader'
import ConfirmDialog from '../components/ConfirmDialog'
import { useProducts, useCreateProduct, useUpdateProduct, useDeleteProduct, useImportProducts } from '../hooks/useProducts'
import { useCategories } from '../hooks/useCategories'
import { useGstEnabled } from '../hooks/useSettings'
import type {
  ProductDto, CreateProductRequest, UpdateProductRequest, ImportProductsResult, ProductListFilters,
} from '../api/products/types'
import type { CategoryDto } from '../api/categories/types'
import { ValidationError } from '../api/errors'
import { formatINR } from '../utils/format'
import { useDebouncedValue } from '../hooks/useDebouncedValue'
import { CategoryTreeFilter } from '../components/CategoryTreeFilter'
import { buildRootLookup, rootPriorityIndex } from '../utils/rootCategoryPriority'
import './Products.css'

type FormMode =
  | { kind: 'closed' }
  | { kind: 'create' }
  | { kind: 'edit'; product: ProductDto }

type FormValues = {
  code: string         // blank → BE keeps existing on edit, auto-generates on create
  name: string
  categoryId: number
  type: string
  weightValue: string  // raw input, parsed on submit
  weightUnit: 'g' | 'kg' | 'pcs' | 'pkt'
  mrp: string
  purchasePrice: string
  active: boolean
  /** GST percent (0..100), raw input. Only surfaced when the global
   *  `gst_enabled` app-setting is true (19-Jun-2026, client #15).
   *  Empty string → send null to BE (preserves the existing strategy). */
  gst: string
}

export default function Products() {
  const navigate = useNavigate()
  const [filters, setFilters] = useState<ProductListFilters>({})
  // DataGrid uses 0-indexed pages; BE uses 1-indexed. Convert on the wire.
  const [paginationModel, setPaginationModel] = useState({ page: 0, pageSize: 10 })

  // 01-Jul-2026: fetch all matching products in one shot so we can sort
  // by the hard-coded root-category priority (client req). DataGrid then
  // handles pagination client-side. At the current catalog size (~300)
  // this is well within budget; re-visit if the catalog grows past ~2000.
  const list = useProducts({
    ...filters,
    page: 1,
    pageSize: 500,
  })
  const categoriesQuery = useCategories()
  const create = useCreateProduct()
  const update = useUpdateProduct()
  const remove = useDeleteProduct()

  const [formMode, setFormMode] = useState<FormMode>({ kind: 'closed' })
  const [pendingDelete, setPendingDelete] = useState<ProductDto | null>(null)
  const [importOpen, setImportOpen] = useState(false)

  // Inline search (01-Jul-2026 client req): the old Filter button opened
  // a dialog which felt slow to the admin. Now a plain search box sits in
  // the header; typing 300ms → BE query. Category filter dropped as part
  // of the same cleanup — admin can eyeball category via the grid column.
  const [searchInput, setSearchInput] = useState('')
  const debouncedSearch = useDebouncedValue(searchInput, 300)
  useEffect(() => {
    setFilters(prev => ({ ...prev, search: debouncedSearch.trim() || undefined }))
    setPaginationModel(m => ({ ...m, page: 0 }))
  }, [debouncedSearch])

  const rawProducts = list.data?.items ?? []
  const total       = list.data?.total ?? 0
  const categories  = categoriesQuery.data ?? []

  // Sort products by root-category priority (1kg Snacks → Packing Items
  // → … → Shop Needs), then by leaf-category name, then by code within
  // a leaf. Client-side sort — the BE list SP returns in code order,
  // but the admin wants the same top-level hierarchy the shop / godown
  // sees on every other screen (01-Jul-2026).
  const products = useMemo(() => {
    if (rawProducts.length === 0) return rawProducts
    const lookup = buildRootLookup(categories)
    // Cache root-name + priority per product so we don't re-resolve on
    // every comparator call (N log N calls otherwise).
    const decorated = rawProducts.map(p => {
      const root = lookup(p.categoryName)
      return { p, root, priority: rootPriorityIndex(root) }
    })
    decorated.sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority
      if (a.root !== b.root)         return a.root.localeCompare(b.root)
      if (a.p.categoryName !== b.p.categoryName) {
        return a.p.categoryName.localeCompare(b.p.categoryName)
      }
      return a.p.code.localeCompare(b.p.code)
    })
    return decorated.map(d => d.p)
  }, [rawProducts, categories])

  // Whenever filters change, jump back to page 0 so the user lands on the
  // first page of the newly-filtered result set instead of an empty page N.
  useEffect(() => {
    setPaginationModel(prev => ({ ...prev, page: 0 }))
  }, [filters.search, filters.categoryIds])

  const closeForm = () => setFormMode({ kind: 'closed' })

  const handleSave = async (values: FormValues) => {
    const weightValue = values.weightValue.trim() ? Number(values.weightValue) : null
    // Blank code → omit the field entirely so the BE branch fires cleanly
    // (create: auto-generate; edit: keep existing). Sending `undefined`
    // through JSON would serialize the key and confuse the validator.
    const trimmedCode = values.code.trim()
    const code = trimmedCode ? { code: trimmedCode } : {}
    // GST: empty input → null (clears the value); non-empty → number.
    // The BE preserves the existing GST when the global gst_enabled is
    // OFF (FE never collects + never sends the field in that mode), so
    // disabling the master switch doesn't wipe historical GST data.
    const trimmedGst = values.gst.trim()
    const gstField = trimmedGst === ''
      ? {}                                          // omit when blank
      : { gst: Number(trimmedGst) }
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
      const req: UpdateProductRequest = { ...code, ...common, ...gstField, active: values.active }
      await update.mutateAsync({ id: formMode.product.id, req })
    } else if (formMode.kind === 'create') {
      const req: CreateProductRequest = { ...code, ...common, ...gstField, active: values.active }
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

  // buildRootLookup memoised over categories → passed into the Category
  // column's renderCell so each row shows the leaf chip + its root
  // category as a small muted line beneath (client req 01-Jul-2026).
  const rootLookup = useMemo(() => buildRootLookup(categories), [categories])

  const columns = useMemo<GridColDef<ProductDto>[]>(() => [
    { field: 'code',         headerName: 'Code',         width: 100, sortable: false, filterable: false },
    { field: 'name',         headerName: 'Product Name', flex: 1.5,  minWidth: 200, sortable: false, filterable: false },
    {
      field: 'categoryName', headerName: 'Category',     width: 240, sortable: false, filterable: false,
      renderCell: ({ value, row }) => {
        const root = rootLookup(row.categoryName)
        const showRoot = root && root !== row.categoryName
        // Single-line breadcrumb chip: "1 KG Snacks › Chips 300". Root
        // part rendered in a muted colour inside the label so admin
        // scans both levels without the extra row height a stacked
        // layout needed. 01-Jul-2026.
        const label = showRoot ? (
          <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
            <Box component="span" sx={{ color: '#1F1F1F99', fontWeight: 600 }}>{root}</Box>
            <Box component="span" sx={{ color: '#1F1F1F55' }}>›</Box>
            <Box component="span" sx={{ color: '#1F1F1F', fontWeight: 700 }}>{value}</Box>
          </Box>
        ) : value
        return <Chip label={label} size="small" variant="outlined" />
      },
    },
    { field: 'type',         headerName: 'Type',         width: 100, sortable: false, filterable: false },
    {
      field: 'weight',       headerName: 'Net Weight',   width: 130, sortable: false, filterable: false,
      valueGetter: (_v, row) =>
        row.weightValue != null ? `${row.weightValue} ${row.weightUnit ?? ''}`.trim() : '—',
    },
    {
      field: 'mrp',          headerName: 'MRP',          width: 110, sortable: false, filterable: false,
      renderCell: ({ value }) => <span>{formatINR(Number(value))}</span>,
    },
    {
      field: 'purchasePrice', headerName: 'Purchase Price', width: 130, sortable: false, filterable: false,
      renderCell: ({ value }) =>
        value == null ? <span className="text-[#1F1F1F]/40">—</span> : <span>{formatINR(Number(value))}</span>,
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
  ], [rootLookup])

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
          <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
            <Button
              variant="outlined"
              color="primary"
              startIcon={<Tag className="w-4 h-4" />}
              onClick={() => navigate('/admin/categories')}
              sx={{ textTransform: 'none', fontWeight: 600 }}
            >
              Manage Categories
            </Button>
            <Button
              variant="outlined"
              color="primary"
              startIcon={<Upload className="w-4 h-4" />}
              onClick={() => setImportOpen(true)}
              // Mirror the Add Product gate — import would 400 anyway when no
              // categories exist, since every row's category column has to
              // resolve. Disabling the button surfaces that prerequisite
              // before the dialog even opens.
              disabled={categories.length === 0 || categoriesQuery.isLoading}
              title={categories.length === 0 ? 'Add at least one category before importing products' : undefined}
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
        <Box sx={{ mb: 2, p: 2, borderRadius: 2, bgcolor: '#FFF8DC', border: '1px solid #1F1F1F', fontSize: 14, color: '#1F1F1F', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2 }}>
          <span>No categories yet. Add at least one before creating products.</span>
          <Button
            size="small"
            variant="contained"
            startIcon={<Tag className="w-4 h-4" />}
            onClick={() => navigate('/admin/categories')}
            sx={{ textTransform: 'none', fontWeight: 600 }}
          >
            Manage Categories
          </Button>
        </Box>
      )}

      {/* Filter strip — sits above the grid (01-Jul-2026). Search + a
          multi-select Categories filter. Both changes fire immediately
          and reset the grid to page 0 (via the searchInput useEffect
          above, and inline for the category change). */}
      <Paper
        elevation={0}
        sx={{
          borderRadius: 2.5,
          border: '2px solid #1F1F1F',
          bgcolor: '#FFFBE6',
          px: 2,
          py: 1.5,
          mb: 2,
          display: 'flex',
          gap: 1.5,
          alignItems: 'center',
          flexWrap: 'wrap',
        }}
      >
        <TextField
          size="small"
          value={searchInput}
          onChange={e => setSearchInput(e.target.value)}
          placeholder="Search by name or code"
          sx={{ minWidth: 260, flex: 1, maxWidth: 360, '& .MuiOutlinedInput-root': { bgcolor: '#FFFBE6' } }}
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <Search className="w-4 h-4 text-[#1F1F1F]/70" />
                </InputAdornment>
              ),
              endAdornment: searchInput ? (
                <InputAdornment position="end">
                  <IconButton size="small" onClick={() => setSearchInput('')} aria-label="Clear search">
                    <X className="w-3.5 h-3.5" />
                  </IconButton>
                </InputAdornment>
              ) : undefined,
            },
          }}
        />
        <CategoryTreeFilter
          categories={categories}
          value={filters.categoryIds ?? []}
          onChange={(ids) => {
            setFilters(prev => ({ ...prev, categoryIds: ids.length ? ids : undefined }))
            setPaginationModel(m => ({ ...m, page: 0 }))
          }}
        />
      </Paper>

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
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [categoryId, setCategoryId] = useState<number | ''>('')
  const [type, setType] = useState('pack')
  const [weightValue, setWeightValue] = useState('')
  const [weightUnit, setWeightUnit] = useState<'g' | 'kg' | 'pcs' | 'pkt'>('g')
  const [mrp, setMrp] = useState('')
  const [purchasePrice, setPurchasePrice] = useState('')
  const [active, setActive] = useState(true)
  // GST percent — only rendered + collected when the global gst_enabled
  // app-setting is true (19-Jun-2026, client #15). Stored values are
  // preserved across toggles: when global GST is OFF the input isn't
  // shown, the field isn't sent on save, and the BE keeps the existing
  // gst value silently.
  const [gst, setGst] = useState('')
  const gstEnabled = useGstEnabled().enabled

  // Direct child count per category — used by the dropdown to show a chip
  // next to parent rows, mirroring the Manage Categories table. Built once
  // per `categories` change, not on every render.
  const childCountByParent = useMemo(() => {
    const map = new Map<number, number>()
    for (const c of categories) {
      if (c.parentId == null) continue
      map.set(c.parentId, (map.get(c.parentId) ?? 0) + 1)
    }
    return map
  }, [categories])
  const [err, setErr] = useState<string | null>(null)
  // MUI Dialog's focus trap auto-focuses the first tabbable child on open,
  // which is the close-X in the title bar — not the Name field. We grab the
  // input ref + .focus() it after the dialog has finished transitioning so
  // the cursor lands in Name as soon as the dialog appears.
  const nameRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    // On Edit, prefill with the current code so the admin sees what's there
    // and can change it. On Create, leave blank — BE auto-generates if so.
    setCode(product?.code ?? '')
    setName(product?.name ?? '')
    setCategoryId(product?.categoryId ?? (categories[0]?.id ?? ''))
    setType(product?.type ?? 'pack')
    setWeightValue(product?.weightValue?.toString() ?? '')
    setWeightUnit((product?.weightUnit as 'g' | 'kg' | 'pcs' | 'pkt') ?? 'g')
    setMrp(product?.mrp?.toString() ?? '')
    setPurchasePrice(product?.purchasePrice?.toString() ?? '')
    setActive(product?.active ?? true)
    // Prefill GST if the product already has one (even if global is now OFF —
    // value persists silently so admin can toggle back without re-entering).
    setGst(product?.gst != null ? String(product.gst) : '')
    setErr(null)
    // 50 ms gives the Dialog's transition + focus trap time to finish,
    // so our .focus() wins the final placement.
    const t = setTimeout(() => nameRef.current?.focus(), 50)
    return () => clearTimeout(t)
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
        code: code.trim(),
        name: name.trim(),
        categoryId,
        type: type.trim(),
        weightValue,
        weightUnit,
        mrp: mrpNum.toString(),
        purchasePrice: ppNum.toString(),
        active,
        // Only send GST when the global master is ON. When OFF, the dialog
        // doesn't render the input and we omit the field entirely → BE
        // preserves whatever was already stored on the product.
        gst: gstEnabled ? gst.trim() : '',
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
          {/* Row 1 — Name + Code paired.
              Name leads the form (primary identifier) and carries the
              autofocus ref. Code (07-Jun-2026, client #10) is editable in
              both modes: blank on Create → BE auto-generates (P001…); blank
              on Edit → BE keeps the existing code. No length cap (DB column
              is `text`, validator unbounded). */}
          <Box sx={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 2 }}>
            <TextField label="Name" value={name} onChange={e => setName(e.target.value)} required size="small" disabled={submitting} inputRef={nameRef} />
            <TextField
              label="Code"
              value={code}
              onChange={e => setCode(e.target.value)}
              size="small"
              disabled={submitting}
              helperText={isEdit ? 'Blank = keep current' : 'Blank = auto-generate (P001…)'}
            />
          </Box>

          {/* Row 2 — Category, full width.
              Nested taxonomy (client #1) — the breadcrumb path can be long
              (e.g. "Biscuits > Big Biscuit > Britannia"), so it owns the
              whole row to stay readable. Closed Select renders the full
              path via renderValue; dropdown items render tree-style with
              a CornerDownRight glyph + depth-scaled indent + child-count
              chip, mirroring the Manage Categories tree UI. */}
          <TextField
            select
            label="Category"
            value={categoryId}
            onChange={e => setCategoryId(Number(e.target.value))}
            size="small"
            required
            disabled={submitting}
            fullWidth
            slotProps={{
              select: {
                renderValue: (value) => {
                  const sel = categories.find(c => c.id === value)
                  return sel ? (sel.path ?? sel.name) : ''
                },
              },
            }}
          >
            {categories.map(c => {
              const childCount = childCountByParent.get(c.id) ?? 0
              return (
                <MenuItem key={c.id} value={c.id} sx={{ pl: 2 + c.depth * 2 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                    {c.depth > 0 && (
                      <CornerDownRight
                        className="w-3.5 h-3.5"
                        style={{ color: 'rgba(31,31,31,0.55)', flexShrink: 0 }}
                      />
                    )}
                    <span>{c.name}</span>
                    {childCount > 0 && (
                      <Chip
                        label={childCount}
                        size="small"
                        variant="outlined"
                        sx={{ ml: 0.5, height: 18, fontSize: 10, fontWeight: 700, color: '#1F1F1F99', borderColor: 'rgba(31,31,31,0.2)' }}
                      />
                    )}
                  </Box>
                </MenuItem>
              )
            })}
          </TextField>

          {/* Row 3 — Type + Net Weight + Unit on one row.
              Type and Unit are short selects; Weight gets the widest cell. */}
          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1.2fr 0.7fr', gap: 2 }}>
            <TextField select label="Type" value={type} onChange={e => setType(e.target.value)} required size="small" disabled={submitting}>
              <MenuItem value="pack">Pack</MenuItem>
              <MenuItem value="jar">Jar</MenuItem>
            </TextField>
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
              placeholder="100"
              disabled={submitting}
            />
            <TextField
              select
              label="Unit"
              value={weightUnit}
              onChange={e => setWeightUnit(e.target.value as 'g' | 'kg' | 'pcs' | 'pkt')}
              size="small"
              disabled={submitting}
            >
              <MenuItem value="g">g</MenuItem>
              <MenuItem value="kg">kg</MenuItem>
              <MenuItem value="pcs">pcs</MenuItem>
              <MenuItem value="pkt">pkt</MenuItem>
            </TextField>
          </Box>

          {/* Row 4 — MRP + Purchase Price (equal-width pair). */}
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

          {/* GST row — only renders when the global GST master switch is ON
              (19-Jun-2026, client #15). Hiding the input also stops it from
              being sent on save (handleSubmit conditional), so stored GST
              values are preserved when admin disables the master and
              re-enables later. */}
          {gstEnabled && (
            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
              <TextField
                label="GST (%)"
                type="number"
                slotProps={{
                  htmlInput: { step: 0.01, min: 0, max: 100, inputMode: 'decimal' },
                  inputLabel: { shrink: gst !== '' || undefined },
                }}
                value={gst}
                onChange={numericInput(setGst, { max: 100, decimals: 2 })}
                onKeyDown={blockNonNumericKeys}
                size="small"
                disabled={submitting}
                helperText="0–100. Leave blank to clear."
                placeholder="5"
              />
            </Box>
          )}

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
          <Button onClick={onClose} variant="outlined" disabled={submitting} sx={{ textTransform: 'none', fontWeight: 600, borderColor: '#1F1F1F', color: '#1F1F1F', '&:hover': { borderColor: '#1F1F1F', bgcolor: '#FCD835' } }}>Cancel</Button>
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
  // BE returns ValidationException as { error: "Validation failed", errors: { file: [msg] } }.
  // `.message` is just the generic "Validation failed" header — we want the
  // actual field messages from `.flatten()` so the user sees something
  // actionable like "No categories exist yet. Create one first…"
  const apiError =
    importMutation.error instanceof ValidationError ? importMutation.error.flatten()
    : importMutation.error instanceof Error          ? importMutation.error.message
    : null

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
                name, category, type, weight_value, weight_unit, mrp, purchase_price, active, code
              </Box>
              <p style={{ marginTop: 8, color: '#1F1F1F99' }}>
                <b>category</b> must match an existing category name. Rows where the same
                <b> name + type + weight + category</b> already exists are skipped — different sizes/variants are kept.
                <b> code</b> is optional — leave the cell blank to auto-generate (P001…); fill it in to set
                your own value. Codes must be unique across the catalog and within the file.
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
                <Box sx={{ fontWeight: 600, mb: 1, fontSize: 13 }}>Skipped (same name + type + weight + category already exists):</Box>
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
            <Button onClick={handleClose} variant="outlined" disabled={submitting} sx={{ textTransform: 'none', fontWeight: 600, borderColor: '#1F1F1F', color: '#1F1F1F', '&:hover': { borderColor: '#1F1F1F', bgcolor: '#FCD835' } }}>Cancel</Button>
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

// FilterProductsDialog removed 01-Jul-2026 (client req — the dialog felt
// slow; the header now has an inline debounced search box that filters
// live). Category filter dropped too — admin can eyeball category via
// the grid column.
