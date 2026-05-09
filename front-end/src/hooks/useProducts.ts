import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { productsApi } from '../api/products/api'
import type {
  CreateProductRequest, UpdateProductRequest, ProductListFilters,
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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: productsKeys.all })
    },
  })
}

export function useUpdateProduct() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, req }: { id: string; req: UpdateProductRequest }) =>
      productsApi.update(id, req),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: productsKeys.all })
      qc.invalidateQueries({ queryKey: productsKeys.detail(vars.id) })
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
