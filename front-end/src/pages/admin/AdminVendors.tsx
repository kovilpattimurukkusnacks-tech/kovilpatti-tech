import { useEffect, useRef, useState } from 'react'
import { Plus, Edit2, Trash2, X, Truck } from 'lucide-react'
import {
  Alert, Autocomplete, Box, Button, Checkbox, Chip, Dialog, DialogActions, DialogContent, DialogTitle,
  IconButton, Paper, TextField,
} from '@mui/material'
import { DataGrid, type GridColDef } from '@mui/x-data-grid'
import PageHeader from '../../components/PageHeader'
import ConfirmDialog from '../../components/ConfirmDialog'
import { useVendorsPaged, useCreateVendor, useUpdateVendor, useDeleteVendor } from '../../hooks/useVendors'
import type { VendorDto, CreateVendorRequest, UpdateVendorRequest } from '../../api/vendors/types'
import { ValidationError } from '../../api/errors'
import { INDIA_STATES, TN_STATE_CODE, stateName } from '../../utils/indiaStates'
import '../Products.css'

type FormMode =
  | { kind: 'closed' }
  | { kind: 'create' }
  | { kind: 'edit'; vendor: VendorDto }

type FormValues = {
  name: string
  gstin: string
  stateCode: string
  contactPhone: string
  active: boolean
}

// State-code sets used by the Add/Edit Vendor dialog's Autocomplete —
// grouped into "South India" (Tamil Nadu + its neighbours, where the vast
// majority of Kovilpatti's vendors sit) and "Other States & UTs" (everything
// else, alphabetical). TN is force-first within South India so the default
// choice is right at the top; the rest of that group is alphabetical.
const SOUTH_STATE_CODES = new Set(['33', '32', '29', '37', '36', '34'])
// TN, KL, KA, AP, TG, PY

const STATE_OPTIONS = INDIA_STATES.slice().sort((a, b) => {
  const aSouth = SOUTH_STATE_CODES.has(a.code)
  const bSouth = SOUTH_STATE_CODES.has(b.code)
  if (aSouth !== bSouth) return aSouth ? -1 : 1
  if (a.code === TN_STATE_CODE) return -1
  if (b.code === TN_STATE_CODE) return 1
  return a.name.localeCompare(b.name)
})

function mutationErrorMessage(err: unknown): string | null {
  if (!err) return null
  if (err instanceof ValidationError) return err.flatten()
  if (err instanceof Error) return err.message
  return 'Something went wrong.'
}

export default function AdminVendors() {
  const [paginationModel, setPaginationModel] = useState({ page: 0, pageSize: 10 })
  const list = useVendorsPaged({ page: paginationModel.page + 1, pageSize: paginationModel.pageSize })
  const create = useCreateVendor()
  const update = useUpdateVendor()
  const remove = useDeleteVendor()

  const [formMode, setFormMode] = useState<FormMode>({ kind: 'closed' })
  const [pendingDelete, setPendingDelete] = useState<VendorDto | null>(null)

  const vendors = list.data?.items ?? []
  const total   = list.data?.total ?? 0

  const closeForm = () => setFormMode({ kind: 'closed' })

  const handleSave = async (values: FormValues) => {
    const common = {
      name: values.name,
      gstin: values.gstin || undefined,
      stateCode: values.stateCode,
      contactPhone: values.contactPhone || undefined,
    }

    if (formMode.kind === 'edit') {
      const req: UpdateVendorRequest = { ...common, active: values.active }
      await update.mutateAsync({ id: formMode.vendor.id, req })
    } else if (formMode.kind === 'create') {
      const req: CreateVendorRequest = { ...common, active: values.active }
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

  const columns: GridColDef<VendorDto>[] = [
    { field: 'code', headerName: 'Code', width: 110, sortable: false, filterable: false },
    { field: 'name', headerName: 'Vendor Name', flex: 1.3, minWidth: 200, sortable: false, filterable: false },
    {
      field: 'gstin', headerName: 'GSTIN', width: 170, sortable: false, filterable: false,
      renderCell: ({ value }) => value || <span className="text-[#1F1F1F]/40">— (unregistered)</span>,
    },
    {
      field: 'stateCode', headerName: 'State', width: 160, sortable: false, filterable: false,
      renderCell: ({ row }) => (
        <span>
          {stateName(row.stateCode)}
          {row.isInterstate && (
            <Chip label="Interstate" size="small" color="warning" variant="outlined" sx={{ ml: 1, height: 20 }} />
          )}
        </span>
      ),
    },
    {
      field: 'contactPhone', headerName: 'Contact', width: 160, sortable: false, filterable: false,
      renderCell: ({ value }) => value || <span className="text-[#1F1F1F]/40">—</span>,
    },
    {
      field: 'active', headerName: 'Status', width: 110, sortable: false, filterable: false,
      renderCell: ({ value }) => (
        <Chip label={value ? 'Active' : 'Inactive'} size="small" variant={value ? 'filled' : 'outlined'} color={value ? 'success' : 'default'} />
      ),
    },
    {
      field: 'actions', headerName: 'Actions', width: 120, sortable: false, filterable: false,
      align: 'right', headerAlign: 'right',
      renderCell: ({ row }) => (
        <Box>
          <IconButton size="small" onClick={() => setFormMode({ kind: 'edit', vendor: row })}>
            <Edit2 className="w-4 h-4" />
          </IconButton>
          <IconButton size="small" color="error" onClick={() => setPendingDelete(row)}>
            <Trash2 className="w-4 h-4" />
          </IconButton>
        </Box>
      ),
    },
  ]

  const errorMessage = list.isError
    ? (list.error instanceof Error ? list.error.message : 'Failed to load vendors.')
    : null

  return (
    <div>
      <PageHeader
        title="Vendors"
        subtitle={list.isLoading ? 'Loading…' : `${total} ${total === 1 ? 'vendor' : 'vendors'} configured`}
        action={
          <Button
            variant="contained"
            color="primary"
            startIcon={<Plus className="w-4 h-4" />}
            onClick={() => setFormMode({ kind: 'create' })}
            sx={{ textTransform: 'none', fontWeight: 600 }}
          >
            Add Vendor
          </Button>
        }
      />

      {errorMessage && <Alert severity="error" sx={{ mb: 2 }}>{errorMessage}</Alert>}

      <Paper className="data-page-paper" sx={{ borderRadius: 2.5 }} elevation={0}>
        <DataGrid
          className="data-page-grid"
          rows={vendors}
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

      <VendorFormDialog
        open={formMode.kind !== 'closed'}
        vendor={formMode.kind === 'edit' ? formMode.vendor : null}
        submitting={create.isPending || update.isPending}
        submitError={mutationErrorMessage(create.error) ?? mutationErrorMessage(update.error)}
        onClose={closeForm}
        onSave={handleSave}
      />

      <ConfirmDialog
        open={!!pendingDelete}
        title="Delete vendor"
        message={`Are you sure you want to delete "${pendingDelete?.name ?? ''}"?`}
        confirmLabel="Delete"
        onConfirm={handleConfirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  )
}

function VendorFormDialog({ open, vendor, submitting, submitError, onClose, onSave }: {
  open: boolean
  vendor: VendorDto | null
  submitting: boolean
  submitError: string | null
  onClose: () => void
  onSave: (values: FormValues) => Promise<void>
}) {
  const isEdit = !!vendor
  const [name, setName] = useState('')
  const [gstin, setGstin] = useState('')
  const [stateCode, setStateCode] = useState(TN_STATE_CODE)
  const [contactPhone, setContactPhone] = useState('')
  const [active, setActive] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const nameRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    setName(vendor?.name ?? '')
    setGstin(vendor?.gstin ?? '')
    setStateCode(vendor?.stateCode ?? TN_STATE_CODE)
    setContactPhone((vendor?.contactPhone ?? '').replace(/\D/g, '').slice(-10))
    setActive(vendor?.active ?? true)
    setErr(null)
    const t = setTimeout(() => nameRef.current?.focus(), 50)
    return () => clearTimeout(t)
  }, [open, vendor])

  const isInterstate = stateCode !== TN_STATE_CODE

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) { setErr('Enter a vendor name'); return }
    // GST law (Section 24, CGST Act): any interstate supply requires GST
    // registration — no turnover-based exemption like intrastate has.
    if (isInterstate && !gstin.trim()) { setErr('GSTIN is required for vendors outside Tamil Nadu (interstate supply must be GST-registered)'); return }
    if (gstin.trim() && gstin.trim().length !== 15) { setErr('GSTIN must be exactly 15 characters when provided'); return }
    setErr(null)

    try {
      await onSave({
        name: name.trim(),
        gstin: gstin.trim().toUpperCase(),
        stateCode,
        contactPhone: contactPhone ? `+91 ${contactPhone}` : '',
        active,
      })
    } catch {
      // Surfaces via submitError prop
    }
  }

  return (
    <Dialog
      open={open}
      onClose={(_e, reason) => { if (reason === 'backdropClick' || submitting) return; onClose() }}
      maxWidth="sm"
      fullWidth
      // Theme's MuiDialog override forces white app-wide; cream here to
      // match the rest of this feature's cards/filter bars/dropdowns
      // without touching the shared theme (other screens' dialogs stay white).
      slotProps={{ paper: { sx: { borderRadius: 3, bgcolor: '#FFFBE6' } } }}
    >
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontWeight: 600 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Truck className="w-5 h-5" />
          {isEdit ? 'Edit Vendor' : 'Add Vendor'}
        </Box>
        <IconButton size="small" onClick={onClose} disabled={submitting}><X className="w-4 h-4" /></IconButton>
      </DialogTitle>
      <form onSubmit={handleSubmit}>
        <DialogContent dividers sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {isEdit && vendor && (
            <Box sx={{ display: 'flex', justifyContent: 'center', gap: 2, fontSize: 13, color: '#64748b' }}>
              <span><b>Code:</b> {vendor.code}</span>
            </Box>
          )}
          <TextField label="Vendor Name" value={name} onChange={e => setName(e.target.value)} required size="small" disabled={submitting} inputRef={nameRef} />
          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
            <TextField
              label="GSTIN" value={gstin} onChange={e => setGstin(e.target.value.toUpperCase())}
              size="small" required={isInterstate}
              placeholder={isInterstate ? '15 chars, required (interstate)' : '15 chars, optional'}
              slotProps={{ htmlInput: { maxLength: 15 } }} disabled={submitting}
            />
            {/* Typeahead + grouped list. Type-to-search collapses the 35-item
                dropdown to just what matches (e.g. "tam" → Tamil Nadu); the
                popup height is capped so it never floods the viewport.
                South India group renders first with TN pinned at the top so
                the default choice is one glance away. */}
            <Autocomplete
              size="small"
              disableClearable
              options={STATE_OPTIONS}
              groupBy={(s) => SOUTH_STATE_CODES.has(s.code) ? 'South India' : 'Other States & UTs'}
              getOptionLabel={(s) => s.name}
              isOptionEqualToValue={(a, b) => a.code === b.code}
              value={STATE_OPTIONS.find(s => s.code === stateCode) ?? STATE_OPTIONS[0]}
              onChange={(_e, v) => setStateCode(v?.code ?? TN_STATE_CODE)}
              disabled={submitting}
              renderInput={(params) => (
                <TextField {...params} label="State" required size="small" />
              )}
              slotProps={{
                listbox: {
                  sx: {
                    maxHeight: 280,
                    // Group heading ("South India" / "Other States & UTs") —
                    // cream tint from the app palette so it stands out from
                    // the white option rows. Uppercase + tabular tracking
                    // matches the KPI eyebrow style used elsewhere.
                    '& .MuiListSubheader-root': {
                      bgcolor: '#FFF3CD',
                      color: '#8A6200',
                      fontWeight: 800,
                      fontSize: 11,
                      letterSpacing: '0.08em',
                      textTransform: 'uppercase',
                      lineHeight: '32px',
                      borderTop: '1px solid #E0A800',
                      borderBottom: '1px solid #E0A800',
                    },
                  },
                },
              }}
            />
          </Box>
          <TextField
            label="Contact Phone"
            value={contactPhone}
            onChange={e => setContactPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
            size="small"
            placeholder="10-digit number"
            slotProps={{ htmlInput: { maxLength: 10, inputMode: 'numeric' } }}
            disabled={submitting}
          />
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Checkbox checked={active} onChange={e => setActive(e.target.checked)} disabled={submitting} sx={{ p: 0.5 }} />
            <Box component="span" sx={{ fontSize: 14, color: '#1F1F1F', userSelect: 'none' }}>Active</Box>
          </Box>
          {isInterstate && (
            <Alert severity="warning" sx={{ fontSize: 13 }}>
              Interstate vendor — GSTIN is required, and purchases from this vendor may need an e-way bill above the configured inbound threshold.
            </Alert>
          )}
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
