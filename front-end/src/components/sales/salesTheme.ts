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
  '& .MuiDataGrid-columnHeaders, & .MuiDataGrid-columnHeader': { bgcolor: '#FCD835' },
  // MUI X paints the filler cells (space right of the last column, under the
  // scrollbar) white and wins over plain sx — !important, same as SalaryTab.
  '& .MuiDataGrid-filler, & .MuiDataGrid-scrollbarFiller': { backgroundColor: `${CREAM} !important` },
  '& .MuiDataGrid-columnHeaders .MuiDataGrid-filler, & .MuiDataGrid-columnHeaders .MuiDataGrid-scrollbarFiller, & .MuiDataGrid-scrollbarFiller--header':
    { backgroundColor: '#FCD835 !important' },
  '& .MuiDataGrid-sortButton': { backgroundColor: 'transparent !important' },
  '& .MuiDataGrid-columnHeaderTitle': { fontWeight: 800, fontSize: 12, textTransform: 'uppercase' },
  '& .MuiDataGrid-row': { cursor: 'pointer' },
  '& .MuiDataGrid-row:hover': { bgcolor: CREAM_DEEP },
  '& .MuiDataGrid-footerContainer': { bgcolor: CREAM },
  '& .MuiDataGrid-overlay': { bgcolor: CREAM },
}

/** Presets for the date-range filter (IST). */
export type RangePresetKey = 'today' | 'yesterday' | 'last-7' | 'this-month' | 'last-month' | 'last-30'
