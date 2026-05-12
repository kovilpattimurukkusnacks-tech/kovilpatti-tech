import { apiClient } from '../client'
import type { CategoryDto, CreateCategoryRequest, UpdateCategoryRequest } from './types'

export const categoriesApi = {
  list:   ()                                             => apiClient.get<CategoryDto[]>('/api/categories'),
  get:    (id: number)                                   => apiClient.get<CategoryDto>(`/api/categories/${id}`),
  create: (req: CreateCategoryRequest)                   => apiClient.post<CategoryDto>('/api/categories', req),
  update: (id: number, req: UpdateCategoryRequest)       => apiClient.put<CategoryDto>(`/api/categories/${id}`, req),
  remove: (id: number)                                   => apiClient.delete<void>(`/api/categories/${id}`),
}
