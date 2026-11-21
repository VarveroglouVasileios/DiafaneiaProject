/**
 * Website audit from the page's HTML and (optionally) its response headers.
 * Pure functions: the HTML is only parsed as text, never executed or inserted into the page.
 */

export type Level = 'attention' | 'consent' | 'improve'
export type Category = 'fonts' | 'analytics' | 'ads' | 'social' | 'video' | 'maps' | 'cdn' | 'other'

export interface Finding {
  id: string
  level: Level
  title: string
  detail: string
  /** What it affects, e.g. a host name or a header. */
  subject: string
  /** What to do about it. */
  fix: string
}

export interface Report {
  site: string
  thirdParties: { host: string; name: string; category: Category }[]
  cookies: { name: string; source: 'header' | 'tracker' }[]
  missingHeaders: string[]
  findings: Finding[]
  score: number
  headersProvided: boolean
}

interface Service { match: string; name: string; category: Category; cookies?: string[] }

/** Known services by hostname suffix. Cookies listed are the ones these scripts are known to set once they run. */
export const SERVICES: Service[] = [
  { match: 'fonts.googleapis.com', name: 'Google Fonts', category: 'fonts' },
  { match: 'fonts.gstatic.com', name: 'Google Fonts', category: 'fonts' },
  { match: 'googletagmanager.com', name: 'Google Tag Manager', category: 'analytics', cookies: ['_ga', '_gid'] },
  { match: 'google-analytics.com', name: 'Google Analytics', category: 'analytics', cookies: ['_ga', '_gid'] },
  { match: 'connect.facebook.net', name: 'Meta Pixel', category: 'ads', cookies: ['_fbp'] },
  { match: 'facebook.com', name: 'Facebook', category: 'social' },
  { match: 'doubleclick.net', name: 'Google Ads', category: 'ads', cookies: ['IDE'] },
  { match: 'googlesyndication.com', name: 'Google Ads', category: 'ads' },
  { match: 'hotjar.com', name: 'Hotjar', category: 'analytics', cookies: ['_hjSessionUser'] },
  { match: 'youtube-nocookie.com', name: 'YouTube (privacy mode)', category: 'video' },
  { match: 'youtube.com', name: 'YouTube', category: 'video', cookies: ['VISITOR_INFO1_LIVE'] },
  { match: 'ytimg.com', name: 'YouTube', category: 'video' },
  { match: 'vimeo.com', name: 'Vimeo', category: 'video' },
  { match: 'maps.googleapis.com', name: 'Google Maps', category: 'maps' },
  { match: 'google.com', name: 'Google', category: 'other' },
  { match: 'gstatic.com', name: 'Google (static)', category: 'cdn' },
  { match: 'cdnjs.cloudflare.com', name: 'cdnjs', category: 'cdn' },
  { match: 'jsdelivr.net', name: 'jsDelivr', category: 'cdn' },
  { match: 'unpkg.com', name: 'unpkg', category: 'cdn' },
  { match: 'cloudflare.com', name: 'Cloudflare', category: 'cdn' },
  { match: 'twitter.com', name: 'X (Twitter)', category: 'social' },
  { match: 'instagram.com', name: 'Instagram', category: 'social' },
  { match: 'tiktok.com', name: 'TikTok', category: 'ads', cookies: ['_ttp'] },
]

export const SECOND_LEVEL = new Set(['com.gr', 'org.gr', 'net.gr', 'gov.gr', 'edu.gr', 'co.uk', 'org.uk'])

export const registrable = (host: string): string => {
  const parts = host.toLowerCase().replace(/\.$/, '').split('.')
  if (parts.length <= 2) return parts.join('.')
  const last2 = parts.slice(-2).join('.')
  return SECOND_LEVEL.has(last2) ? parts.slice(-3).join('.') : last2
}

export const hostOf = (url: string, base?: string): string | null => {
  try {
    return new URL(url, base).hostname.toLowerCase()
  } catch {
    return null
  }
}

export const serviceFor = (host: string): Service | undefined => SERVICES.find((s) => host === s.match || host.endsWith('.' + s.match))

// --- HTML scanning -----------------------------------------------------------

export interface Tag { name: string; attrs: Record<string, string> }

const ATTR = /([a-zA-Z_:][\w:.-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g

/** Reads start tags with their attributes. Comments are removed first and script/style bodies are returned separately. */
export function scanHtml(html: string): { tags: Tag[]; inlineScripts: string[]; text: string } {
  const noComments = html.replace(/<!--[\s\S]*?-->/g, '')
  const inlineScripts: string[] = []
  const stripped = noComments.replace(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi, (_m, attrs: string, body: string) => {
    if (body.trim()) inlineScripts.push(body)
    return `<script ${attrs}></script>`
  }).replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
  const tags: Tag[] = []
  const re = /<([a-zA-Z][a-zA-Z0-9-]*)\b([^>]*)>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(stripped))) {
    const attrs: Record<string, string> = {}
    let a: RegExpExecArray | null
    ATTR.lastIndex = 0
    while ((a = ATTR.exec(m[2]))) attrs[a[1].toLowerCase()] = a[2] ?? a[3] ?? a[4] ?? ''
    tags.push({ name: m[1].toLowerCase(), attrs })
  }
  return { tags, inlineScripts, text: stripped }
}

const URL_ATTR: Record<string, string[]> = { script: ['src'], link: ['href'], img: ['src', 'srcset'], iframe: ['src'], source: ['src'], video: ['src', 'poster'], audio: ['src'], embed: ['src'], object: ['data'] }

export function resourceUrls(tags: Tag[]): { url: string; tag: string }[] {
  const out: { url: string; tag: string }[] = []
  for (const t of tags) {
    if (t.name === 'link' && !/(stylesheet|preload|preconnect|dns-prefetch|icon|modulepreload|prefetch)/i.test(t.attrs.rel ?? '')) continue
    for (const a of URL_ATTR[t.name] ?? []) {
      const v = t.attrs[a]
      if (!v) continue
      if (a === 'srcset') for (const part of v.split(',')) out.push({ url: part.trim().split(/\s+/)[0], tag: t.name })
      else out.push({ url: v.trim(), tag: t.name })
    }
  }
  return out.filter((r) => r.url && !r.url.startsWith('data:') && !r.url.startsWith('#') && !r.url.startsWith('javascript:'))
}

// --- headers -----------------------------------------------------------------

export function parseHeaders(text: string): Map<string, string[]> {
  const map = new Map<string, string[]>()
  for (const line of text.replace(/\r/g, '').split('\n')) {
    const i = line.indexOf(':')
    if (i <= 0 || /^HTTP\//i.test(line)) continue
    const k = line.slice(0, i).trim().toLowerCase()
    if (!/^[a-z0-9-]+$/.test(k)) continue
    map.set(k, [...(map.get(k) ?? []), line.slice(i + 1).trim()])
  }
  return map
}

export const SECURITY_HEADERS: { key: string; label: string; why: string; fix: string }[] = [
  { key: 'strict-transport-security', label: 'Strict-Transport-Security', why: 'Ο browser δεν υποχρεώνεται να χρησιμοποιεί πάντα HTTPS.', fix: 'Μικρή αλλαγή στις ρυθμίσεις του server: Strict-Transport-Security: max-age=31536000.' },
  { key: 'content-security-policy', label: 'Content-Security-Policy', why: 'Δεν περιορίζεται από πού μπορούν να φορτώνουν scripts και εικόνες.', fix: 'Ορίστε πολιτική που επιτρέπει μόνο τις πηγές που χρησιμοποιεί πραγματικά η σελίδα.' },
  { key: 'x-content-type-options', label: 'X-Content-Type-Options', why: 'Ο browser μπορεί να «μαντέψει» τον τύπο αρχείων.', fix: 'Προσθέστε X-Content-Type-Options: nosniff.' },
  { key: 'referrer-policy', label: 'Referrer-Policy', why: 'Διευθύνσεις σελίδων μπορεί να φεύγουν προς τρίτους.', fix: 'Προσθέστε Referrer-Policy: strict-origin-when-cross-origin ή αυστηρότερο.' },
]

const hasFrameProtection = (h: Map<string, string[]>): boolean => h.has('x-frame-options') || /frame-ancestors/i.test((h.get('content-security-policy') ?? []).join(';'))

// --- the audit ---------------------------------------------------------------

const lvl = (l: Level): number => (l === 'attention' ? 10 : l === 'consent' ? 6 : 3)
const CAP: Record<Level, number> = { attention: 40, consent: 24, improve: 24 }

export function normalizeSite(input: string): string | null {
  const s = input.trim()
  if (!s) return null
  try {
    const u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`)
    if (!u.hostname.includes('.')) return null
    return u.hostname.replace(/^www\./, '')
  } catch {
    return null
  }
}

export function audit(site: string, html: string, headersText = ''): Report {
  const base = `https://${site}/`
  const siteReg = registrable(site)
  const { tags, inlineScripts } = scanHtml(html)
  const findings: Finding[] = []
  const add = (f: Finding): void => void findings.push(f)

  // third parties
  const seen = new Map<string, { host: string; name: string; category: Category }>()
  const mixed: string[] = []
  for (const r of resourceUrls(tags)) {
    const host = hostOf(r.url, base)
    if (!host) continue
    if (/^http:\/\//i.test(r.url) && r.tag !== 'a') mixed.push(r.url)
    if (registrable(host) === siteReg) continue
    const svc = serviceFor(host)
    if (!seen.has(host)) seen.set(host, { host, name: svc?.name ?? host, category: svc?.category ?? 'other' })
  }
  // trackers that are started from inline code (gtag, fbq) even without a src we can see
  const inline = inlineScripts.join('\n')
  const inlineSignals: { re: RegExp; host: string }[] = [
    { re: /\bgtag\s*\(|GoogleAnalyticsObject|\bga\s*\(\s*['"]create/, host: 'google-analytics.com' },
    { re: /\bfbq\s*\(/, host: 'connect.facebook.net' },
    { re: /\bhj\s*\(/, host: 'hotjar.com' },
  ]
  for (const s of inlineSignals) if (s.re.test(inline) && ![...seen.keys()].some((h) => serviceFor(h) === serviceFor(s.host))) seen.set(s.host, { host: s.host, name: serviceFor(s.host)!.name, category: serviceFor(s.host)!.category })
  const thirdParties = [...seen.values()].sort((a, b) => a.host.localeCompare(b.host))

  const fonts = thirdParties.filter((t) => t.category === 'fonts')
  if (fonts.length)
    add({ id: 'fonts', level: 'attention', title: 'Google Fonts', subject: fonts.map((f) => f.host).join(', '), detail: 'Η διεύθυνση IP του επισκέπτη φεύγει προς τρίτο.', fix: 'Οι γραμματοσειρές φιλοξενούνται στο ίδιο το site.' })

  const trackers = thirdParties.filter((t) => t.category === 'analytics' || t.category === 'ads')
  for (const t of trackers)
    add({ id: `track-${t.host}`, level: 'consent', title: t.category === 'ads' ? `Διαφημιστικό εργαλείο: ${t.name}` : `Εργαλείο στατιστικών: ${t.name}`, subject: t.host, detail: 'Φορτώνει χωρίς να φαίνεται ότι ζητείται συγκατάθεση.', fix: 'Φόρτωση μετά την αποδοχή, ή εργαλείο χωρίς cookies.' })
  for (const t of thirdParties.filter((x) => x.category === 'video' && serviceFor(x.host)?.cookies))
    add({ id: `video-${t.host}`, level: 'consent', title: `Ενσωματωμένο βίντεο: ${t.name}`, subject: t.host, detail: 'Το πρόγραμμα αναπαραγωγής μπορεί να βάζει cookies πριν πατηθεί «Αναπαραγωγή».', fix: 'Χρησιμοποιήστε τη λειτουργία χωρίς cookies (youtube-nocookie.com) ή σύνδεσμο αντί για ενσωμάτωση.' })
  for (const t of thirdParties.filter((x) => x.category === 'maps'))
    add({ id: `maps-${t.host}`, level: 'consent', title: `Χάρτης: ${t.name}`, subject: t.host, detail: 'Φορτώνει υπηρεσία τρίτου με την επίσκεψη.', fix: 'Εμφανίστε το χάρτη μετά από κλικ του επισκέπτη.' })

  // cookies
  const headers = parseHeaders(headersText)
  const headersProvided = headers.size > 0
  const cookies: Report['cookies'] = []
  for (const sc of headers.get('set-cookie') ?? []) {
    const name = sc.split('=')[0].trim()
    if (name) cookies.push({ name, source: 'header' })
    const flags = sc.toLowerCase()
    if (!/;\s*secure/.test(flags) || !/;\s*httponly/.test(flags) || !/;\s*samesite=/.test(flags))
      add({ id: `cookie-${name}`, level: 'improve', title: `Cookie χωρίς όλες τις σημαίες: ${name}`, subject: name, detail: 'Λείπει Secure, HttpOnly ή SameSite.', fix: 'Προσθέστε Secure; HttpOnly; SameSite=Lax όπου δεν χρειάζεται πρόσβαση από JavaScript.' })
  }
  for (const t of thirdParties) for (const c of serviceFor(t.host)?.cookies ?? []) if (!cookies.some((x) => x.name === c)) cookies.push({ name: c, source: 'tracker' })
  if (cookies.some((c) => c.source === 'tracker'))
    add({ id: 'cookies', level: 'consent', title: 'Cookies πριν τη συναίνεση', subject: cookies.filter((c) => c.source === 'tracker').map((c) => c.name).join(' · '), detail: 'Τα εργαλεία που εντοπίστηκαν βάζουν συνήθως αυτά τα cookies από την πρώτη επίσκεψη (εκτίμηση από τον κώδικα, όχι μέτρηση).', fix: 'Μην ξεκινάτε εργαλεία παρακολούθησης πριν την αποδοχή.' })

  // security headers
  const missingHeaders: string[] = []
  if (headersProvided) {
    for (const h of SECURITY_HEADERS) if (!headers.has(h.key)) {
      missingHeaders.push(h.label)
      add({ id: `hdr-${h.key}`, level: 'improve', title: `${h.label} λείπει`, subject: h.label, detail: h.why, fix: h.fix })
    }
    if (!hasFrameProtection(headers)) {
      missingHeaders.push('X-Frame-Options / frame-ancestors')
      add({ id: 'hdr-frame', level: 'improve', title: 'Προστασία από ενσωμάτωση σε ξένη σελίδα λείπει', subject: 'X-Frame-Options', detail: 'Η σελίδα μπορεί να μπει μέσα σε πλαίσιο άλλου site (clickjacking).', fix: 'Προσθέστε X-Frame-Options: DENY ή frame-ancestors στο CSP.' })
    }
  }
  if (mixed.length)
    add({ id: 'mixed', level: 'attention', title: 'Πόροι μέσω http:// σε σελίδα https', subject: mixed.slice(0, 2).join(', '), detail: 'Οι browsers μπλοκάρουν ή προειδοποιούν για μικτό περιεχόμενο.', fix: 'Αλλάξτε τις διευθύνσεις σε https://.' })

  // basic SEO / accessibility signals
  const meta = (n: string): string | undefined => tags.find((t) => t.name === 'meta' && (t.attrs.name ?? '').toLowerCase() === n)?.attrs.content
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)
  const title = titleMatch?.[1].trim() ?? ''
  if (!meta('description')?.trim())
    add({ id: 'desc', level: 'improve', title: 'Περιγραφή για αναζήτηση', subject: 'meta description', detail: 'Δεν υπάρχει. Η Google θα διαλέξει μόνη της ένα κομμάτι κειμένου.', fix: 'Γράψτε περιγραφή 70–160 χαρακτήρων.' })
  if (!title) add({ id: 'title', level: 'improve', title: 'Λείπει ο τίτλος της σελίδας', subject: '<title>', detail: 'Χωρίς τίτλο, η σελίδα εμφανίζεται άσχημα στα αποτελέσματα και στις καρτέλες.', fix: 'Προσθέστε σύντομο, περιγραφικό τίτλο.' })
  if (!meta('viewport')) add({ id: 'viewport', level: 'improve', title: 'Λείπει το viewport για κινητά', subject: 'meta viewport', detail: 'Στο κινητό η σελίδα μπορεί να εμφανίζεται μικρογραμμένη.', fix: 'Προσθέστε <meta name="viewport" content="width=device-width, initial-scale=1">.' })
  const htmlTag = tags.find((t) => t.name === 'html')
  if (!htmlTag?.attrs.lang) add({ id: 'lang', level: 'improve', title: 'Δεν δηλώνεται γλώσσα', subject: '<html lang>', detail: 'Οι αναγνώστες οθόνης και οι μηχανές αναζήτησης δεν ξέρουν τη γλώσσα.', fix: 'Προσθέστε lang="el" στο <html>.' })
  const noAlt = tags.filter((t) => t.name === 'img' && !('alt' in t.attrs)).length
  if (noAlt) add({ id: 'alt', level: 'improve', title: `${noAlt} ${noAlt === 1 ? 'εικόνα' : 'εικόνες'} χωρίς εναλλακτικό κείμενο`, subject: '<img alt>', detail: 'Οι χρήστες με αναγνώστη οθόνης δεν ακούν τι δείχνει η εικόνα.', fix: 'Προσθέστε alt (κενό alt="" για διακοσμητικές).' })
  const h1 = tags.filter((t) => t.name === 'h1').length
  if (h1 !== 1) add({ id: 'h1', level: 'improve', title: h1 === 0 ? 'Λείπει ο κύριος τίτλος (h1)' : `${h1} κύριοι τίτλοι (h1)`, subject: '<h1>', detail: 'Η σελίδα πρέπει να έχει έναν κύριο τίτλο.', fix: 'Κρατήστε ακριβώς ένα h1.' })

  // score: each level has a cap so one noisy kind of finding cannot zero the page
  const lost: Record<Level, number> = { attention: 0, consent: 0, improve: 0 }
  for (const f of findings) lost[f.level] = Math.min(CAP[f.level], lost[f.level] + lvl(f.level))
  const score = Math.max(0, 100 - lost.attention - lost.consent - lost.improve)

  const order: Record<Level, number> = { attention: 0, consent: 1, improve: 2 }
  findings.sort((a, b) => order[a.level] - order[b.level])
  return { site, thirdParties, cookies, missingHeaders, findings, score, headersProvided }
}

export const SYMBOL: Record<Level, string> = { attention: '▲', consent: '■', improve: '●' }

/** One sentence to say to the client. */
export function clientSentence(r: Report): string {
  const n = r.thirdParties.length
  const easy = r.findings.filter((f) => f.level !== 'improve').length
  if (!n && !r.findings.length) return '«Η σελίδα σας δεν στέλνει στοιχεία σε τρίτους και δεν βρέθηκαν σοβαρά προβλήματα.»'
  if (!n) return `«Η σελίδα σας δεν καλεί εξωτερικές υπηρεσίες. Βρέθηκαν ${r.findings.length} μικρές βελτιώσεις.»`
  return `«Η σελίδα σας στέλνει στοιχεία των επισκεπτών σε ${n} ${n === 1 ? 'εξωτερική υπηρεσία' : 'εξωτερικές υπηρεσίες'}.${easy ? ` Οι ${Math.min(easy, 2)} πιο σημαντικές διορθώνονται σε μία ημέρα.` : ''}»`
}

export const SAMPLE_SITE = 'paradeigma-estiatorio.gr'
export const SAMPLE_HTML = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>Εστιατόριο Παράδειγμα</title>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Lato&display=swap">
  <link rel="stylesheet" href="/css/main.css">
  <script async src="https://www.googletagmanager.com/gtag/js?id=G-XXXXXXX"></script>
  <script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)};gtag('js',new Date());gtag('config','G-XXXXXXX');</script>
  <script>!function(f,b,e,v,n,t,s){}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','000000000000000');fbq('track','PageView');</script>
</head>
<body>
  <h1>Εστιατόριο Παράδειγμα</h1>
  <img src="/img/hero.jpg">
  <img src="/img/menu.jpg" alt="Το μενού">
  <iframe src="https://www.youtube.com/embed/xxxxxxxx"></iframe>
  <iframe src="https://www.google.com/maps/embed?pb=xxxx"></iframe>
</body>
</html>`
export const SAMPLE_HEADERS = `HTTP/2 200
content-type: text/html; charset=utf-8
x-content-type-options: nosniff
referrer-policy: strict-origin-when-cross-origin
set-cookie: session=abc123; Path=/`
