import { Package, Tags } from 'lucide-react'
import { Paper, Chip, Box } from '@mui/material'
import { DataGrid, type GridColDef } from '@mui/x-data-grid'
import StatCard from '../components/StatCard'
import PageHeader from '../components/PageHeader'
import { useApp } from '../context/AppContext'
import type { Product } from '../types'
import './Dashboard.css'

export default function Dashboard() {
  const { products } = useApp()

  const totalProducts = products.length
  const categoriesCount = new Set(products.map(p => p.category)).size

  const recentProducts = [...products].slice(-5).reverse()

  const columns: GridColDef<Product>[] = [
    { field: 'name', headerName: 'Product Name', flex: 1.5, minWidth: 200 },
    {
      field: 'category', headerName: 'Category', width: 130,
      renderCell: ({ value }) => <Chip label={value} size="small" variant="outlined" />,
    },
    {
      field: 'weightValue', headerName: 'Net Weight', width: 130,
      renderCell: ({ row }) => <span className="font-medium">{row.weightValue} {row.weightUnit}</span>,
    },
    {
      field: 'unitPrice', headerName: 'Unit Price', width: 140,
      renderCell: ({ row }) => <span>₹ {row.unitPrice} / {row.unit}</span>,
    },
  ]

  return (
    <div>
      <PageHeader title="Dashboard" subtitle="Overview of your product catalog" />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <StatCard label="Total Products" value={totalProducts} icon={Package} iconColor="bg-[#FCD835] text-[#1F1F1F]" />
        <StatCard label="Categories" value={categoriesCount} icon={Tags} iconColor="bg-[#1F1F1F] text-[#FCD835]" />
      </div>

      <Paper
        className="dashboard-paper"
        sx={{ borderRadius: 2.5 }}
        elevation={0}
      >
        <Box className="dashboard-section-header" sx={{ px: 2.5, py: 2 }}>
          <h2 className="font-bold text-[#1F1F1F] uppercase tracking-wide">Recently Added Products</h2>
        </Box>
        <DataGrid
          className="dashboard-grid"
          rows={recentProducts}
          columns={columns}
          getRowId={r => r.id}
          hideFooter
          disableRowSelectionOnClick
          autoHeight
        />
      </Paper>
    </div>
  )
}
