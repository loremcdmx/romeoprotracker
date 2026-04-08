import '@testing-library/jest-dom'

// jsdom doesn't support SVG methods
if (typeof SVGElement !== 'undefined') {
  SVGElement.prototype.getTotalLength = () => 100
}

// jsdom doesn't support matchMedia
if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = query => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })
}
