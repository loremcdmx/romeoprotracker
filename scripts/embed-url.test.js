import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { EMBED_HOSTS, isSafeEmbedUrl, safeEmbedUrls } from './lib/embed-url.mjs'

describe('isSafeEmbedUrl (FD-8 / DL-3 / DL-7)', () => {
  it('accepts https and protocol-relative embeds on allow-listed hosts', () => {
    for (const src of [
      '//www.youtube.com/embed/DZl0J-eTjz8',
      'https://www.youtube.com/embed/DZl0J-eTjz8',
      'https://www.youtube-nocookie.com/embed/x',
      '//player.vimeo.com/video/1175524410',
      'https://video.gipsyteam.ru/player/embed.php?vid=SN2XD1N41YB4',
      'https://clips.twitch.tv/embed?clip=Abc&parent=www.gipsyteam.ru&autoplay=false',
      'https://player.twitch.tv/?video=1&parent=romeo.fish',
      'https://vk.com/video_ext.php?oid=-5225&id=456241291',
      'https://coub.com/embed/4a54fq',
      'https://rutube.ru/play/embed/abc',
      'HTTPS://WWW.YOUTUBE.COM/embed/x',
      ' //www.youtube.com/embed/x ',
    ]) {
      expect(isSafeEmbedUrl(src), src).toBe(true)
    }
  })

  it('rejects script/data/http schemes, unknown hosts and URL tricks', () => {
    for (const src of [
      'javascript:parent.__pwned=1',
      'JaVaScRiPt:alert(1)',
      'java\nscript:alert(1)',
      '\tjavascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'vbscript:x',
      'blob:https://www.youtube.com/abc',
      'about:blank',
      'http://www.youtube.com/embed/x',
      '//evil.example/embed/x',
      'https://evil.example/embed/x',
      'https://www.youtube.com.evil.example/embed/x',
      'https://evilyoutube.com/embed/x',
      'https://sub.www.youtube.com/embed/x',
      'https://www.youtube.com@evil.example/embed/x',
      'https://user:pw@www.youtube.com/embed/x',
      'https://www.youtube.com:8443/embed/x',
      'https:\\\\www.youtube.com/embed/x',
      'https://www.you tube.com/embed/x',
      '/embed/x',
      'embed/x',
      '',
      '   ',
      null,
      undefined,
      42,
      { href: 'https://www.youtube.com/' },
    ]) {
      expect(isSafeEmbedUrl(src), String(src)).toBe(false)
    }
  })

  it('keeps every video that is in the current dataset (existing data still renders)', () => {
    const posts = JSON.parse(readFileSync(resolve(process.cwd(), 'data/posts.json'), 'utf8'))
    const all = posts.flatMap(p => p.videos || [])
    expect(all.length).toBeGreaterThan(0)
    expect(all.filter(src => !isSafeEmbedUrl(src))).toEqual([])
    const compact = JSON.parse(readFileSync(resolve(process.cwd(), 'data/posts.min.json'), 'utf8'))
    expect(compact.posts.flatMap(p => p.vd || []).filter(src => !isSafeEmbedUrl(src))).toEqual([])
  })

  it('safeEmbedUrls filters lists and tolerates non-arrays', () => {
    expect(safeEmbedUrls(['javascript:x', '//www.youtube.com/embed/a', 'https://evil.example/'])).toEqual(['//www.youtube.com/embed/a'])
    expect(safeEmbedUrls('javascript:alert(1)')).toEqual([])
    expect(safeEmbedUrls(undefined)).toEqual([])
    expect(safeEmbedUrls({ length: 1, 0: '//www.youtube.com/embed/a' })).toEqual([])
  })

  it('has no scheme-ful or wildcard entries in the host list', () => {
    for (const host of EMBED_HOSTS) expect(host).toMatch(/^[a-z0-9.-]+$/)
  })
})
