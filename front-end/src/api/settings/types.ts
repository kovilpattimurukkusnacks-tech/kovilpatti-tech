/** Mirrors the BE AppSettingDto. */

export type AppSettingDto = {
  key: string
  value: string
  description: string | null
  updatedAt: string         // ISO
  updatedBy: string | null  // user id
}

export type UpdateAppSettingRequest = {
  value: string
}
