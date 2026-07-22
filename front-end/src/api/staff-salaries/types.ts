/** Mirrors the BE StaffSalaryRowDto — one row per non-admin staff member for
 *  a given date range. `inAccounts` is true for ShopUser staff (their
 *  Pay/Deduct entries post into the same ledger Admin Accounts reads);
 *  false for Inventory staff (record-keeping only, never reaches Accounts). */

export type StaffSalaryRowDto = {
  staffId: string
  fullName: string
  role: string
  shopId: string | null
  shopName: string | null
  inventoryId: string | null
  inventoryName: string | null
  monthlyAmount: number
  paid: number
  deducted: number
  net: number
  inAccounts: boolean
}

export type StaffSalaryDto = {
  staffId: string
  monthlyAmount: number
  /** YYYY-MM-DD */
  effectiveFrom: string
}

export type SetStaffSalaryRequest = {
  staffId: string
  monthlyAmount: number
  /** YYYY-MM-DD */
  effectiveFrom: string
}

export type PaySalaryRequest = {
  staffId: string
  amount: number
  mode: string
  /** YYYY-MM-DD */
  txnDate: string
  note?: string | null
}

export type DeductSalaryRequest = {
  staffId: string
  amount: number
  reason: string
  /** YYYY-MM-DD */
  txnDate: string
  note?: string | null
}

/** One row in a staff's Pay/Deduct history — powers the "hover the Net
 *  figure" breakdown. Amount is signed (+Pay / −Deduct). */
export type StaffSalaryTransactionDto = {
  /** YYYY-MM-DD */
  txnDate: string
  amount: number
  note: string | null
}
