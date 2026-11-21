<script setup lang="ts">
import { RouterLink, RouterView } from 'vue-router'
</script>

<template>
  <a class="skip" href="#main">Μετάβαση στο περιεχόμενο</a>
  <header class="top wrap">
    <RouterLink to="/" class="logo">Διαφάνεια<span class="code">v1</span></RouterLink>
    <span class="tag">DEMO CONCEPT</span>
  </header>
  <div id="main" tabindex="-1"><RouterView /></div>
  <footer class="foot wrap">
    <p>Φανταστικό demo με ενδεικτικά δεδομένα. Ένας αυτόματος έλεγχος δεν αντικαθιστά νομική συμβουλή. Σχεδιασμός και υλοποίηση: Βασίλειος Βαρβέρογλου.</p>
    <p><RouterLink to="/privacy">Απόρρητο και cookies</RouterLink></p>
  </footer>
</template>
