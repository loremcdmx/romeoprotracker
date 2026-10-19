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

  const response = await fetchImpl('https://api.anthropic.com/v1/messages', {
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
  })

  if (!response.ok) {
    const errorText = await response.text()
    console.log(`  ⚠ translate ${targetLang} HTTP ${response.status}: ${errorText.substring(0, 200)}`)
    return null
  }

  const data = await response.json()
  const output = data.content?.[0]?.text?.trim()
  return output || null
}

export async function translatePost(post, options) {
  if (!needsTranslation(post)) return false

  const [en, es] = await Promise.all([
    translateText(post.text, 'en', options),
    translateText(post.text, 'es', options),
  ])

  if (!en && !es) return false

  const signature = textSignature(post.text)
  // A language whose call failed may fall back to its stored translation only
  // when that translation was made for exactly this text. After a forum edit
  // the old one describes different words, and keeping it under the new
  // signature would hide the gap from needsTranslation forever.
  const tr = post.translations
  const sameText = tr?.srcLen === signature.srcLen && tr?.srcHead === signature.srcHead
  post.translations = {
    ...signature,
    en: en || (sameText ? tr.en : null) || null,
    es: es || (sameText ? tr.es : null) || null,
  }

  return true
}
