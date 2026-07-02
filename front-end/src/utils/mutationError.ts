import { ValidationError } from '../api/errors'

// Shared mutation-error → user-facing message mapper. Used by the admin
// master-data pages (Categories, Inventories, Products, Shops, Staff) to
// surface ValidationError field messages, plain Error messages, or a
// generic fallback for anything else.
export function mutationErrorMessage(err: unknown): string | null {
  if (!err) return null
  if (err instanceof ValidationError) return err.flatten()
  if (err instanceof Error)           return err.message
  return 'Something went wrong.'
}
