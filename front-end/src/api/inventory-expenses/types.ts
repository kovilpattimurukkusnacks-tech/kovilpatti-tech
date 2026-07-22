/** Mirrors the BE InventoryExpenseDto. Always scoped server-side to the
 *  calling Inventory user's own godown — there is no inventoryId param
 *  anywhere here. Parallel to ShopUtilityExpenseDto (shop side). */

export type InventoryExpenseDto = {
  id: string
  inventoryId: string
  category: string
  amount: number
  note: string | null
  /** YYYY-MM-DD */
  expenseDate: string
  createdAt: string
  updatedAt: string
}

export type CreateInventoryExpenseRequest = {
  category: string
  amount: number
  note?: string | null
  /** YYYY-MM-DD */
  expenseDate: string
}

export type UpdateInventoryExpenseRequest = CreateInventoryExpenseRequest
