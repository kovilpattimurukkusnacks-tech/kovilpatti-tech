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

// Server returns rows in tree order (path-sorted root-first, depth-grouped).
// Local mutations preserve that order by sorting on the breadcrumb path —
// same comparator the SP uses, so a created row lands in the right slot
// without a refetch.
const byPath = (a: CategoryDto, b: CategoryDto) =>
  (a.path ?? a.name).localeCompare(b.path ?? b.name)

export function useCreateCategory() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (req: CreateCategoryRequest) => categoriesApi.create(req),
    onSuccess: (created) => {
      qc.setQueryData<CategoryDto[]>(categoriesKeys.all, (old) =>
        old ? [...old, created].sort(byPath) : [created])
    },
  })
}

export function useUpdateCategory() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, req }: { id: number; req: UpdateCategoryRequest }) =>
      categoriesApi.update(id, req),
    onSuccess: (updated) => {
      // A parent-id change (move under a different node) shifts the path —
      // resort handles that. Descendant paths can drift too, but we don't
      // have them here; refetch is the safest fallback for that edge case.
      qc.setQueryData<CategoryDto[]>(categoriesKeys.all, (old) =>
        old ? old.map(c => c.id === updated.id ? updated : c).sort(byPath) : old)
      // Refetch when a parent_id change ripples down to descendants whose
      // path also needs updating.
      qc.invalidateQueries({ queryKey: categoriesKeys.all })
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
