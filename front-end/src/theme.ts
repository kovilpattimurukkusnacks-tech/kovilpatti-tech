import { createTheme } from '@mui/material/styles'

// ── Brand gradients ─────────────────────────────────────────────
// Reusable gold gradients shared by the MUI theme + any component
// that wants the same look as the category headers. Exported so a
// component can `import { GOLD_GRADIENT } from '../theme'` instead
// of copying the long gradient string.
export const GOLD_GRADIENT =
  'linear-gradient(90deg, #C28A00 0%, #E6B800 35%, #FFD700 65%, #FFF1A6 100%)'
// Slightly deeper sweep for hover — same colour family, just shifted
// darker so the bar visibly responds to the pointer without changing
// hue.
export const GOLD_GRADIENT_HOVER =
  'linear-gradient(90deg, #A07000 0%, #C28A00 35%, #E6B800 65%, #FFD700 100%)'

export const theme = createTheme({
  palette: {
    mode: 'light',
    // primary.main stays dark so non-button uses (AppBar, Tab indicator, FAB
     // backgrounds) keep the legacy look. The Button override below swaps in
     // the gold gradient + dark text only for variant="contained" buttons.
    primary: { main: '#1F1F1F', light: '#3D3D3D', dark: '#0A0A0A', contrastText: '#FCD835' },
    secondary: { main: '#FCD835', light: '#FFE57E', dark: '#E8C200', contrastText: '#1F1F1F' },
    error: { main: '#C62828' },
    warning: { main: '#FFA000' },
    success: { main: '#2E7D32' },
    info: { main: '#0277BD' },
    background: { default: 'rgba(255, 248, 220, 0)', paper: '#FFFFFF' },
    text: { primary: '#1F1F1F', secondary: '#3D3D3D' },
  },
  typography: {
    fontFamily: '"Plus Jakarta Sans", system-ui, -apple-system, sans-serif',
    fontWeightMedium: 500,
    fontWeightBold: 600,
  },
  shape: { borderRadius: 12 },
  components: {
    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundImage: 'none',
          backgroundColor: '#FFFFFF',
        },
      },
    },
    MuiDialog: {
      styleOverrides: {
        paper: {
          backgroundColor: '#FFFFFF',
          border: '2px solid #1F1F1F',
          boxShadow: '8px 8px 0 0 #FCD835',
        },
      },
    },
    MuiDrawer: {
      styleOverrides: {
        paper: {
          backgroundColor: 'transparent',
          backdropFilter: 'none',
        },
      },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
            borderColor: '#1F1F1F',
            borderWidth: '2px',
          },
        },
      },
    },
    MuiInputLabel: {
      styleOverrides: {
        root: {
          '&.Mui-focused': {
            color: '#1F1F1F',
          },
        },
      },
    },
    // Every primary contained Button gets the metallic gold gradient by
    // default — no per-call sx override needed. Outlined / text / non-primary
    // variants are unaffected. Disabled state keeps a flat gold tint so the
    // button still reads as "the primary action" even when not clickable.
    //
    // Using the `root` slot with an ownerState callback because MUI v9
    // reorganised the colour-variant slot names — `containedPrimary` no
    // longer fires reliably across all variants. Filtering on ownerState
    // is the documented, version-stable path.
    MuiButton: {
      styleOverrides: {
        root: ({ ownerState }) =>
          ownerState.variant === 'contained' && ownerState.color === 'primary'
            ? {
                background: GOLD_GRADIENT,
                color: '#1F1F1F',
                border: '1px solid #C28A00',
                boxShadow: 'none',
                '&:hover': {
                  background: GOLD_GRADIENT_HOVER,
                  boxShadow: 'none',
                },
                '&.Mui-disabled': {
                  background: '#E6B800',
                  color: 'rgba(31,31,31,0.5)',
                  borderColor: '#C28A00',
                },
              }
            : {},
      },
    },
  },
})
