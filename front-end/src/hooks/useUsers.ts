import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { usersApi } from '../api/users/api'
import type {
  CreateStaffRequest, UpdateStaffRequest, ResetPasswordRequest,
} from '../api/users/types'

export const usersKeys = {
  all: ['users'] as const,
  detail: (id: string) => ['users', id] as const,
}

export function useUsers() {
  return useQuery({
    queryKey: usersKeys.all,
    queryFn: () => usersApi.list(),
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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: usersKeys.all })
    },
  })
}

export function useUpdateUser() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, req }: { id: string; req: UpdateStaffRequest }) => usersApi.update(id, req),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: usersKeys.all })
      qc.invalidateQueries({ queryKey: usersKeys.detail(vars.id) })
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
