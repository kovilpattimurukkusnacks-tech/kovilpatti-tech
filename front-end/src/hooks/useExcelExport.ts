import { useCallback, useState } from 'react'

/**
 * Shared "Export Excel" button state machine used by the Accounts dashboard
 * tables (AdjustmentsLogTable, ShopBreakdownTable, CategoryAndProductsTable).
 * Each of those tables kicks off a BE render + download that typically takes
 * 2-5 seconds — this hook owns the `exporting` flag so the caller can swap
 * the button's icon/label to a spinner for that window and guard against a
 * double-click firing a second export.
 *
 * `handleExport` takes the export function to run so a single hook instance
 * can back more than one export action (e.g. CategoryAndProductsTable's
 * per-tab category/top-products exports share one spinner).
 */
export function useExcelExport() {
  const [exporting, setExporting] = useState(false)

  const handleExport = useCallback(async (exportFn: () => Promise<void>) => {
    if (exporting) return
    setExporting(true)
    try {
      await exportFn()
    } finally {
      setExporting(false)
    }
  }, [exporting])

  return { exporting, handleExport }
}
