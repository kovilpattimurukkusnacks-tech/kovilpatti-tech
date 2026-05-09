import { useQuery } from '@tanstack/react-query'
import { categoriesApi } from '../api/categories/api'

export const categoriesKeys = {
  all: ['categories'] as const,
}

export function useCategories() {
  return useQuery({
    queryKey: categoriesKeys.all,
    queryFn: () => categoriesApi.list(),
    // Categories rarely change — keep them fresh longer to avoid refetching
    // every time the products form opens.
    staleTime: 5 * 60_000,  // 5 min
  })
}
