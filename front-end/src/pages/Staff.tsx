import { useEffect, useMemo, useState } from 'react'
import { Plus, Edit2, Trash2, X, User as UserIcon, KeyRound, Eye, EyeOff } from 'lucide-react'
import {
  Alert, Box, Button, Checkbox, Chip, Dialog, DialogActions, DialogContent, DialogTitle,
  IconButton, MenuItem, Paper, TextField,
} from '@mui/material'
import { DataGrid, type GridColDef } from '@mui/x-data-grid'
import PageHeader from '../components/PageHeader'
import ConfirmDialog from '../components/ConfirmDialog'
import {
  useUsersPaged, useCreateUser, useUpdateUser, useResetUserPassword, useDeleteUser,
} from '../hooks/useUsers'
import { useShops } from '../hooks/useShops'
import { useInventories } from '../hooks/useInventories'
import type {
  UserDto, StaffRole, CreateStaffRequest, UpdateStaffRequest,
} from '../api/users/types'
import type { ShopDto } from '../api/shops/types'
import type { InventoryDto } from '../api/inventories/types'
import { ValidationError } from '../api/errors'

type FormMode =
  | { kind: 'closed' }
  | { kind: 'create' }
  | { kind: 'edit'; user: UserDto }

type FormValues = {
  username: string
  password: string
  fullName: string
  role: StaffRole
  shopId: string
  inventoryId: string
  active: boolean
}

export default function Staff() {
  const [paginationModel, setPaginationModel] = useState({ page: 0, pageSize: 10 })
  const list = useUsersPaged(paginationModel.page + 1, paginationModel.pageSize)
  const shopsQuery = useShops()
  const inventoriesQuery = useInventories()
  const create = useCreateUser()
  const update = useUpdateUser()
  const resetPwd = useResetUserPassword()
  const remove = useDeleteUser()

  const [formMode, setFormMode] = useState<FormMode>({ kind: 'closed' })
  const [pendingDelete, setPendingDelete] = useState<UserDto | null>(null)
  const [resetTarget, setResetTarget] = useState<UserDto | null>(null)

  const users       = list.data?.items ?? []
  const total       = list.data?.total ?? 0
  const shops       = shopsQuery.data ?? []
  const inventories = inventoriesQuery.data ?? []

  const closeForm = () => setFormMode({ kind: 'closed' })

  const handleSave = async (values: FormValues) => {
    if (formMode.kind === 'edit') {
      const req: UpdateStaffRequest = {
        fullName: values.fullName,
        role: values.role,
        shopId:      values.role === 'ShopUser'  ? values.shopId      : undefined,
        inventoryId: values.role === 'Inventory' ? values.inventoryId : undefined,
        active: values.active,
      }
      await update.mutateAsync({ id: formMode.user.id, req })
    } else if (formMode.kind === 'create') {
      const req: CreateStaffRequest = {
        username: values.username,
        password: values.password,
        fullName: values.fullName,
        role: values.role,
        shopId:      values.role === 'ShopUser'  ? values.shopId      : undefined,
        inventoryId: values.role === 'Inventory' ? values.inventoryId : undefined,
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

  const handleResetPassword = async (newPassword: string) => {
    if (!resetTarget) return
    try {
      await resetPwd.mutateAsync({ id: resetTarget.id, req: { newPassword } })
    } finally {
      setResetTarget(null)
    }
  }

  const columns = useMemo<GridColDef<UserDto>[]>(() => [
    { field: 'username', headerName: 'Username', width: 150, sortable: false, filterable: false },
    { field: 'fullName', headerName: 'Full Name', flex: 1.2, minWidth: 180, sortable: false, filterable: false },
    {
      field: 'role', headerName: 'Role', width: 130, sortable: false, filterable: false,
      renderCell: ({ value }) => (
        <Chip
          label={value === 'ShopUser' ? 'Shop User' : value === 'Inventory' ? 'Inventory' : value}
          size="small"
          variant="outlined"
        />
      ),
    },
    {
      field: 'mappedTo', headerName: 'Mapped To', flex: 1.5, minWidth: 200, sortable: false, filterable: false,
      valueGetter: (_value, row) => row.shopName ?? row.inventoryName ?? '—',
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
      field: 'actions', headerName: 'Actions', width: 160, sortable: false, filterable: false,
      align: 'right', headerAlign: 'right',
      cellClassName: 'col-pin-right',
      headerClassName: 'col-pin-right',
      renderCell: ({ row }) => (
        <Box>
          <IconButton size="small" title="Reset password" onClick={() => setResetTarget(row)}>
            <KeyRound className="w-4 h-4" />
          </IconButton>
          <IconButton size="small" title="Edit" onClick={() => setFormMode({ kind: 'edit', user: row })}>
            <Edit2 className="w-4 h-4" />
          </IconButton>
          <IconButton size="small" color="error" title="Delete" onClick={() => setPendingDelete(row)}>
            <Trash2 className="w-4 h-4" />
          </IconButton>
        </Box>
      ),
    },
  ], [])

  const canAdd = shops.length > 0 || inventories.length > 0
  const errorMessage = list.isError
    ? (list.error instanceof Error ? list.error.message : 'Failed to load staff.')
    : null

  return (
    <div>
      <PageHeader
        title="Staff"
        subtitle={
          list.isLoading
            ? 'Loading…'
            : `${total} ${total === 1 ? 'user' : 'users'} configured`
        }
        action={
          <Button
            variant="contained"
            color="primary"
            startIcon={<Plus className="w-4 h-4" />}
            onClick={() => setFormMode({ kind: 'create' })}
            sx={{ textTransform: 'none', fontWeight: 600 }}
            disabled={!canAdd || shopsQuery.isLoading || inventoriesQuery.isLoading}
          >
            Add Staff
          </Button>
        }
      />

      {errorMessage && <Alert severity="error" sx={{ mb: 2 }}>{errorMessage}</Alert>}

      {!shopsQuery.isLoading && !inventoriesQuery.isLoading && !canAdd && (
        <Box sx={{ mb: 2, p: 2, borderRadius: 2, bgcolor: '#FFF8DC', border: '1px solid #1F1F1F', fontSize: 14, color: '#1F1F1F' }}>
          Create at least one <b>Inventory</b> or <b>Shop</b> before adding staff — every staff member must be mapped to one.
        </Box>
      )}

      <Paper className="data-page-paper" sx={{ borderRadius: 2.5 }} elevation={0}>
        <DataGrid
          className="data-page-grid"
          rows={users}
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

      <StaffFormDialog
        open={formMode.kind !== 'closed'}
        user={formMode.kind === 'edit' ? formMode.user : null}
        shops={shops}
        inventories={inventories}
        submitting={create.isPending || update.isPending}
        submitError={mutationErrorMessage(create.error) ?? mutationErrorMessage(update.error)}
        onClose={closeForm}
        onSave={handleSave}
      />

      <ResetPasswordDialog
        open={!!resetTarget}
        username={resetTarget?.username ?? ''}
        submitting={resetPwd.isPending}
        submitError={mutationErrorMessage(resetPwd.error)}
        onConfirm={handleResetPassword}
        onCancel={() => setResetTarget(null)}
      />

      <ConfirmDialog
        open={!!pendingDelete}
        title="Delete staff"
        message={`Are you sure you want to delete user "${pendingDelete?.username ?? ''}"? This will deactivate them.`}
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

function StaffFormDialog({ open, user, shops, inventories, submitting, submitError, onClose, onSave }: {
  open: boolean
  user: UserDto | null
  shops: ShopDto[]
  inventories: InventoryDto[]
  submitting: boolean
  submitError: string | null
  onClose: () => void
  onSave: (values: FormValues) => Promise<void>
}) {
  const isEdit = !!user
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [fullName, setFullName] = useState('')
  const [role, setRole] = useState<StaffRole>('ShopUser')
  const [shopId, setShopId] = useState('')
  const [inventoryId, setInventoryId] = useState('')
  const [active, setActive] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setUsername(user?.username ?? '')
    setPassword('')
    setShowPassword(false)
    setFullName(user?.fullName ?? '')
    const initialRole: StaffRole = (user?.role === 'Inventory' || user?.role === 'ShopUser')
      ? user.role
      : 'ShopUser'
    setRole(initialRole)
    setShopId(user?.shopId ?? (shops[0]?.id ?? ''))
    setInventoryId(user?.inventoryId ?? (inventories[0]?.id ?? ''))
    setActive(user?.active ?? true)
    setErr(null)
  }, [open, user, shops, inventories])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const u = username.trim()
    const fn = fullName.trim()

    if (!isEdit) {
      if (!u)                  { setErr('Enter a username'); return }
      if (u.length < 3)        { setErr('Username must be at least 3 characters'); return }
      if (['admin', 'inventory'].includes(u.toLowerCase())) {
        setErr(`Username "${u}" is reserved`); return
      }
      if (!password)           { setErr('Enter a password'); return }
      if (password.length < 6) { setErr('Password must be at least 6 characters'); return }
    }
    if (!fn)                                    { setErr('Enter the full name'); return }
    if (role === 'ShopUser'  && !shopId)        { setErr('Pick a shop'); return }
    if (role === 'Inventory' && !inventoryId)   { setErr('Pick an inventory'); return }
    setErr(null)

    try {
      await onSave({
        username: u || (user?.username ?? ''),
        password,
        fullName: fn,
        role,
        shopId,
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
          <UserIcon className="w-5 h-5" />
          {isEdit ? 'Edit Staff' : 'Add Staff'}
        </Box>
        <IconButton size="small" onClick={onClose} disabled={submitting}><X className="w-4 h-4" /></IconButton>
      </DialogTitle>
      <form onSubmit={handleSubmit}>
        <DialogContent dividers sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {isEdit && user && (
            <Box sx={{ display: 'flex', gap: 2, fontSize: 13, color: '#64748b' }}>
              <span><b>ID:</b> {user.id}</span>
              <span><b>Username:</b> {user.username}</span>
            </Box>
          )}

          {!isEdit && (
            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
              <TextField label="Username" value={username} onChange={e => setUsername(e.target.value)} required size="small" disabled={submitting} />
              <TextField
                label="Password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                size="small"
                placeholder="min 6 chars"
                disabled={submitting}
                slotProps={{
                  input: {
                    endAdornment: (
                      <IconButton
                        size="small"
                        onClick={() => setShowPassword(s => !s)}
                        aria-label={showPassword ? 'Hide password' : 'Show password'}
                        tabIndex={-1}
                      >
                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </IconButton>
                    ),
                  },
                }}
              />
            </Box>
          )}

          <TextField
            label="Full Name"
            value={fullName}
            onChange={e => setFullName(
              e.target.value.replace(/[^A-Za-z\s.'\-]/g, '').slice(0, 60)
            )}
            onKeyDown={e => {
              if (e.key.length === 1 && !/[A-Za-z\s.'\-]/.test(e.key)) e.preventDefault()
            }}
            required
            size="small"
            slotProps={{ htmlInput: { maxLength: 60 } }}
            disabled={submitting}
          />

          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
            <TextField select label="Role" value={role} onChange={e => setRole(e.target.value as StaffRole)} size="small" disabled={submitting}>
              <MenuItem value="ShopUser">Shop User</MenuItem>
              <MenuItem value="Inventory">Inventory</MenuItem>
            </TextField>
            {role === 'ShopUser' ? (
              <TextField select label="Shop" value={shopId} onChange={e => setShopId(e.target.value)} required size="small" disabled={submitting}>
                {shops.map(s => (
                  <MenuItem key={s.id} value={s.id}>{s.code} — {s.name}</MenuItem>
                ))}
              </TextField>
            ) : (
              <TextField select label="Inventory" value={inventoryId} onChange={e => setInventoryId(e.target.value)} required size="small" disabled={submitting}>
                {inventories.map(i => (
                  <MenuItem key={i.id} value={i.id}>{i.code} — {i.name}</MenuItem>
                ))}
              </TextField>
            )}
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

function ResetPasswordDialog({ open, username, submitting, submitError, onConfirm, onCancel }: {
  open: boolean
  username: string
  submitting: boolean
  submitError: string | null
  onConfirm: (newPassword: string) => Promise<void>
  onCancel: () => void
}) {
  const [newPassword, setNewPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setNewPassword('')
    setShowPassword(false)
    setErr(null)
  }, [open])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newPassword)             { setErr('Enter a new password'); return }
    if (newPassword.length < 6)   { setErr('Password must be at least 6 characters'); return }
    setErr(null)
    try {
      await onConfirm(newPassword)
    } catch {
      // Surfaces via submitError prop
    }
  }

  return (
    <Dialog
      open={open}
      onClose={(_e, reason) => {
        if (reason === 'backdropClick' || submitting) return
        onCancel()
      }}
      maxWidth="xs"
      fullWidth
      slotProps={{ paper: { sx: { borderRadius: 3 } } }}
    >
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, fontWeight: 600 }}>
        <KeyRound className="w-5 h-5" />
        Reset password
      </DialogTitle>
      <form onSubmit={handleSubmit}>
        <DialogContent dividers sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Box sx={{ fontSize: 13, color: '#64748b' }}>
            Setting a new password for user <b>{username}</b>.
          </Box>
          <TextField
            label="New Password"
            type={showPassword ? 'text' : 'password'}
            value={newPassword}
            onChange={e => setNewPassword(e.target.value)}
            required size="small" autoFocus
            placeholder="min 6 chars"
            disabled={submitting}
            slotProps={{
              input: {
                endAdornment: (
                  <IconButton
                    size="small"
                    onClick={() => setShowPassword(s => !s)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    tabIndex={-1}
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </IconButton>
                ),
              },
            }}
          />
          {err && <Box sx={{ color: 'error.main', fontSize: 14 }}>{err}</Box>}
          {submitError && <Alert severity="error" sx={{ whiteSpace: 'pre-line' }}>{submitError}</Alert>}
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button onClick={onCancel} variant="outlined" color="secondary" disabled={submitting} sx={{ textTransform: 'none', fontWeight: 500 }}>Cancel</Button>
          <Button type="submit" variant="contained" disabled={submitting} sx={{ textTransform: 'none', fontWeight: 600 }}>
            {submitting ? 'Saving…' : 'Reset'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  )
}
