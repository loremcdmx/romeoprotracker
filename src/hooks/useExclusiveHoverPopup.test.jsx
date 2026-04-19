import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { useExclusiveHoverPopup } from './useExclusiveHoverPopup.js'

function PopupProbe({ name, onForeignOpen }) {
  const [foreignCount, setForeignCount] = useState(0)
  const { announceOpen } = useExclusiveHoverPopup(() => {
    setForeignCount((value) => value + 1)
    onForeignOpen?.()
  })

  return (
    <div>
      <button onMouseEnter={announceOpen}>{name}</button>
      <output data-testid={`count-${name}`}>{foreignCount}</output>
    </div>
  )
}

function ToggleHarness({ onForeignOpenB }) {
  const [showB, setShowB] = useState(true)

  return (
    <div>
      <PopupProbe name="a" />
      <button onClick={() => setShowB(false)}>hide-b</button>
      {showB && <PopupProbe name="b" onForeignOpen={onForeignOpenB} />}
    </div>
  )
}

describe('useExclusiveHoverPopup', () => {
  it('closes only foreign hover popups when a new popup opens', () => {
    render(
      <div>
        <PopupProbe name="a" />
        <PopupProbe name="b" />
      </div>,
    )

    fireEvent.mouseEnter(screen.getByText('a'))
    expect(screen.getByTestId('count-a')).toHaveTextContent('0')
    expect(screen.getByTestId('count-b')).toHaveTextContent('1')

    fireEvent.mouseEnter(screen.getByText('b'))
    expect(screen.getByTestId('count-a')).toHaveTextContent('1')
    expect(screen.getByTestId('count-b')).toHaveTextContent('1')
  })

  it('removes listeners on unmount so hidden popups stop reacting', () => {
    const onForeignOpenB = vi.fn()

    render(<ToggleHarness onForeignOpenB={onForeignOpenB} />)

    fireEvent.click(screen.getByText('hide-b'))
    fireEvent.mouseEnter(screen.getByText('a'))

    expect(onForeignOpenB).not.toHaveBeenCalled()
  })
})
