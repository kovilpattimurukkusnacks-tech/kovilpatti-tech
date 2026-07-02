import { apiClient } from '../client'
import { buildQuery } from '../queryString'
import type { PagedResult } from '../types'
import type {
  ProductDto, CreateProductRequest, UpdateProductRequest, ProductListFilters, ImportProductsResult,
} from './types'

function toQueryString(filters?: ProductListFilters): string {
  if (!filters) return ''
  return buildQuery({
    search: filters.search,
    categoryIds: filters.categoryIds,
    types: filters.types,
    page: filters.page,
    pageSize: filters.pageSize,
  })
}

export const productsApi = {
  list:   (filters?: ProductListFilters)            => apiClient.get<PagedResult<ProductDto>>(`/api/products${toQueryString(filters)}`),
  get:    (id: string)                              => apiClient.get<ProductDto>(`/api/products/${id}`),
  create: (req: CreateProductRequest)               => apiClient.post<ProductDto>('/api/products', req),
  update: (id: string, req: UpdateProductRequest)   => apiClient.put<ProductDto>(`/api/products/${id}`, req),
  remove: (id: string)                              => apiClient.delete<void>(`/api/products/${id}`),
  import: (file: File) => {
    const form = new FormData()
    form.append('file', file)
    return apiClient.post<ImportProductsResult>('/api/products/import', form)
  },
}
