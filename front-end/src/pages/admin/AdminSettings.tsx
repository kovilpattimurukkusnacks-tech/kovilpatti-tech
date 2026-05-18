import { useState, useEffect } from 'react'
import { Edit2, X, Settings as SettingsIcon } from 'lucide-react'
import {
  Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle,
  IconButton, Paper, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField,
} from '@mui/material'
import PageHeader from '../../components/PageHeader'
import { useSettings, useUpdateSetting } from '../../hooks/useSettings'
import type { AppSettingDto } from '../../api/settings/types'
import { ValidationError } from '../../api/errors'

// Per-key validation. Keys are well-known so we can give better UX than generic
// "string up to 200 chars".
const KEY_HELP: Record<string, { label: string; placeholder: string; validate: (v: string) => string | null }> = {
  request_lock_cutoff: {
    label: 'Cutoff time (24-hour, HH:MM, IST)',
    placeholder: '09:00',
    validate: (v) => {
      if (!/^\d{2}:\d{2}$/.test(v)) return 'Use HH:MM format (e.g. 09:00 or 17:30)'
      const [h, m] = v.split(':').map(Number)
      if (h < 0 || h > 23) return 'Hour must be 0–23'
      if (m < 0 || m > 59) return 'Minute must be 0–59'
      return null
    },
  },
}

const fmtIst = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' })

export default function AdminSettings() {
  const list = useSettings()
  const [editing, setEditing] = useState<AppSettingDto | null>(null)

  const settings = list.data ?? []

  return (
    <div>
      <PageHeader
        title="Settings"
        subtitle="App-wide configuration. Changes apply immediately to new requests."
      />

      {list.isError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {list.error instanceof Error ? list.error.message : 'Failed to load settings.'}
        </Alert>
      )}

      <Paper className="products-paper" sx={{ borderRadius: 2.5, overflow: 'hidden' }} elevation={0}>
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow sx={{ bgcolor: '#FCD835' }}>
                <TableCell sx={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, fontSize: 11 }}>Setting</TableCell>
                <TableCell sx={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, fontSize: 11, width: 140 }}>Value</TableCell>
                <TableCell sx={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, fontSize: 11, width: 180 }}>Last updated</TableCell>
                <TableCell sx={{ width: 80 }} />
              </TableRow>
            </TableHead>
            <TableBody>
              {list.isLoading ? (
                <TableRow><TableCell colSpan={4} align="center" sx={{ color: '#1F1F1F99' }}>Loading…</TableCell></TableRow>
              ) : settings.length === 0 ? (
                <TableRow><TableCell colSpan={4} align="center" sx={{ color: '#1F1F1F99' }}>No settings.</TableCell></TableRow>
              ) : settings.map(s => (
                <TableRow key={s.key} hover>
                  <TableCell>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <SettingsIcon className="w-4 h-4 text-[#1F1F1F]/60" />
                      <Box>
                        <Box sx={{ fontWeight: 600, fontSize: 13, color: '#1F1F1F' }}>{s.key}</Box>
                        {s.description && (
                          <Box sx={{ fontSize: 12, color: '#1F1F1F99' }}>{s.description}</Box>
                        )}
                      </Box>
                    </Box>
                  </TableCell>
                  <TableCell>
                    <Chip label={s.value} size="small" sx={{ fontFamily: 'monospace', fontWeight: 700 }} />
                  </TableCell>
                  <TableCell sx={{ fontSize: 12, color: '#1F1F1F99' }}>{fmtIst(s.updatedAt)}</TableCell>
                  <TableCell align="right">
                    <IconButton size="small" onClick={() => setEditing(s)} aria-label="Edit">
                      <Edit2 className="w-4 h-4" />
                    </IconButton>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      <EditSettingDialog
        setting={editing}
        onClose={() => setEditing(null)}
      />
    </div>
  )
}

function EditSettingDialog({ setting, onClose }: { setting: AppSettingDto | null; onClose: () => void }) {
  const updateMutation = useUpdateSetting()
  const [value, setValue] = useState('')
  const [localErr, setLocalErr] = useState<string | null>(null)

  useEffect(() => {
    if (setting) {
      setValue(setting.value)
      setLocalErr(null)
      updateMutation.reset()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setting])

  if (!setting) return null

  const help = KEY_HELP[setting.key]

  const handleSave = async () => {
    setLocalErr(null)
    if (help) {
      const err = help.validate(value)
      if (err) { setLocalErr(err); return }
    }
    try {
      await updateMutation.mutateAsync({ key: setting.key, req: { value } })
      onClose()
    } catch {
      // surfaced below
    }
  }

  const apiErr =
    updateMutation.error instanceof ValidationError ? updateMutation.error.flatten()
    : updateMutation.error instanceof Error ? updateMutation.error.message : null

  return (
    <Dialog
      open
      onClose={(_e, reason) => {
        if (reason === 'backdropClick' || updateMutation.isPending) return
        onClose()
      }}
      maxWidth="xs"
      fullWidth
      slotProps={{ paper: { sx: { borderRadius: 3 } } }}
    >
      <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontWeight: 600 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Edit2 className="w-5 h-5" />
          Edit Setting
        </Box>
        <IconButton size="small" onClick={onClose} disabled={updateMutation.isPending}>
          <X className="w-4 h-4" />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Box>
          <Box sx={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: '#1F1F1F99' }}>Key</Box>
          <Box sx={{ fontFamily: 'monospace', fontSize: 13, fontWeight: 700 }}>{setting.key}</Box>
        </Box>
        {setting.description && (
          <Box>
            <Box sx={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: '#1F1F1F99' }}>Description</Box>
            <Box sx={{ fontSize: 13, color: '#1F1F1F' }}>{setting.description}</Box>
          </Box>
        )}
        <TextField
          label={help?.label ?? 'Value'}
          placeholder={help?.placeholder}
          value={value}
          onChange={e => setValue(e.target.value.slice(0, 200))}
          required
          size="small"
          autoFocus
          slotProps={{ htmlInput: { maxLength: 200 } }}
        />
        {localErr && <Alert severity="error">{localErr}</Alert>}
        {apiErr   && <Alert severity="error" sx={{ whiteSpace: 'pre-line' }}>{apiErr}</Alert>}
      </DialogContent>
      <DialogActions sx={{ p: 2 }}>
        <Button
          onClick={onClose}
          variant="outlined"
          color="secondary"
          disabled={updateMutation.isPending}
          sx={{ textTransform: 'none', fontWeight: 500 }}
        >
          Cancel
        </Button>
        <Button
          onClick={handleSave}
          variant="contained"
          disabled={!value.trim() || updateMutation.isPending}
          sx={{ textTransform: 'none', fontWeight: 700 }}
        >
          {updateMutation.isPending ? 'Saving…' : 'Save'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
