import { describe, expect, it } from 'vitest'
import {
  addIgnoredAuthor, authorKey, ignoredKeySet, isIgnoredAuthor, removeIgnoredAuthor,
} from './ignoredAuthors.js'

describe('ignored authors matching', () => {
  it('compares case-insensitively and ignores surrounding whitespace', () => {
    const ignored = new Set(['ШАШИСТ', '  Troll  '])
    expect(isIgnoredAuthor(ignored, 'шашист')).toBe(true)
    expect(isIgnoredAuthor(ignored, 'Шашист ')).toBe(true)
    expect(isIgnoredAuthor(ignored, 'TROLL')).toBe(true)
    expect(isIgnoredAuthor(ignored, 'Trolley')).toBe(false)
  })

  it('never matches a missing author, even if the stored list holds a blank entry', () => {
    const ignored = new Set(['', '   '])
    expect(isIgnoredAuthor(ignored, '')).toBe(false)
    expect(isIgnoredAuthor(ignored, null)).toBe(false)
    expect(isIgnoredAuthor(ignored, undefined)).toBe(false)
    expect(ignoredKeySet(ignored).size).toBe(0)
  })

  it('tolerates a missing list', () => {
    expect(isIgnoredAuthor(undefined, 'x')).toBe(false)
    expect(isIgnoredAuthor(null, 'x')).toBe(false)
  })

  it('normalises each list once and rebuilds when the list changes', () => {
    const ignored = new Set(['A'])
    const first = ignoredKeySet(ignored)
    expect(ignoredKeySet(ignored)).toBe(first)
    const next = addIgnoredAuthor(ignored, 'B')
    expect(ignoredKeySet(next)).not.toBe(first)
    expect(isIgnoredAuthor(next, 'b')).toBe(true)
    // an in-place edit is noticed too (size differs)
    ignored.add('C')
    expect(isIgnoredAuthor(ignored, 'c')).toBe(true)
  })

  it('stores the typed value for display and does not add a second spelling', () => {
    const empty = new Set()
    const added = addIgnoredAuthor(empty, '  ШАШИСТ ')
    expect([...added]).toEqual(['ШАШИСТ'])
    expect(empty.size).toBe(0)
    expect(addIgnoredAuthor(added, 'шашист')).toBe(added)
    expect(addIgnoredAuthor(added, '   ')).toBe(added)
  })

  it('removes every stored spelling of the author', () => {
    const ignored = new Set(['TROLL', 'troll', 'Other'])
    expect([...removeIgnoredAuthor(ignored, 'Troll')]).toEqual(['Other'])
    expect(removeIgnoredAuthor(ignored, 'nobody')).toBe(ignored)
    expect(removeIgnoredAuthor(ignored, '')).toBe(ignored)
  })

  it('exposes the normalisation rule', () => {
    expect(authorKey('  MiXed ')).toBe('mixed')
    expect(authorKey(null)).toBe('')
  })
})
