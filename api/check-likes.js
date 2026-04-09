// Vercel serverless function: check like count & voters for a GipsyTeam post
export default async function handler(req, res) {
  const { pid } = req.query
  if (!pid || !/^\d+$/.test(pid)) {
    return res.status(400).json({ error: 'invalid pid' })
  }

  try {
    // Fetch voters list
    const votersRes = await fetch(
      `https://forum.gipsyteam.ru/index.php?autocom=votes&pid=${pid}`,
      { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(8000) }
    )
    const html = await votersRes.text()

    // Extract voter nicknames from <a class="rating-list--nick">
    const positiveMatch = html.match(/rating-list--positive[\s\S]*?rating-list--inner">([\s\S]*?)(<\/div>)/)
    const voters = []
    if (positiveMatch) {
      const nickRe = /rating-list--nick[^>]*>([^<]+)</g
      let m
      while ((m = nickRe.exec(positiveMatch[1])) !== null) {
        voters.push(m[1].trim())
      }
    }

    // Also fetch the post page to get the numeric rating
    const postRes = await fetch(
      `https://forum.gipsyteam.ru/index.php?viewtopic=181676&view=findpost&p=${pid}`,
      { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(8000) }
    )
    const postHtml = await postRes.text()
    const ratingMatch = postHtml.match(new RegExp(`comment${pid}Rating[^>]*>([\\-\\d]+)<`))
    const likes = ratingMatch ? parseInt(ratingMatch[1]) : voters.length

    res.setHeader('Cache-Control', 'no-cache')
    return res.status(200).json({ pid, likes, voters })
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }
}
