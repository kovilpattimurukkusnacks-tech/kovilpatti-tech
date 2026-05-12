import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { categoriesApi } from '../api/categories/api'
import type { CategoryDto, CreateCategoryRequest, UpdateCategoryRequest } from '../api/categories/types'

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

export function useCreateCategory() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (req: CreateCategoryRequest) => categoriesApi.create(req),
    // Append + re-sort alphabetically so dropdowns reflect the new entry
    // without a refetch round-trip.
    onSuccess: (created) => {
      qc.setQueryData<CategoryDto[]>(categoriesKeys.all, (old) =>
        old ? [...old, created].sort((a, b) => a.name.localeCompare(b.name)) : [created])
    },
  })
}

export function useUpdateCategory() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, req }: { id: number; req: UpdateCategoryRequest }) =>
      categoriesApi.update(id, req),
    onSuccess: (updated) => {
      qc.setQueryData<CategoryDto[]>(categoriesKeys.all, (old) =>
        old ? old.map(c => c.id === updated.id ? updated : c)
                 .sort((a, b) => a.name.localeCompare(b.name))
            : old)
    },
  })
}

export function useDeleteCategory() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => categoriesApi.remove(id),
    onSuccess: (_void, id) => {
      qc.setQueryData<CategoryDto[]>(categoriesKeys.all, (old) =>
        old ? old.filter(c => c.id !== id) : old)
    },
  })
}
