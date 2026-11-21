<script setup lang="ts">
import { computed, ref } from 'vue'
import { SAMPLE_HEADERS, SAMPLE_HTML, SAMPLE_SITE, SYMBOL, audit, clientSentence, normalizeSite, type Report } from '@/lib/scan'

const url = ref(`https://www.${SAMPLE_SITE}`)
const html = ref(SAMPLE_HTML)
const headers = ref(SAMPLE_HEADERS)
const error = ref('')
const report = ref<Report | null>(null)
const when = ref('')
const MAX = 2_000_000

const pad = (n: number): string => String(n).padStart(2, '0')
const run = (scroll = true): void => {
  const site = normalizeSite(url.value)
  if (!site) return void (error.value = 'Γράψτε μια διεύθυνση, π.χ. www.paradeigma.gr.')
  if (!html.value.trim()) return void (error.value = 'Επικολλήστε τον κώδικα της σελίδας (HTML).')
  if (html.value.length > MAX) return void (error.value = 'Ο κώδικας είναι πολύ μεγάλος για το demo (έως 2 MB).')
  error.value = ''
  report.value = audit(site, html.value, headers.value)
  const d = new Date()
  when.value = `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} · ${pad(d.getHours())}:${pad(d.getMinutes())}`
  if (scroll) setTimeout(() => document.getElementById('report')?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }), 50)
}
run(false)
const sample = (): void => {
  url.value = `https://www.${SAMPLE_SITE}`
  html.value = SAMPLE_HTML
  headers.value = SAMPLE_HEADERS
  run()
}
const level = { attention: 'προσοχή', consent: 'ανάγκη συναίνεσης', improve: 'βελτίωση' } as const
const sentence = computed(() => (report.value ? clientSentence(report.value) : ''))
const cookieCount = computed(() => report.value?.cookies.length ?? 0)
const print = (): void => window.print()
</script>

<template>
  <main>
    <section class="wrap hero noprint">
      <h1 class="big">Τι κάνει <span class="hl">πραγματικά</span> η σελίδα σας;</h1>
      <p class="lead">Βάλτε μια διεύθυνση και τον κώδικα της σελίδας. Βλέπετε ποιες υπηρεσίες τρίτων καλεί, ποια cookies πιθανόν βάζει και τι λείπει από την ασφάλειά της.</p>
      <form class="check" novalidate @submit.prevent="run()">
        <label for="u" class="sr">Διεύθυνση ιστοσελίδας</label>
        <div class="row"><input id="u" v-model="url" class="code" autocomplete="off" spellcheck="false" :aria-invalid="!!error" aria-describedby="err" /><button type="submit" class="go">Έλεγχος →</button></div>
        <details>
          <summary>Κώδικας σελίδας και κεφαλίδες</summary>
          <label for="h">Κώδικας HTML της σελίδας (δεξί κλικ → Προβολή πηγαίου κώδικα)</label>
          <textarea id="h" v-model="html" class="code" rows="9" spellcheck="false" />
          <label for="hd">Κεφαλίδες απάντησης (προαιρετικό, από <code>curl -I</code>)</label>
          <textarea id="hd" v-model="headers" class="code" rows="5" spellcheck="false" />
          <button type="button" class="link" @click="sample">Φόρτωση δείγματος</button>
        </details>
        <p id="err" class="err" role="alert">{{ error }}</p>
      </form>
      <p class="note">Ελέγχονται μόνο δημόσιες σελίδες, χωρίς είσοδο ή φόρμες. Στο demo επικολλάτε εσείς τον κώδικα, γιατί ο browser δεν επιτρέπει να διαβάσει άλλα sites. Στην πραγματική υπηρεσία το κάνει ένας server. Ό,τι επικολλάτε μένει στη συσκευή σας.</p>
    </section>

    <section v-if="report" id="report" class="report" aria-labelledby="rep-h">
      <div class="wrap">
        <div class="rhead"><h2 id="rep-h">Αναφορά για {{ report.site }}</h2><span class="code">ΕΛΕΓΧΟΣ {{ when }}</span></div>
        <div class="stats">
          <div><div class="code n">{{ report.thirdParties.length }}</div><div>κλήσεις σε τρίτους</div></div>
          <div><div class="code n">{{ cookieCount }}</div><div>cookies{{ report.cookies.some((c) => c.source === 'tracker') ? ' (εκτίμηση)' : '' }}</div></div>
          <div><div class="code n">{{ report.headersProvided ? report.missingHeaders.length : '–' }}</div><div>{{ report.headersProvided ? 'κεφαλίδες ασφαλείας λείπουν' : 'κεφαλίδες δεν δόθηκαν' }}</div></div>
          <div class="score"><div class="code n">{{ report.score }}<small>/100</small></div><div>συνολική εικόνα</div></div>
        </div>

        <div class="split">
          <div>
            <p v-if="!report.findings.length" class="okay" role="status">Δεν βρέθηκαν ευρήματα.</p>
            <div v-for="(f, i) in report.findings" :key="f.id" class="find" :style="{ animationDelay: `${i * 90}ms` }">
              <span class="code sym" :aria-label="level[f.level]">{{ SYMBOL[f.level] }}</span>
              <div><b>{{ f.title }}</b><div class="code sub">{{ f.subject }}</div></div>
              <div>{{ f.detail }} <b>Λύση:</b> {{ f.fix }}</div>
            </div>
            <p class="code legend">▲ προσοχή &nbsp; ■ ανάγκη συναίνεσης &nbsp; ● βελτίωση</p>
            <ul v-if="report.thirdParties.length" class="tp"><li v-for="t in report.thirdParties" :key="t.host"><span class="code">{{ t.host }}</span> {{ t.name }}</li></ul>
          </div>
          <aside class="tell">
            <p class="code k">ΤΙ ΝΑ ΠΕΙΤΕ ΣΤΟΝ ΠΕΛΑΤΗ</p>
            <p class="q">{{ sentence }}</p>
            <button type="button" class="pdf noprint" @click="print">Αποθήκευση ως PDF</button>
          </aside>
        </div>
      </div>
    </section>
  </main>
</template>
