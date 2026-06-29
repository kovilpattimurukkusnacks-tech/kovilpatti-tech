import { useState, useEffect } from 'react'
import { Edit2, X, Settings as SettingsIcon, Store } from 'lucide-react'
import {
  Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle,
  FormControlLabel, IconButton, Paper, Skeleton, Switch, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, TextField, Typography,
} from '@mui/material'
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider'
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs'
import { TimePicker } from '@mui/x-date-pickers/TimePicker'
import dayjs, { type Dayjs } from 'dayjs'
import PageHeader from '../../components/PageHeader'
import { useGstEnabled, useSettings, useUpdateSetting } from '../../hooks/useSettings'
import { useShops, useToggleShopGst } from '../../hooks/useShops'
import type { AppSettingDto } from '../../api/settings/types'
import { ValidationError } from '../../api/errors'
import { formatIstDateTime } from '../../utils/formatDate'

// Parse our stored "HH:mm" value into a Dayjs instance the TimePicker can use.
// Returns null for empty/malformed input so the picker shows a clean empty state.
function parseHhMm(v: string): Dayjs | null {
  if (!/^\d{2}:\d{2}$/.test(v)) return null
  const [h, m] = v.split(':').map(Number)
  if (h < 0 || h > 23 || m < 0 || m > 59) return null
  return dayjs().hour(h).minute(m).second(0).millisecond(0)
}

// Per-key validation + input-type hints. Keys are well-known so we can give
// better UX than generic "string up to 200 chars". `inputType: 'time'` opts a
// key into the MUI X TimePicker (clock dial + AM/PM; stores HH:mm 24h string).
const KEY_HELP: Record<string, {
  label: string
  placeholder: string
  inputType?: 'time' | 'text'
  validate: (v: string) => string | null
}> = {
  request_lock_cutoff: {
    label: 'Cutoff time (IST)',
    placeholder: '09:00',
    inputType: 'time',
    validate: (v) => {
      if (!/^\d{2}:\d{2}$/.test(v)) return 'Pick a valid time'
      const [h, m] = v.split(':').map(Number)
      if (h < 0 || h > 23) return 'Hour must be 0–23'
      if (m < 0 || m > 59) return 'Minute must be 0–59'
      return null
    },
  },
}

// Keys whose value is a boolean stored as the literal string "true"/"false".
// Rendered as an MUI Switch in the edit dialog instead of a TextField.
const BOOLEAN_KEYS: Record<string, { onLabel: string; offLabel: string }> = {
  request_lock_enabled: {
    onLabel: 'Cutoff is ON — shop users locked out after cutoff',
    offLabel: 'Cutoff is OFF — shop users can edit/cancel anytime',
  },
  // 19-Jun-2026 (client #15): master switch for GST tracking. Drives the
  // visibility of the per-shop GST list below + the GST input on Products.
  gst_enabled: {
    onLabel: 'GST tracking is ON — Products show GST input, per-shop toggles apply',
    offLabel: 'GST tracking is OFF — GST input hidden, per-shop flags ignored',
  },
}

// Friendly display names for known keys. Falls back to title-casing the key
// (e.g. some_new_setting → "Some New Setting") so unmapped keys still read nicely.
const KEY_LABEL: Record<string, string> = {
  request_lock_cutoff: 'Cutoff Time',
  request_lock_enabled: 'Cutoff Enabled',
  gst_enabled: 'GST Tracking',
}

function humanizeKey(key: string): string {
  if (KEY_LABEL[key]) return KEY_LABEL[key]
  return key
    .split('_')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

// "09:00" → "09:00 AM", "17:30" → "05:30 PM". Passes through unchanged if the
// value isn't a well-formed 24h HH:MM. Used for the value chip on time-typed keys.
function formatTime12h(hhmm: string): string {
  if (!/^\d{2}:\d{2}$/.test(hhmm)) return hhmm
  const [h, m] = hhmm.split(':').map(Number)
  if (h < 0 || h > 23 || m < 0 || m > 59) return hhmm
  const period = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${String(h12).padStart(2, '0')}:${String(m).padStart(2, '0')} ${period}`
}

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
                        <Box sx={{ fontWeight: 600, fontSize: 13, color: '#1F1F1F' }}>{humanizeKey(s.key)}</Box>
                        {s.description && (
                          <Box sx={{ fontSize: 12, color: '#1F1F1F99' }}>{s.description}</Box>
                        )}
                      </Box>
                    </Box>
                  </TableCell>
                  <TableCell>
                    {BOOLEAN_KEYS[s.key] ? (
                      <Chip
                        label={s.value === 'true' ? 'ON' : 'OFF'}
                        size="small"
                        color={s.value === 'true' ? 'success' : 'default'}
                        sx={{ fontWeight: 700 }}
                      />
                    ) : (
                      <Chip
                        label={s.key === 'request_lock_cutoff' ? formatTime12h(s.value) : s.value}
                        size="small"
                        sx={{ fontFamily: 'monospace', fontWeight: 700 }}
                      />
                    )}
                  </TableCell>
                  <TableCell sx={{ fontSize: 12, color: '#1F1F1F99' }}>{formatIstDateTime(s.updatedAt)}</TableCell>
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

      {/* Per-shop GST section (19-Jun-2026, client #15). Only visible when
          the global GST master switch is ON — when disabled, per-shop flags
          are irrelevant so we hide the noise entirely. */}
      <ShopGstSection />

      <EditSettingDialog
        setting={editing}
        onClose={() => setEditing(null)}
      />
    </div>
  )
}

/**
 * Per-shop GST toggle list. Renders only when the global `gst_enabled`
 * app-setting is true. Each row has a Switch driving useToggleShopGst,
 * which optimistically updates the cached shop lists so the UI feels
 * instant (no spinner flicker between click and confirmation).
 *
 * If you turn the global master OFF in the Settings table above, this
 * whole section disappears — per-shop flags persist in DB but are
 * ignored downstream until master is re-enabled.
 */
function ShopGstSection() {
  const gst = useGstEnabled()
  const shopsQuery = useShops()
  const toggle = useToggleShopGst()

  if (gst.isLoading) return null
  if (!gst.enabled)   return null   // master OFF → hide entire section

  const shops = shopsQuery.data ?? []

  return (
    <Box sx={{ mt: 4 }}>
      <Typography variant="h6" sx={{ fontWeight: 700, mb: 0.5 }}>
        Per-shop GST
      </Typography>
      <Typography variant="caption" sx={{ display: 'block', color: '#1F1F1F99', mb: 1.5 }}>
        Toggle which shops are GST-registered. Used by the POS billing flow
        to decide whether each shop's bills include GST line items.
      </Typography>

      <Paper className="products-paper" sx={{ borderRadius: 2.5, overflow: 'hidden' }} elevation={0}>
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow sx={{ bgcolor: '#FCD835' }}>
                <TableCell sx={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, fontSize: 11 }}>Shop</TableCell>
                <TableCell sx={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, fontSize: 11, width: 200 }} align="right">
                  GST Enabled
                </TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {shopsQuery.isLoading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={2}><Skeleton variant="text" /></TableCell>
                  </TableRow>
                ))
              ) : shops.length === 0 ? (
                <TableRow><TableCell colSpan={2} align="center" sx={{ color: '#1F1F1F99' }}>No shops yet.</TableCell></TableRow>
              ) : shops.map(s => (
                <TableRow key={s.id} hover>
                  <TableCell>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Store className="w-4 h-4 text-[#1F1F1F]/60" />
                      <Box>
                        <Box sx={{ fontWeight: 600, fontSize: 13 }}>{s.name}</Box>
                        <Box sx={{ fontSize: 11, color: '#1F1F1F99' }}>{s.code}</Box>
                      </Box>
                    </Box>
                  </TableCell>
                  <TableCell align="right">
                    <Switch
                      checked={s.gstEnabled}
                      onChange={e => toggle.mutate({ id: s.id, enabled: e.target.checked })}
                      // Disable during the in-flight mutation for the SAME shop so
                      // a rapid click can't queue two opposite toggles.
                      disabled={toggle.isPending && toggle.variables?.id === s.id}
                      color="success"
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>
    </Box>
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
  const boolMeta = BOOLEAN_KEYS[setting.key]
  const isBool = !!boolMeta
  const boolOn = value === 'true'

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
          Edit {humanizeKey(setting.key)}
        </Box>
        <IconButton size="small" onClick={onClose} disabled={updateMutation.isPending}>
          <X className="w-4 h-4" />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {setting.description && (
          <Box>
            <Box sx={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: '#1F1F1F99' }}>Description</Box>
            <Box sx={{ fontSize: 13, color: '#1F1F1F' }}>{setting.description}</Box>
          </Box>
        )}
        {isBool ? (
          <Box>
            <FormControlLabel
              control={
                <Switch
                  checked={boolOn}
                  onChange={e => setValue(e.target.checked ? 'true' : 'false')}
                  color="success"
                />
              }
              label={
                <Box sx={{ fontSize: 13, fontWeight: 600 }}>
                  {boolOn ? boolMeta.onLabel : boolMeta.offLabel}
                </Box>
              }
            />
          </Box>
        ) : help?.inputType === 'time' ? (
          <LocalizationProvider dateAdapter={AdapterDayjs}>
            <TimePicker
              label={help.label}
              value={parseHhMm(value)}
              onChange={(d) => setValue(d ? d.format('HH:mm') : '')}
              ampm
              slotProps={{
                textField: { size: 'small', fullWidth: true, required: true, autoFocus: true },
              }}
            />
          </LocalizationProvider>
        ) : (
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
        )}
        {localErr && <Alert severity="error">{localErr}</Alert>}
        {apiErr   && <Alert severity="error" sx={{ whiteSpace: 'pre-line' }}>{apiErr}</Alert>}
      </DialogContent>
      <DialogActions sx={{ p: 2 }}>
        <Button
          onClick={onClose}
          variant="outlined"
          disabled={updateMutation.isPending}
          sx={{
            textTransform: 'none', fontWeight: 600,
            borderColor: '#1F1F1F', color: '#1F1F1F',
            '&:hover': { borderColor: '#1F1F1F', bgcolor: '#FCD835' },
          }}
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
