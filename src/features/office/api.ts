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

function waitForReadRetry(signal?: AbortSignal) {
  signal?.throwIfAborted()
  return new Promise<void>((resolve, reject) => {
    const aborted = () => {
      clearTimeout(timer)
      reject(signal?.reason || new DOMException('Aborted', 'AbortError'))
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', aborted)
      resolve()
    }, 300)
    signal?.addEventListener('abort', aborted, { once: true })
  })
}

export async function officeApi<T>(
  path: string,
  role: Role,
  body?: unknown,
  signal?: AbortSignal
): Promise<T> {
  const matterId =
    new URLSearchParams(location.hash.split('?')[1] || '').get('id') ||
    sessionStorage.getItem('office-current-matter') ||
    'SUP-001'
  const url = `${import.meta.env.BASE_URL}api/office${path}${path.includes('?') ? '&' : '?'}matterId=${encodeURIComponent(matterId)}`
  const readOnly = body === undefined
  const options: RequestInit = {
    signal,
    method: readOnly ? 'GET' : 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-Demo-Role': role },
    ...(readOnly ? {} : { body: JSON.stringify(body) }),
  }
  let response: Response
  // Keep the original URL and role across the one permitted read retry, even
  // when the user changes matters while the request is waiting.
  for (let attempt = 0; ; attempt++) {
    signal?.throwIfAborted()
    try {
      response = await fetch(url, options)
    } catch (failure) {
      if (
        readOnly &&
        attempt === 0 &&
        !signal?.aborted &&
        failure instanceof TypeError
      ) {
        await waitForReadRetry(signal)
        continue
      }
      throw failure
    }
    if (
      readOnly &&
      attempt === 0 &&
      [502, 503, 504].includes(response.status)
    ) {
      await response.body?.cancel()
      await waitForReadRetry(signal)
      continue
    }
    break
  }
  let data: unknown
  try {
    data = await response.json()
  } catch {
    throw new OfficeError(
      '暂时无法读取服务响应，请重试。',
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
    ? error.message
    : error instanceof Error
      ? error.message
      : '请求失败，请重试。'

let workspaceInitialized = false
let firstSnapshot: Promise<Snapshot> | null = null

// The first response establishes the workspace cookie. Sharing this request also
// prevents React StrictMode's duplicate mount effects from creating two spaces.
export async function getOfficeSnapshot(role: Role): Promise<Snapshot> {
  const requestedMatter =
    new URLSearchParams(location.hash.split('?')[1] || '').get('id') ||
    sessionStorage.getItem('office-current-matter') ||
    'SUP-001'
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
    if (initial.role === role && initial.state.matter.id === requestedMatter)
      return initial
  }
  return officeApi<Snapshot>('/snapshot', role)
}
