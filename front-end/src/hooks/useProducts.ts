import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { productsApi } from '../api/products/api'
import type {
  CreateProductRequest, UpdateProductRequest, ProductListFilters, PagedResult, ProductDto,
} from '../api/products/types'

export const productsKeys = {
  all: ['products'] as const,
  list: (filters?: ProductListFilters) => ['products', 'list', filters ?? {}] as const,
  detail: (id: string) => ['products', id] as const,
}

export function useProducts(filters?: ProductListFilters) {
  return useQuery({
    queryKey: productsKeys.list(filters),
    queryFn: () => productsApi.list(filters),
    // Keep showing the previous page while the next page is loading, so the
    // grid doesn't flicker / collapse during pagination.
    placeholderData: keepPreviousData,
  })
}

export function useProduct(id: string | undefined) {
  return useQuery({
    queryKey: id ? productsKeys.detail(id) : ['products', 'idle'],
    queryFn: () => productsApi.get(id!),
    enabled: !!id,
  })
}

export function useCreateProduct() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (req: CreateProductRequest) => productsApi.create(req),
    // Patch the paged list cache directly with the new row. New rows get the
    // highest code (sorted last), so we only append when the current page
    // isn't already full — otherwise the new row belongs on a later page.
    onSuccess: (created) => {
      qc.setQueriesData<PagedResult<ProductDto>>(
        { queryKey: ['products', 'list'] },
        (old) => old ? {
          ...old,
          total: old.total + 1,
          items: old.items.length < old.pageSize ? [...old.items, created] : old.items,
        } : old,
      )
    },
  })
}

export function useUpdateProduct() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, req }: { id: string; req: UpdateProductRequest }) =>
      productsApi.update(id, req),
    // Instead of invalidating (which triggers a full list refetch — slow over
    // a cross-region BE→DB hop), patch the cached paged lists in place using
    // the returned product. UI updates instantly with no extra network call.
    onSuccess: (updated, vars) => {
      qc.setQueryData(productsKeys.detail(vars.id), updated)
      qc.setQueriesData<PagedResult<ProductDto>>(
        { queryKey: ['products', 'list'] },
        (old) => old ? { ...old, items: old.items.map(p => p.id === vars.id ? updated : p) } : old,
      )
    },
  })
}

export function useDeleteProduct() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => productsApi.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: productsKeys.all })
    },
  })
}

export function useImportProducts() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (file: File) => productsApi.import(file),
    onSuccess: (result) => {
      // Only invalidate when something was actually inserted.
      if (result.imported > 0) qc.invalidateQueries({ queryKey: productsKeys.all })
    },
  })
}
