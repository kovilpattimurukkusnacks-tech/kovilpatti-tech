import { useEffect, useMemo, useState } from 'react'
import { Plus, Edit2, Trash2, X, Warehouse } from 'lucide-react'
import {
  Alert, Box, Button, Checkbox, Chip, Dialog, DialogActions, DialogContent, DialogTitle,
  FormControlLabel, IconButton, Paper, TextField,
} from '@mui/material'
import { DataGrid, type GridColDef } from '@mui/x-data-grid'
import PageHeader from '../components/PageHeader'
import ConfirmDialog from '../components/ConfirmDialog'
import {
  useInventories, useCreateInventory, useUpdateInventory, useDeleteInventory,
} from '../hooks/useInventories'
import type {
  InventoryDto, CreateInventoryRequest, UpdateInventoryRequest,
} from '../api/inventories/types'
import { ValidationError } from '../api/errors'

type FormMode =
  | { kind: 'closed' }
  | { kind: 'create' }
  | { kind: 'edit'; inventory: InventoryDto }

type FormValues = {
  name: string
  address: string
  contactPhone: string
  contactPersonName: string
  active: boolean
}

export default function Inventories() {
  const list = useInventories()
  const create = useCreateInventory()
  const update = useUpdateInventory()
  const remove = useDeleteInventory()

  const [formMode, setFormMode] = useState<FormMode>({ kind: 'closed' })
  const [pendingDelete, setPendingDelete] = useState<InventoryDto | null>(null)

  const inventories = list.data ?? []

  const closeForm = () => setFormMode({ kind: 'closed' })

  const handleSave = async (values: FormValues) => {
    if (formMode.kind === 'edit') {
      const req: UpdateInventoryRequest = {
        name: values.name,
        address: values.address,
        contactPhone: values.contactPhone,
        contactPersonName: values.contactPersonName || undefined,
        active: values.active,
      }
      await update.mutateAsync({ id: formMode.inventory.id, req })
    } else if (formMode.kind === 'create') {
      const req: CreateInventoryRequest = {
        name: values.name,
        address: values.address,
        contactPhone: values.contactPhone,
        contactPersonName: values.contactPersonName || undefined,
        active: values.active,
      }
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

  const columns = useMemo<GridColDef<InventoryDto>[]>(() => [
    { field: 'code',              headerName: 'Code',           width: 110, sortable: false, filterable: false },
    { field: 'name',              headerName: 'Name',           flex: 1.4, minWidth: 180, sortable: false, filterable: false },
    { field: 'address',           headerName: 'Address',        flex: 2, minWidth: 240, sortable: false, filterable: false },
    { field: 'contactPhone',      headerName: 'Contact Number', width: 170, sortable: false, filterable: false },
    {
      field: 'contactPersonName', headerName: 'Contact Person', width: 180, sortable: false, filterable: false,
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
      renderCell: ({ row }) => (
        <Box>
          <IconButton size="small" onClick={() => setFormMode({ kind: 'edit', inventory: row })}>
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
    ? (list.error instanceof Error ? list.error.message : 'Failed to load inventories.')
    : null

  return (
    <div>
      <PageHeader
        title="Inventories"
        subtitle={
          list.isLoading
            ? 'Loading…'
            : `${inventories.length} ${inventories.length === 1 ? 'inventory' : 'inventories'} configured`
        }
        action={
          <Button
            variant="contained"
            color="primary"
            startIcon={<Plus className="w-4 h-4" />}
            onClick={() => setFormMode({ kind: 'create' })}
            sx={{ textTransform: 'none', fontWeight: 600 }}
          >
            Add Inventory
          </Button>
        }
      />

      {errorMessage && (
        <Alert severity="error" sx={{ mb: 2 }}>{errorMessage}</Alert>
      )}

      <Paper className="data-page-paper" sx={{ borderRadius: 2.5 }} elevation={0}>
        <DataGrid
          className="data-page-grid"
          rows={inventories}
          columns={columns}
          getRowId={r => r.id}
          loading={list.isLoading}
          autoHeight
          disableRowSelectionOnClick
          disableColumnMenu
          initialState={{ pagination: { paginationModel: { pageSize: 10 } } }}
          pageSizeOptions={[10, 25, 50]}
        />
      </Paper>

      <InventoryFormDialog
        open={formMode.kind !== 'closed'}
        inventory={formMode.kind === 'edit' ? formMode.inventory : null}
        submitting={create.isPending || update.isPending}
        submitError={mutationErrorMessage(create.error) ?? mutationErrorMessage(update.error)}
        onClose={closeForm}
        onSave={handleSave}
      />

      <ConfirmDialog
        open={!!pendingDelete}
        title="Delete inventory"
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

function InventoryFormDialog({ open, inventory, submitting, submitError, onClose, onSave }: {
  open: boolean
  inventory: InventoryDto | null
  submitting: boolean
  submitError: string | null
  onClose: () => void
  onSave: (values: FormValues) => Promise<void>
}) {
  const isEdit = !!inventory
  const [name, setName] = useState('')
  const [address, setAddress] = useState('')
  const [contactPhone, setContactPhone] = useState('')
  const [contactPersonName, setContactPersonName] = useState('')
  const [active, setActive] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setName(inventory?.name ?? '')
    setAddress(inventory?.address ?? '')
    setContactPhone(inventory?.contactPhone ?? '')
    setContactPersonName(inventory?.contactPersonName ?? '')
    setActive(inventory?.active ?? true)
    setErr(null)
  }, [open, inventory])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim())         { setErr('Enter an inventory name'); return }
    if (!address.trim())      { setErr('Enter the address'); return }
    if (!contactPhone.trim()) { setErr('Enter a contact number'); return }
    setErr(null)

    try {
      await onSave({
        name: name.trim(),
        address: address.trim(),
        contactPhone: contactPhone.trim(),
        contactPersonName: contactPersonName.trim(),
        active,
      })
    } catch {
      // Backend errors surface via the `submitError` prop; swallow here.
    }
  }

  return (
    <Dialog open={open} onClose={submitting ? undefined : onClose} maxWidth="sm" fullWidth slotProps={{ paper: { sx: { borderRadius: 3 } } }}>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontWeight: 600 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Warehouse className="w-5 h-5" />
          {isEdit ? 'Edit Inventory' : 'Add Inventory'}
        </Box>
        <IconButton size="small" onClick={onClose} disabled={submitting}><X className="w-4 h-4" /></IconButton>
      </DialogTitle>
      <form onSubmit={handleSubmit}>
        <DialogContent dividers sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {isEdit && inventory && (
            <Box sx={{ display: 'flex', gap: 2, fontSize: 13, color: '#64748b' }}>
              <span><b>ID:</b> {inventory.id}</span>
              <span><b>Code:</b> {inventory.code}</span>
            </Box>
          )}
          <TextField label="Name" value={name} onChange={e => setName(e.target.value)} required size="small" disabled={submitting} />
          <TextField label="Address" value={address} onChange={e => setAddress(e.target.value)} required size="small" multiline minRows={2} disabled={submitting} />
          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
            <TextField label="Contact Number" value={contactPhone} onChange={e => setContactPhone(e.target.value)} required size="small" placeholder="+91 ..." disabled={submitting} />
            <TextField label="Contact Person" value={contactPersonName} onChange={e => setContactPersonName(e.target.value)} size="small" placeholder="(optional)" disabled={submitting} />
          </Box>
          <FormControlLabel
            control={<Checkbox checked={active} onChange={e => setActive(e.target.checked)} disabled={submitting} />}
            label="Active"
          />
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
