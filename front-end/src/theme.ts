import { createTheme } from '@mui/material/styles'

export const theme = createTheme({
  palette: {
    mode: 'light',
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
  },
})
