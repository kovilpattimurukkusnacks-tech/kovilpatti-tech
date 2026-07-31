/** Mirrors the BE VendorDto / CreateVendorRequest / UpdateVendorRequest. */

export type VendorDto = {
  id: string
  code: string                       // e.g. VEN0001
  name: string
  gstin: string | null
  stateCode: string | null           // 2-digit GST state code, e.g. '33' = Tamil Nadu
  address: string | null
  contactPerson: string | null
  contactPhone: string | null
  email: string | null
  active: boolean
  /** Derived server-side: stateCode !== '33'. Same rule vendor purchases
   *  use to set isInterstate at insert time. */
  isInterstate: boolean
}

export type CreateVendorRequest = {
  name: string
  gstin?: string
  stateCode: string
  address?: string
  contactPerson?: string
  contactPhone?: string
  email?: string
  active?: boolean
}

export type UpdateVendorRequest = {
  name: string
  gstin?: string
  stateCode: string
  address?: string
  contactPerson?: string
  contactPhone?: string
  email?: string
  active: boolean
}

export type PagedResult<T> = {
  items: T[]
  total: number
  page: number
  pageSize: number
}
