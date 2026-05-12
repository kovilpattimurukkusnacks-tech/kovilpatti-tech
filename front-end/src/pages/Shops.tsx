import { useEffect, useMemo, useState } from 'react'
import { Plus, Edit2, Trash2, X, Store } from 'lucide-react'
import {
  Alert, Box, Button, Checkbox, Chip, Dialog, DialogActions, DialogContent, DialogTitle,
  IconButton, MenuItem, Paper, TextField,
} from '@mui/material'
import { DataGrid, type GridColDef } from '@mui/x-data-grid'
import PageHeader from '../components/PageHeader'
import ConfirmDialog from '../components/ConfirmDialog'
import { useShopsPaged, useCreateShop, useUpdateShop, useDeleteShop } from '../hooks/useShops'
import { useInventories } from '../hooks/useInventories'
import type {
  ShopDto, CreateShopRequest, UpdateShopRequest,
} from '../api/shops/types'
import type { InventoryDto } from '../api/inventories/types'
import { ValidationError } from '../api/errors'

type FormMode =
  | { kind: 'closed' }
  | { kind: 'create' }
  | { kind: 'edit'; shop: ShopDto }

type FormValues = {
  name: string
  address: string
  contactPhone1: string
  contactPhone2: string
  gstin: string
  inventoryId: string
  active: boolean
}

export default function Shops() {
  const [paginationModel, setPaginationModel] = useState({ page: 0, pageSize: 10 })
  const list = useShopsPaged(paginationModel.page + 1, paginationModel.pageSize)
  const inventories = useInventories()
  const create = useCreateShop()
  const update = useUpdateShop()
  const remove = useDeleteShop()

  const [formMode, setFormMode] = useState<FormMode>({ kind: 'closed' })
  const [pendingDelete, setPendingDelete] = useState<ShopDto | null>(null)

  const shops         = list.data?.items ?? []
  const total         = list.data?.total ?? 0
  const inventoryList = inventories.data ?? []

  const closeForm = () => setFormMode({ kind: 'closed' })

  const handleSave = async (values: FormValues) => {
    const common = {
      name: values.name,
      address: values.address,
      contactPhone1: values.contactPhone1,
      contactPhone2: values.contactPhone2 || undefined,
      gstin: values.gstin || undefined,
      inventoryId: values.inventoryId,
    }

    if (formMode.kind === 'edit') {
      const req: UpdateShopRequest = { ...common, active: values.active }
      await update.mutateAsync({ id: formMode.shop.id, req })
    } else if (formMode.kind === 'create') {
      const req: CreateShopRequest = { ...common, active: values.active }
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

  const columns = useMemo<GridColDef<ShopDto>[]>(() => [
    { field: 'code',           headerName: 'Code',     width: 110, sortable: false, filterable: false },
    { field: 'name',           headerName: 'Shop Name', flex: 1.4, minWidth: 180, sortable: false, filterable: false },
    { field: 'address',        headerName: 'Address',  flex: 1.8, minWidth: 220, sortable: false, filterable: false },
    { field: 'contactPhone1',  headerName: 'Phone 1',  width: 160, sortable: false, filterable: false },
    {
      field: 'contactPhone2',  headerName: 'Phone 2',  width: 160, sortable: false, filterable: false,
      renderCell: ({ value }) => value || <span className="text-[#1F1F1F]/40">—</span>,
    },
    {
      field: 'gstin',          headerName: 'GSTIN',    width: 170, sortable: false, filterable: false,
      renderCell: ({ value }) => value || <span className="text-[#1F1F1F]/40">—</span>,
    },
    {
      field: 'inventoryName', headerName: 'Inventory', width: 200, sortable: false, filterable: false,
      renderCell: ({ value }) => value || <span className="text-[#1F1F1F]/40">—</span>,
    },
    {
      field: 'active', headerName: 'Status', width: 110, sortable: false, filterable: false,
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
          <IconButton size="small" onClick={() => setFormMode({ kind: 'edit', shop: row })}>
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
    ? (list.error instanceof Error ? list.error.message : 'Failed to load shops.')
    : null

  return (
    <div>
      <PageHeader
        title="Shops"
        subtitle={
          list.isLoading
            ? 'Loading…'
            : `${total} ${total === 1 ? 'shop' : 'shops'} configured`
        }
        action={
          <Button
            variant="contained"
            color="primary"
            startIcon={<Plus className="w-4 h-4" />}
            onClick={() => setFormMode({ kind: 'create' })}
            sx={{ textTransform: 'none', fontWeight: 600 }}
            disabled={inventoryList.length === 0 || inventories.isLoading}
          >
            Add Shop
          </Button>
        }
      />

      {errorMessage && <Alert severity="error" sx={{ mb: 2 }}>{errorMessage}</Alert>}

      {!inventories.isLoading && inventoryList.length === 0 && (
        <Box sx={{ mb: 2, p: 2, borderRadius: 2, bgcolor: '#FFF8DC', border: '1px solid #1F1F1F', fontSize: 14, color: '#1F1F1F' }}>
          You need to create at least one <b>Inventory</b> before adding a shop. Use the Create Account → Inventory menu.
        </Box>
      )}

      <Paper className="data-page-paper" sx={{ borderRadius: 2.5 }} elevation={0}>
        <DataGrid
          className="data-page-grid"
          rows={shops}
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

      <ShopFormDialog
        open={formMode.kind !== 'closed'}
        shop={formMode.kind === 'edit' ? formMode.shop : null}
        inventories={inventoryList}
        submitting={create.isPending || update.isPending}
        submitError={mutationErrorMessage(create.error) ?? mutationErrorMessage(update.error)}
        onClose={closeForm}
        onSave={handleSave}
      />

      <ConfirmDialog
        open={!!pendingDelete}
        title="Delete shop"
        message={`Are you sure you want to delete "${pendingDelete?.name ?? ''}"? This will deactivate it.`}
        confirmLabel="Delete"
        onConfirm={handleConfirmDelete}
        onCancel={() => setPendingDelete(null)}
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

function ShopFormDialog({ open, shop, inventories, submitting, submitError, onClose, onSave }: {
  open: boolean
  shop: ShopDto | null
  inventories: InventoryDto[]
  submitting: boolean
  submitError: string | null
  onClose: () => void
  onSave: (values: FormValues) => Promise<void>
}) {
  const isEdit = !!shop
  const [name, setName] = useState('')
  const [address, setAddress] = useState('')
  const [contactPhone1, setContactPhone1] = useState('')
  const [contactPhone2, setContactPhone2] = useState('')
  const [gstin, setGstin] = useState('')
  const [inventoryId, setInventoryId] = useState('')
  const [active, setActive] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setName(shop?.name ?? '')
    setAddress(shop?.address ?? '')
    // Strip '+91' / non-digits — keep just the 10 local digits for the input.
    setContactPhone1((shop?.contactPhone1 ?? '').replace(/\D/g, '').slice(-10))
    setContactPhone2((shop?.contactPhone2 ?? '').replace(/\D/g, '').slice(-10))
    setGstin(shop?.gstin ?? '')
    setInventoryId(shop?.inventoryId ?? (inventories[0]?.id ?? ''))
    setActive(shop?.active ?? true)
    setErr(null)
  }, [open, shop, inventories])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim())                { setErr('Enter a shop name'); return }
    if (!address.trim())             { setErr('Enter the address'); return }
    if (contactPhone1.length !== 10) { setErr('Contact Number 1 must be exactly 10 digits'); return }
    if (contactPhone2 && contactPhone2.length !== 10) {
      setErr('Contact Number 2 must be exactly 10 digits when provided'); return
    }
    if (!inventoryId)                { setErr('Pick an inventory'); return }
    const trimmedGstin = gstin.trim()
    if (trimmedGstin && trimmedGstin.length !== 15) {
      setErr('GSTIN must be exactly 15 characters when provided'); return
    }
    setErr(null)

    try {
      await onSave({
        name: name.trim(),
        address: address.trim(),
        // Prepend +91 prefix on save so the table display stays consistent across rows.
        contactPhone1: `+91 ${contactPhone1}`,
        contactPhone2: contactPhone2 ? `+91 ${contactPhone2}` : '',
        gstin: trimmedGstin ? trimmedGstin.toUpperCase() : '',
        inventoryId,
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
          <Store className="w-5 h-5" />
          {isEdit ? 'Edit Shop' : 'Add Shop'}
        </Box>
        <IconButton size="small" onClick={onClose} disabled={submitting}><X className="w-4 h-4" /></IconButton>
      </DialogTitle>
      <form onSubmit={handleSubmit}>
        <DialogContent dividers sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {isEdit && shop && (
            <Box sx={{ display: 'flex', gap: 2, fontSize: 13, color: '#64748b' }}>
              <span><b>ID:</b> {shop.id}</span>
              <span><b>Code:</b> {shop.code}</span>
            </Box>
          )}
          <TextField label="Shop Name" value={name} onChange={e => setName(e.target.value)} required size="small" disabled={submitting} />
          <TextField label="Shop Address" value={address} onChange={e => setAddress(e.target.value)} required size="small" multiline minRows={2} disabled={submitting} />
          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
            <TextField
              label="Contact Number 1"
              value={contactPhone1}
              onChange={e => setContactPhone1(e.target.value.replace(/\D/g, '').slice(0, 10))}
              onKeyDown={e => { if (['e', 'E', '+', '-', '.', ','].includes(e.key)) e.preventDefault() }}
              required
              size="small"
              placeholder="10-digit number"
              slotProps={{ htmlInput: { maxLength: 10, inputMode: 'numeric' } }}
              disabled={submitting}
            />
            <TextField
              label="Contact Number 2"
              value={contactPhone2}
              onChange={e => setContactPhone2(e.target.value.replace(/\D/g, '').slice(0, 10))}
              onKeyDown={e => { if (['e', 'E', '+', '-', '.', ','].includes(e.key)) e.preventDefault() }}
              size="small"
              placeholder="(optional, 10-digit)"
              slotProps={{ htmlInput: { maxLength: 10, inputMode: 'numeric' } }}
              disabled={submitting}
            />
          </Box>
          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
            <TextField label="GSTIN" value={gstin} onChange={e => setGstin(e.target.value.toUpperCase())} size="small" placeholder="(15 chars, optional)" slotProps={{ htmlInput: { maxLength: 15 } }} disabled={submitting} />
            <TextField select label="Inventory" value={inventoryId} onChange={e => setInventoryId(e.target.value)} required size="small" disabled={submitting}>
              {inventories.map(inv => (
                <MenuItem key={inv.id} value={inv.id}>{inv.code} — {inv.name}</MenuItem>
              ))}
            </TextField>
          </Box>
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
