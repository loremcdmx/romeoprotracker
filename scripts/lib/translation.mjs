const TRANSLATE_MIN_LEN = 20
const TRANSLATE_MODEL = 'claude-haiku-4-5-20251001'

export function textSignature(text) {
  const value = text || ''
  return { srcLen: value.length, srcHead: value.slice(0, 80) }
}

export function needsTranslation(post) {
  if (!post?.text || post.text.trim().length < TRANSLATE_MIN_LEN) return false

  const tr = post.translations
  if (!tr?.en || !tr?.es) return true

  const signature = textSignature(post.text)
  return tr.srcLen !== signature.srcLen || tr.srcHead !== signature.srcHead
}

export async function translateText(text, targetLang, {
  apiKey = process.env.ANTHROPIC_API_KEY,
  fetchImpl = fetch,
  timeoutMs = 60_000,
} = {}) {
  if (!apiKey) return null

  const langName = targetLang === 'en' ? 'English' : 'Spanish'
  const prompt = `Translate the following Russian forum post to ${langName}.

Rules:
- Preserve all [QUOTE]author|date\\n ... [/QUOTE] markers exactly — only translate prose INSIDE the quote body, keep author names and dates untouched.
- Preserve [VIDEO] markers, URLs, numbers (including currencies like $, k, M), poker room names (GG, PS/PokerStars, King, Coin, Lux), and technical abbreviations (BR, MTT, ROI, ITM, ABI).
- Keep the same paragraph breaks and line breaks.
- Output ONLY the translated text. No preface, no explanation, no markdown fences.

Russian text:
${text}`

  const signal = typeof AbortSignal?.timeout === 'function' ? AbortSignal.timeout(timeoutMs) : undefined
  let response
  try {
    response = await fetchImpl('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: TRANSLATE_MODEL,
        max_tokens: 4096,
        messages: [{ role: 'user', content: prompt }],
      }),
      ...(signal ? { signal } : {}),
    })
  } catch (err) {
    console.log(`  ⚠ translate ${targetLang} network error: ${err?.message || err}`)
    return null
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => '')
    console.log(`  ⚠ translate ${targetLang} HTTP ${response.status}: ${errorText.substring(0, 200)}`)
    return null
  }

  let data
  try {
    data = await response.json()
  } catch (err) {
    console.log(`  ⚠ translate ${targetLang} invalid JSON: ${err?.message || err}`)
    return null
  }
  const output = data?.content?.[0]?.text?.trim()
  return output || null
}

export async function translatePost(post, options) {
  if (!needsTranslation(post)) return false

  const signature = textSignature(post.text)
  const tr = post.translations
  const sameText = tr?.srcLen === signature.srcLen && tr?.srcHead === signature.srcHead
  const existingEn = sameText && tr.en ? tr.en : null
  const existingEs = sameText && tr.es ? tr.es : null

  const [en, es] = await Promise.all([
    existingEn ? Promise.resolve(null) : translateText(post.text, 'en', options),
    existingEs ? Promise.resolve(null) : translateText(post.text, 'es', options),
  ])

  if (!en && !es) return false

  post.translations = {
    ...signature,
    en: en || existingEn || null,
    es: es || existingEs || null,
  }

  return true
}
