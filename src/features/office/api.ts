import type { Role, Snapshot } from './types'

export class OfficeError extends Error {
  code: string
  status: number
  constructor(message: string, code: string, status: number) {
    super(message)
    this.name = 'OfficeError'
    this.code = code
    this.status = status
  }
}
export async function officeApi<T>(
  path: string,
  role: Role,
  body?: unknown
): Promise<T> {
  const response = await fetch(`${import.meta.env.BASE_URL}api/office${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-Demo-Role': role },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  let data: unknown
  try {
    data = await response.json()
  } catch {
    throw new OfficeError(
      '服务返回了无法读取的结果，请检查演示后台。',
      'INVALID_RESPONSE',
      response.status
    )
  }
  if (!response.ok) {
    const error = (data as { error?: { message?: string; code?: string } })
      .error
    throw new OfficeError(
      error?.message || `请求失败（${response.status}）`,
      error?.code || 'REQUEST_FAILED',
      response.status
    )
  }
  return data as T
}
export const errorText = (error: unknown) =>
  error instanceof OfficeError
    ? `${error.message} · ${error.code}`
    : error instanceof Error
      ? error.message
      : '请求失败，请重试。'

let workspaceInitialized = false
let firstSnapshot: Promise<Snapshot> | null = null

// The first response establishes the workspace cookie. Sharing this request also
// prevents React StrictMode's duplicate mount effects from creating two spaces.
export async function getOfficeSnapshot(role: Role): Promise<Snapshot> {
  if (!workspaceInitialized) {
    if (!firstSnapshot) {
      firstSnapshot = officeApi<Snapshot>('/snapshot', role)
        .then((snapshot) => {
          workspaceInitialized = true
          return snapshot
        })
        .catch((error: unknown) => {
          firstSnapshot = null
          throw error
        })
    }
    const initial = await firstSnapshot
    if (initial.role === role) return initial
  }
  return officeApi<Snapshot>('/snapshot', role)
}
