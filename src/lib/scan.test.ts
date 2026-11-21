import { describe, expect, it } from 'vitest'
import { SAMPLE_HEADERS, SAMPLE_HTML, SAMPLE_SITE, audit, clientSentence, hostOf, normalizeSite, parseHeaders, registrable, resourceUrls, scanHtml, serviceFor } from './scan'

const clean = `<!doctype html><html lang="el"><head><meta charset="utf-8"><title>Τίτλος</title><meta name="viewport" content="width=device-width"><meta name="description" content="Μια περιγραφή."><link rel="stylesheet" href="/a.css"><script src="/app.js"></script></head><body><h1>Γεια</h1><img src="/x.png" alt="x"></body></html>`
const goodHeaders = 'strict-transport-security: max-age=31536000\ncontent-security-policy: default-src \'self\'; frame-ancestors \'none\'\nx-content-type-options: nosniff\nreferrer-policy: no-referrer'

describe('hosts', () => {
  it('finds the registrable domain, including .com.gr', () => {
    expect(registrable('www.shop.example.gr')).toBe('example.gr')
    expect(registrable('www.example.com.gr')).toBe('example.com.gr')
    expect(registrable('example.gr')).toBe('example.gr')
  })
  it('resolves relative and protocol-relative URLs against the site', () => {
    expect(hostOf('/a.css', 'https://example.gr/')).toBe('example.gr')
    expect(hostOf('//cdn.example.org/x.js', 'https://example.gr/')).toBe('cdn.example.org')
    expect(hostOf('http://[bad', 'https://example.gr/')).toBeNull()
  })
  it('matches services by suffix only', () => {
    expect(serviceFor('www.googletagmanager.com')?.name).toBe('Google Tag Manager')
    expect(serviceFor('notgoogletagmanager.com')).toBeUndefined()
    expect(serviceFor('www.youtube-nocookie.com')?.category).toBe('video')
  })
  it('normalises what people type', () => {
    expect(normalizeSite('https://www.example.gr/menu')).toBe('example.gr')
    expect(normalizeSite('example.gr')).toBe('example.gr')
    expect(normalizeSite('')).toBeNull()
    expect(normalizeSite('localhost')).toBeNull()
  })
})

describe('html scanning', () => {
  it('reads attributes in all quoting styles and ignores commented-out tags', () => {
    const { tags } = scanHtml(`<!-- <script src="https://ads.example/x.js"></script> --><img src='a.png' alt=""><script src=b.js defer></script>`)
    expect(tags.find((t) => t.name === 'img')?.attrs).toEqual({ src: 'a.png', alt: '' })
    expect(tags.find((t) => t.name === 'script')?.attrs.src).toBe('b.js')
    expect(tags.some((t) => t.attrs.src?.includes('ads.example'))).toBe(false)
  })
  it('collects resource URLs from srcset and skips data URIs, anchors and plain links', () => {
    const { tags } = scanHtml(`<img srcset="a.jpg 1x, https://cdn.x.com/b.jpg 2x"><img src="data:image/png;base64,AA"><a href="https://facebook.com/x">f</a><link rel="canonical" href="https://x.gr/"><link rel="stylesheet" href="s.css">`)
    expect(resourceUrls(tags).map((r) => r.url)).toEqual(['a.jpg', 'https://cdn.x.com/b.jpg', 's.css'])
  })
  it('does not treat text inside scripts as markup', () => {
    const { tags, inlineScripts } = scanHtml(`<script>document.write('<img src="https://evil.example/p.png">')</script>`)
    expect(tags.filter((t) => t.name === 'img')).toHaveLength(0)
    expect(inlineScripts[0]).toContain('document.write')
  })
  it('survives broken markup', () => {
    expect(() => scanHtml('<div <img src= <<<>>> <script')).not.toThrow()
    expect(scanHtml('').tags).toEqual([])
  })
})

describe('headers', () => {
  it('parses names case-insensitively and keeps repeated Set-Cookie lines', () => {
    const h = parseHeaders('HTTP/2 200\r\nSet-Cookie: a=1\r\nSet-Cookie: b=2\r\nX-Frame-Options: DENY')
    expect(h.get('set-cookie')).toEqual(['a=1', 'b=2'])
    expect(h.has('x-frame-options')).toBe(true)
    expect(h.size).toBe(2)
  })
})

describe('audit', () => {
  it('gives a clean, header-complete page a perfect score and no findings', () => {
    const r = audit('example.gr', clean, goodHeaders)
    expect(r.findings).toEqual([])
    expect(r.score).toBe(100)
    expect(r.thirdParties).toEqual([])
    expect(clientSentence(r)).toMatch(/δεν στέλνει στοιχεία/)
  })
  it('does not complain about headers nobody provided', () => {
    const r = audit('example.gr', clean)
    expect(r.headersProvided).toBe(false)
    expect(r.missingHeaders).toEqual([])
    expect(r.score).toBe(100)
  })
  it('flags the sample: fonts, trackers inside inline code, embeds, cookies', () => {
    const r = audit(SAMPLE_SITE, SAMPLE_HTML, SAMPLE_HEADERS)
    const ids = r.findings.map((f) => f.id)
    expect(ids).toContain('fonts')
    expect(ids).toContain('track-www.googletagmanager.com')
    expect(ids).toContain('track-connect.facebook.net')
    expect(ids.some((i) => i.startsWith('video-'))).toBe(true)
    expect(ids.some((i) => i.startsWith('maps-'))).toBe(false) // google.com/maps is a plain google.com embed, categorised "other"
    expect(ids).toContain('cookies')
    expect(ids).toContain('desc')
    expect(ids).toContain('hdr-strict-transport-security')
    expect(r.cookies.map((c) => c.name)).toEqual(expect.arrayContaining(['session', '_ga', '_gid', '_fbp']))
    expect(r.thirdParties.length).toBeGreaterThanOrEqual(5)
    expect(r.score).toBeLessThan(70)
    expect(r.findings[0].level).toBe('attention') // worst first
  })
  it('detects a tracker started only from inline code', () => {
    const r = audit('example.gr', `<html lang="el"><head><title>t</title><meta name="viewport" content="x"><meta name="description" content="d"><script>gtag('config','G-1')</script></head><body><h1>x</h1></body></html>`)
    expect(r.thirdParties.map((t) => t.name)).toEqual(['Google Analytics'])
  })
  it('does not count the site\'s own subdomains as third parties', () => {
    const r = audit('example.gr', clean.replace('/a.css', 'https://static.example.gr/a.css'))
    expect(r.thirdParties).toEqual([])
  })
  it('catches mixed content and missing alt, h1 and lang', () => {
    const r = audit('example.gr', '<html><head><title>t</title></head><body><img src="http://example.gr/a.png"><h1>a</h1><h1>b</h1></body></html>')
    const ids = r.findings.map((f) => f.id)
    expect(ids).toEqual(expect.arrayContaining(['mixed', 'alt', 'h1', 'lang', 'viewport', 'desc']))
  })
  it('accepts frame-ancestors in the CSP as frame protection', () => {
    const r = audit('example.gr', clean, goodHeaders)
    expect(r.missingHeaders).toEqual([])
    const noFrame = audit('example.gr', clean, goodHeaders.replace("; frame-ancestors 'none'", ''))
    expect(noFrame.missingHeaders).toContain('X-Frame-Options / frame-ancestors')
  })
  it('flags cookies without Secure, HttpOnly and SameSite', () => {
    const r = audit('example.gr', clean, goodHeaders + '\nset-cookie: a=1; Path=/\nset-cookie: b=2; Secure; HttpOnly; SameSite=Lax')
    expect(r.findings.filter((f) => f.id.startsWith('cookie-')).map((f) => f.subject)).toEqual(['a'])
  })
  it('caps what each severity can subtract, so the score never goes below zero', () => {
    const many = Array.from({ length: 30 }, (_, i) => `<img src="http://h${i}.example.org/a.png">`).join('')
    const r = audit('example.gr', `<html><body>${many}</body></html>`, 'x-test: 1')
    expect(r.score).toBeGreaterThanOrEqual(0)
    expect(r.score).toBeLessThan(100)
  })
  it('builds a plain sentence for the client', () => {
    const r = audit(SAMPLE_SITE, SAMPLE_HTML, SAMPLE_HEADERS)
    expect(clientSentence(r)).toContain(`${r.thirdParties.length} εξωτερικές υπηρεσίες`)
  })
})
