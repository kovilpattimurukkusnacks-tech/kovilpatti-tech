import type { SxProps, Theme } from '@mui/material'

// Phase 4d admin POS screens — palette + shared DataGrid styling. Kept out
// of salesUi.tsx so that file exports only components (react-refresh rule).

export const CREAM = '#FFFBE6'
export const CREAM_DEEP = '#FFF8DC'
export const LOSS_RED = '#C62828'
export const GAIN_GREEN = '#2E7D32'

/** DataGrid sx — cream surfaces, gold header, clickable rows. */
export const gridSx: SxProps<Theme> = {
  border: 0,
  bgcolor: CREAM,
  '& .MuiDataGrid-columnHeaders, & .MuiDataGrid-columnHeader, & .MuiDataGrid-filler': { bgcolor: '#FCD835' },
  '& .MuiDataGrid-columnHeaderTitle': { fontWeight: 800, fontSize: 12, textTransform: 'uppercase' },
  '& .MuiDataGrid-row': { cursor: 'pointer' },
  '& .MuiDataGrid-row:hover': { bgcolor: CREAM_DEEP },
  '& .MuiDataGrid-footerContainer': { bgcolor: CREAM },
  '& .MuiDataGrid-overlay': { bgcolor: CREAM },
}

/** Presets for the date-range filter (IST). */
export type RangePresetKey = 'today' | 'yesterday' | 'last-7' | 'this-month' | 'last-month' | 'last-30'
