import { useCallback, useEffect, useId } from 'react'

const HOVER_POPUP_EVENT = 'rpt:hover-popup-open'

export function useExclusiveHoverPopup(onForeignOpen) {
  const popupId = useId()
  const owner = `rpt-hover-${popupId}`

  const announceOpen = useCallback(() => {
    if (typeof window === 'undefined') return
    window.dispatchEvent(new CustomEvent(HOVER_POPUP_EVENT, {
      detail: { owner },
    }))
  }, [owner])

  useEffect(() => {
    if (typeof window === 'undefined') return undefined

    const handleOpen = (event) => {
      if (event.detail?.owner === owner) return
      onForeignOpen?.()
    }

    window.addEventListener(HOVER_POPUP_EVENT, handleOpen)
    return () => window.removeEventListener(HOVER_POPUP_EVENT, handleOpen)
  }, [owner, onForeignOpen])

  return { announceOpen }
}
