import type { MovementType } from '../../api/shop-inventory/types'

/** Plain-language names for shop stock movement types (admin screens). */
export const MOVEMENT_LABEL: Record<MovementType, string> = {
  Opening: 'Opening stock', Receipt: 'Received from godown', Sale: 'Sold',
  Return: 'Returned', Adjustment: 'Manual adjustment', Refund: 'Bill cancelled / refund',
}
