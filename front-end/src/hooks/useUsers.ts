import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { usersApi } from '../api/users/api'
import type {
  CreateStaffRequest, UpdateStaffRequest, ResetPasswordRequest, PagedResult, UserDto,
} from '../api/users/types'

export const usersKeys = {
  all: ['users'] as const,
  paged: (page: number, pageSize: number) => ['users', 'paged', page, pageSize] as const,
  detail: (id: string) => ['users', id] as const,
}

export function useUsers() {
  return useQuery({
    queryKey: usersKeys.all,
    queryFn: () => usersApi.list(),
  })
}

export function useUsersPaged(page: number, pageSize: number) {
  return useQuery({
    queryKey: usersKeys.paged(page, pageSize),
    queryFn: () => usersApi.listPaged(page, pageSize),
    placeholderData: keepPreviousData,
  })
}

export function useUser(id: string | undefined) {
  return useQuery({
    queryKey: id ? usersKeys.detail(id) : ['users', 'idle'],
    queryFn: () => usersApi.get(id!),
    enabled: !!id,
  })
}

export function useCreateUser() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (req: CreateStaffRequest) => usersApi.create(req),
    onSuccess: (created) => {
      qc.setQueriesData<PagedResult<UserDto>>(
        { queryKey: ['users', 'paged'] },
        (old) => old ? {
          ...old,
          total: old.total + 1,
          items: old.items.length < old.pageSize ? [...old.items, created] : old.items,
        } : old,
      )
    },
  })
}

export function useUpdateUser() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, req }: { id: string; req: UpdateStaffRequest }) => usersApi.update(id, req),
    onSuccess: (updated, vars) => {
      qc.setQueryData(usersKeys.detail(vars.id), updated)
      qc.setQueriesData<PagedResult<UserDto>>(
        { queryKey: ['users', 'paged'] },
        (old) => old ? { ...old, items: old.items.map(u => u.id === vars.id ? updated : u) } : old,
      )
    },
  })
}

export function useResetUserPassword() {
  return useMutation({
    mutationFn: ({ id, req }: { id: string; req: ResetPasswordRequest }) =>
      usersApi.resetPassword(id, req),
  })
}

export function useDeleteUser() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => usersApi.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: usersKeys.all })
    },
  })
}
