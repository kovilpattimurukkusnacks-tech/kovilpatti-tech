import { apiClient } from '../client'
import { BASE_URL } from '../config'
import { tokenStore } from '../tokenStore'
import type {
  AccountsAdjustmentRowDto,
  AccountsCategoryRowDto,
  AccountsFilters,
  AccountsGodownExpenseByInventoryRowDto,
  AccountsGodownExpensesDto,
  AccountsInTransitDto,
  AccountsInventoryExpenseRowDto,
  AccountsProductRowDto,
  AccountsShopRowDto,
  AccountsSummaryDto,
  AccountsTrendBucketDto,
  AccountsUtilityRowDto,
} from './types'

/** Build a query-string from AccountsFilters. Arrays go as comma-separated
 *  values (matches the BE's CommaSeparatedArrayModelBinder). Empty arrays
 *  / undefined keys are omitted so the URL stays clean. */
function toQuery(f: AccountsFilters): string {
  const p = new URLSearchParams()
  p.set('from', f.from)
  p.set('to',   f.to)
  if (f.grouping) p.set('grouping', f.grouping)
  if (f.shopIds      && f.shopIds.length)      p.set('shopIds',      f.shopIds.join(','))
  if (f.inventoryIds && f.inventoryIds.length) p.set('inventoryIds', f.inventoryIds.join(','))
  if (f.categoryIds  && f.categoryIds.length)  p.set('categoryIds',  f.categoryIds.join(','))
  if (f.limit != null) p.set('limit', String(f.limit))
  // 19-Jun-2026 (client #13): view-mode lens — passed only when non-default so
  // the URL stays clean. BE Excel exports drop columns based on this param.
  if (f.view && f.view !== 'all') p.set('view', f.view)
  return `?${p.toString()}`
}

export const accountsApi = {
  summary:     (f: AccountsFilters) => apiClient.get<AccountsSummaryDto>            (`/api/accounts/summary${toQuery(f)}`),
  trend:       (f: AccountsFilters) => apiClient.get<AccountsTrendBucketDto[]>      (`/api/accounts/trend${toQuery(f)}`),
  byShop:      (f: AccountsFilters) => apiClient.get<AccountsShopRowDto[]>          (`/api/accounts/by-shop${toQuery(f)}`),
  byCategory:  (f: AccountsFilters) => apiClient.get<AccountsCategoryRowDto[]>      (`/api/accounts/by-category${toQuery(f)}`),
  topProducts: (f: AccountsFilters) => apiClient.get<AccountsProductRowDto[]>       (`/api/accounts/top-products${toQuery(f)}`),
  adjustments: (f: AccountsFilters) => apiClient.get<AccountsAdjustmentRowDto[]>    (`/api/accounts/adjustments${toQuery(f)}`),
  inTransit:   (f: AccountsFilters) => apiClient.get<AccountsInTransitDto>          (`/api/accounts/in-transit${toQuery(f)}`),
  utilities:   (f: AccountsFilters) => apiClient.get<AccountsUtilityRowDto[]>       (`/api/accounts/utilities${toQuery(f)}`),
  godownExpenses: (f: AccountsFilters) => apiClient.get<AccountsGodownExpensesDto>  (`/api/accounts/godown-expenses${toQuery(f)}`),
  inventoryExpenses: (f: AccountsFilters) => apiClient.get<AccountsInventoryExpenseRowDto[]>(`/api/accounts/inventory-expenses${toQuery(f)}`),
  godownExpensesByInventory: (f: AccountsFilters) => apiClient.get<AccountsGodownExpenseByInventoryRowDto[]>(`/api/accounts/godown-expenses-by-inventory${toQuery(f)}`),
}

// ──────── XLSX exports ────────
//
// Exports stream a native .xlsx workbook from the BE (client #11,
// 13-Jun-2026 — replaces the prior CSV-with-BOM approach). We attach the
// Authorization header inline via fetch + blob (rather than a plain
// <a href>) because the JWT is in localStorage, not a cookie — the
// browser doesn't send it on a naked navigation. Once we have the blob
// we trigger the download via a hidden <a download>. Memory cost is
// bounded — a single Accounts sheet for any realistic date range stays
// well under a few megabytes.

async function streamDownload(path: string, filename: string): Promise<void> {
  const token = tokenStore.get()
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  })
  if (!res.ok) {
    throw new Error(`Export failed with status ${res.status}`)
  }
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  try {
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
  } finally {
    URL.revokeObjectURL(url)
  }
}

function exportFilename(slug: string, f: AccountsFilters): string {
  return `accounts-${slug}_${f.from}_to_${f.to}.xlsx`
}

export const accountsExport = {
  byShop:      (f: AccountsFilters) => streamDownload(`/api/accounts/export/by-shop${toQuery(f)}`,      exportFilename('by-shop',      f)),
  byCategory:  (f: AccountsFilters) => streamDownload(`/api/accounts/export/by-category${toQuery(f)}`,  exportFilename('by-category',  f)),
  topProducts: (f: AccountsFilters) => streamDownload(`/api/accounts/export/top-products${toQuery(f)}`, exportFilename('top-products', f)),
  adjustments: (f: AccountsFilters) => streamDownload(`/api/accounts/export/adjustments${toQuery(f)}`,  exportFilename('adjustments',  f)),
}
