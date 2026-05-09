import { apiClient } from '../client'
import type { CategoryDto } from './types'

export const categoriesApi = {
  list: () => apiClient.get<CategoryDto[]>('/api/categories'),
}
