import '@testing-library/jest-dom'

// jsdom doesn't support SVG methods
if (typeof SVGElement !== 'undefined') {
  SVGElement.prototype.getTotalLength = () => 100
}
