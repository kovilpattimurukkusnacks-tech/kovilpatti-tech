import { apiClient, getAuthHeaders, handleFailedResponse } from '../client'
import { BASE_URL } from '../config'
import { buildQuery } from '../queryString'
import type {
  AccountsAdjustmentRowDto,
  AccountsCategoryRowDto,
  AccountsFilters,
  AccountsInTransitDto,
  AccountsProductRowDto,
  AccountsShopRowDto,
  AccountsSummaryDto,
  AccountsTrendBucketDto,
} from './types'

/** Build a query-string from AccountsFilters. Arrays go as comma-separated
 *  values (matches the BE's CommaSeparatedArrayModelBinder). Empty arrays
 *  / undefined keys are omitted so the URL stays clean. */
function toQuery(f: AccountsFilters): string {
  const qs = buildQuery({
    from: f.from,
    to: f.to,
    grouping: f.grouping,
    shopIds: f.shopIds,
    inventoryIds: f.inventoryIds,
    categoryIds: f.categoryIds,
    limit: f.limit,
    // 19-Jun-2026 (client #13): view-mode lens — passed only when non-default so
    // the URL stays clean. BE Excel exports drop columns based on this param.
    view: f.view && f.view !== 'all' ? f.view : undefined,
  })
  // `from`/`to` are required — always present even if buildQuery's generic
  // rules would otherwise omit them, so keep the leading '?' unconditional.
  return qs || '?'
}

export const accountsApi = {
  summary:     (f: AccountsFilters) => apiClient.get<AccountsSummaryDto>            (`/api/accounts/summary${toQuery(f)}`),
  trend:       (f: AccountsFilters) => apiClient.get<AccountsTrendBucketDto[]>      (`/api/accounts/trend${toQuery(f)}`),
  byShop:      (f: AccountsFilters) => apiClient.get<AccountsShopRowDto[]>          (`/api/accounts/by-shop${toQuery(f)}`),
  byCategory:  (f: AccountsFilters) => apiClient.get<AccountsCategoryRowDto[]>      (`/api/accounts/by-category${toQuery(f)}`),
  topProducts: (f: AccountsFilters) => apiClient.get<AccountsProductRowDto[]>       (`/api/accounts/top-products${toQuery(f)}`),
  adjustments: (f: AccountsFilters) => apiClient.get<AccountsAdjustmentRowDto[]>    (`/api/accounts/adjustments${toQuery(f)}`),
  inTransit:   (f: AccountsFilters) => apiClient.get<AccountsInTransitDto>          (`/api/accounts/in-transit${toQuery(f)}`),
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
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: getAuthHeaders(),
  })
  if (!res.ok) {
    await handleFailedResponse(res)
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
