/** Mirrors the BE ShopUtilityExpenseDto. Always scoped server-side to the
 *  calling ShopUser's own shop — there is no shopId param anywhere here. */

export type ShopUtilityExpenseDto = {
  id: string
  shopId: string
  category: string
  amount: number
  note: string | null
  /** YYYY-MM-DD */
  expenseDate: string
  createdAt: string
  updatedAt: string
}

export type CreateShopUtilityExpenseRequest = {
  category: string
  amount: number
  note?: string | null
  /** YYYY-MM-DD */
  expenseDate: string
}

export type UpdateShopUtilityExpenseRequest = CreateShopUtilityExpenseRequest
