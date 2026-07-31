// Phase 4b — customers + credit (features #6 + #4). Client term: "credit".

export type SettleMode = 'Cash' | 'UPI'
export type LedgerEntryType = 'Credit' | 'Settlement'

export interface CustomerDto {
  id: string
  code: string
  name: string
  phone: string
  creditLimit: number
  creditBalance: number
}

export interface CreateCustomerRequest {
  name: string
  phone: string
  creditLimit?: number | null
}

export interface SettleCreditRequest {
  amount: number
  mode: SettleMode
  note?: string | null
}

export interface CustomerLedgerEntryDto {
  id: string
  entryType: LedgerEntryType
  amount: number
  mode: SettleMode | null
  note: string | null
  balanceAfter: number
  billCode: string | null
  createdAt: string
  createdByName: string | null
}

export interface PagedResult<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
}

export interface CustomerListFilters {
  search?: string
  page?: number
  pageSize?: number
}
