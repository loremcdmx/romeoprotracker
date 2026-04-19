import { describe, expect, it } from 'vitest'
import {
  createTranslator,
  DEFAULT_LANG,
  FORUM_WORD,
  fmtDateShortLang,
  translate,
} from './i18n.js'

describe('i18n helpers', () => {
  const ts = Date.parse('2026-04-19T12:00:00Z') / 1000

  it('translates known keys and falls back to the default language', () => {
    expect(DEFAULT_LANG).toBe('ru')
    expect(translate('en', 'tab_feed')).toBe('Feed')
    expect(translate('de', 'tab_feed')).toBe(translate('ru', 'tab_feed'))
    expect(translate('en', 'missing_key')).toBe('missing_key')
  })

  it('creates language-specific translators', () => {
    const es = createTranslator('es')
    expect(es('tab_topics')).toBe('Temas')
    expect(FORUM_WORD.es).toBe('foro')
  })

  it('formats short dates per language and falls back to Russian months', () => {
    expect(fmtDateShortLang(null, 'ru')).toBe('—')
    expect(fmtDateShortLang(ts, 'ru')).toBe('19 апр')
    expect(fmtDateShortLang(ts, 'en')).toBe('19 Apr')
    expect(fmtDateShortLang(ts, 'es')).toBe('19 abr')
    expect(fmtDateShortLang(ts, 'de')).toBe('19 апр')
  })
})
