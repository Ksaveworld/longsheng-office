import {
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent,
  type KeyboardEvent,
} from 'react'

const WIDTH_KEY = 'office-history-width'
const OPEN_KEY = 'office-history-open'
const MIN_WIDTH = 200
const DEFAULT_WIDTH = 240
function stored(key: string) {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
function save(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* In-page controls still work. */
  }
}

export function useHistoryLayout() {
  const containerRef = useRef<HTMLDivElement>(null)
  const toggleRef = useRef<HTMLButtonElement>(null)
  const [containerWidth, setContainerWidth] = useState(0)
  const [preferredWidth, setPreferredWidth] = useState(() => {
    const width = Number(stored(WIDTH_KEY))
    return Number.isFinite(width) && width >= MIN_WIDTH && width <= 380
      ? width
      : DEFAULT_WIDTH
  })
  const [preference, setPreference] = useState<boolean | null>(() => {
    const value = stored(OPEN_KEY)
    return value === 'true' ? true : value === 'false' ? false : null
  })
  const [overlayOpen, setOverlayOpen] = useState(false)
  const [resizing, setResizing] = useState(false)
  const drag = useRef<{ x: number; width: number; pointer: number } | null>(
    null
  )
  const lastWidth = useRef(preferredWidth)
  useLayoutEffect(() => {
    const node = containerRef.current
    if (!node) return
    const measure = () => setContainerWidth(node.getBoundingClientRect().width)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  const overlay = containerWidth < 760
  const maxWidth = Math.max(MIN_WIDTH, Math.min(380, containerWidth - 466))
  const width = Math.min(preferredWidth, maxWidth)
  const open = overlay ? overlayOpen : (preference ?? containerWidth >= 1100)
  const changeWidth = (value: number, persist = false) => {
    const next = Math.round(Math.max(MIN_WIDTH, Math.min(value, maxWidth)))
    lastWidth.current = next
    setPreferredWidth(next)
    if (persist) save(WIDTH_KEY, String(next))
  }
  const finish = () => {
    if (!drag.current) return
    drag.current = null
    setResizing(false)
    save(WIDTH_KEY, String(lastWidth.current))
  }
  return {
    containerRef,
    toggleRef,
    overlay,
    overlayOpen,
    setOverlayOpen,
    open,
    width,
    maxWidth,
    resizing,
    toggle: () => {
      if (overlay) setOverlayOpen(!overlayOpen)
      else {
        setPreference(!open)
        save(OPEN_KEY, String(!open))
      }
    },
    closeOverlay: () => setOverlayOpen(false),
    resizeProps: {
      onPointerDown: (e: PointerEvent<HTMLDivElement>) => {
        if (e.button !== 0) return
        e.preventDefault()
        e.currentTarget.focus()
        e.currentTarget.setPointerCapture(e.pointerId)
        drag.current = { x: e.clientX, width, pointer: e.pointerId }
        lastWidth.current = width
        setResizing(true)
      },
      onPointerMove: (e: PointerEvent<HTMLDivElement>) => {
        if (drag.current?.pointer === e.pointerId)
          changeWidth(drag.current.width + e.clientX - drag.current.x)
      },
      onPointerUp: finish,
      onPointerCancel: finish,
      onLostPointerCapture: finish,
      onDoubleClick: () => changeWidth(DEFAULT_WIDTH, true),
      onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => {
        const value = {
          ArrowLeft: width - 16,
          ArrowRight: width + 16,
          Home: MIN_WIDTH,
          End: maxWidth,
        }[e.key]
        if (value !== undefined) {
          e.preventDefault()
          changeWidth(value, true)
        }
      },
    },
  }
}
