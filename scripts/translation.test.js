import { describe, expect, it, vi } from 'vitest'
import {
  needsTranslation,
  textSignature,
  translatePost,
  translateText,
} from './lib/translation.mjs'

describe('translation helpers', () => {
  it('requires translation when entries are missing or outdated', () => {
    expect(needsTranslation({ text: 'коротко' })).toBe(false)
    expect(needsTranslation({ text: 'Это достаточно длинный пост для перевода.' })).toBe(true)

    const text = 'Это достаточно длинный пост для перевода.'
    const signature = textSignature(text)
    expect(needsTranslation({
      text,
      translations: { ...signature, en: 'Hello', es: 'Hola' },
    })).toBe(false)
    expect(needsTranslation({
      text: `${text} И он изменился.`,
      translations: { ...signature, en: 'Hello', es: 'Hola' },
    })).toBe(true)
  })

  it('updates post translations via Anthropic API client', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ content: [{ text: 'English text' }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ content: [{ text: 'Texto en español' }] }),
      })

    const post = { text: 'Это достаточно длинный пост для перевода.' }
    const changed = await translatePost(post, { apiKey: 'test', fetchImpl })

    expect(changed).toBe(true)
    expect(post.translations).toMatchObject({
      en: 'English text',
      es: 'Texto en español',
    })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('returns null without an API key and skips network calls', async () => {
    const fetchImpl = vi.fn()

    const result = await translateText('Достаточно длинный текст для перевода.', 'en', {
      apiKey: '',
      fetchImpl,
    })

    expect(result).toBeNull()
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('logs and returns null on HTTP errors', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      text: async () => 'Too many requests',
    })

    const result = await translateText('Достаточно длинный текст для перевода.', 'en', {
      apiKey: 'test',
      fetchImpl,
    })

    expect(result).toBeNull()
    expect(logSpy).toHaveBeenCalledTimes(1)
  })

  it('preserves an existing translation when only one target language succeeds', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ content: [{ text: 'Fresh English' }] }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        text: async () => 'Service unavailable',
      })

    const post = {
      text: 'Это достаточно длинный пост для перевода.',
      translations: { en: 'Old English', es: 'Viejo español' },
    }
    const changed = await translatePost(post, { apiKey: 'test', fetchImpl })

    expect(changed).toBe(true)
    expect(post.translations).toEqual({
      ...textSignature(post.text),
      en: 'Fresh English',
      es: 'Viejo español',
    })
  })

  it('does not call the API for short or already translated up-to-date posts', async () => {
    const fetchImpl = vi.fn()

    expect(await translatePost({ text: 'коротко' }, { apiKey: 'test', fetchImpl })).toBe(false)

    const text = 'Это достаточно длинный пост для перевода.'
    const signature = textSignature(text)
    expect(await translatePost({
      text,
      translations: { ...signature, en: 'Hello', es: 'Hola' },
    }, { apiKey: 'test', fetchImpl })).toBe(false)

    expect(fetchImpl).not.toHaveBeenCalled()
  })
})
