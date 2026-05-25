import { useState } from 'react'
import {
  Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle,
} from '@mui/material'

type Props = {
  open: boolean
  /** Shown above the action row. Optional — falls back to a generic line. */
  message?: string
  /** Optional: when provided, a "Save as Draft" button is shown. The callback
   *  should resolve once the draft is safely persisted; the modal then
   *  invokes `onProceed`. If it rejects, the modal stays open with an error. */
  onSaveDraft?: () => Promise<void>
  /** Discard local changes and proceed with the navigation. */
  onDiscard: () => void
  /** Stay on the page (cancel the navigation). */
  onCancel: () => void
}

/**
 * Confirmation modal shown when the user tries to leave a page with unsaved
 * changes (in-app navigation only — `beforeunload` is the browser's own
 * dialog and can't be styled).
 *
 * Driven by the caller's `useUnsavedChangesGuard()` blocker:
 *   - blocker.state === 'blocked' → render with `open={true}`
 *   - onDiscard / onSaveDraft success → blocker.proceed()
 *   - onCancel → blocker.reset()
 */
export function UnsavedChangesDialog({
  open, message, onSaveDraft, onDiscard, onCancel,
}: Props) {
  const [saving, setSaving]   = useState(false)
  const [saveErr, setSaveErr] = useState<string | null>(null)

  const handleSave = async () => {
    if (!onSaveDraft) return
    setSaving(true)
    setSaveErr(null)
    try {
      await onSaveDraft()
    } catch (e) {
      // Surface the error and keep the modal open so the user can either
      // discard explicitly or fix whatever broke (e.g. a network blip) and
      // retry. We don't proceed with navigation on a failed save.
      setSaveErr(e instanceof Error ? e.message : 'Could not save the draft.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog
      open={open}
      // Don't allow backdrop dismiss while a save is in flight — losing the
      // save mid-flight would leave the user with a stuck state.
      onClose={(_e, reason) => {
        if (reason === 'backdropClick' || saving) return
        onCancel()
      }}
      maxWidth="xs"
      fullWidth
      slotProps={{ paper: { sx: { borderRadius: 3 } } }}
    >
      <DialogTitle sx={{ fontWeight: 700 }}>Leave this page?</DialogTitle>
      <DialogContent dividers>
        <Box sx={{ fontSize: 14, color: '#1F1F1F' }}>
          {message ?? 'You have unsaved changes. If you leave now, they will be lost unless you save as a draft.'}
        </Box>
        {saveErr && (
          <Alert severity="error" sx={{ mt: 2, whiteSpace: 'pre-line' }}>{saveErr}</Alert>
        )}
      </DialogContent>
      <DialogActions sx={{ p: 2, gap: 1, flexWrap: 'wrap' }}>
        <Button
          onClick={onCancel}
          disabled={saving}
          variant="outlined"
          sx={{
            textTransform: 'none', fontWeight: 600,
            borderColor: '#1F1F1F', color: '#1F1F1F',
            '&:hover': { borderColor: '#1F1F1F', bgcolor: '#FCD835' },
          }}
        >
          Stay
        </Button>
        <Button
          onClick={onDiscard}
          disabled={saving}
          variant="outlined"
          sx={{
            textTransform: 'none', fontWeight: 600,
            borderColor: '#C62828', color: '#C62828',
            '&:hover': { borderColor: '#C62828', bgcolor: 'rgba(198,40,40,0.05)' },
          }}
        >
          Discard
        </Button>
        {onSaveDraft && (
          <Button
            onClick={handleSave}
            disabled={saving}
            variant="contained"
            sx={{ textTransform: 'none', fontWeight: 700 }}
          >
            {saving ? 'Saving…' : 'Save as Draft'}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  )
}
