// Self-check śledzenia alternate screen z src/main/pty.ts — na tym stoi tryb vim (bez tego
// zjadałby klawisze nvima). Regex i algorytm skopiowane 1:1; MAX_BUFFER zmniejszony, żeby dało
// się przetestować przycinanie bufora.
//
//     node scripts/alt-check.js
const ALT_SEQ = /\x1b\[\?(?:1049|1047|47)[hl]/g
const MAX_BUFFER = 200

const makeSession = () => ({ buffer: '', alt: false, events: [] })

// Odpowiednik proc.onData z PtyManager: dokłada chunk, aktualizuje stan i notuje wysłane zdarzenia.
function feed(sess, data) {
  sess.buffer += data
  const tail = sess.buffer.slice(-(data.length + 16))
  const seqs = tail.match(ALT_SEQ)
  if (seqs) {
    const alt = seqs[seqs.length - 1].endsWith('h')
    if (alt !== sess.alt) {
      sess.alt = alt
      sess.events.push(alt) // main wysyła 'pty:alt' tylko przy ZMIANIE stanu
    }
  }
  if (sess.buffer.length > MAX_BUFFER) sess.buffer = sess.buffer.slice(sess.buffer.length - MAX_BUFFER)
}

// 1. nvim startuje → alt on + jedno zdarzenie
let s = makeSession()
feed(s, 'prompt$ nvim\r\n\x1b[?1049h\x1b[2Jrysowanie')
console.assert(s.alt === true, 'FAIL: alt ma być true po ?1049h')
console.assert(s.events.length === 1 && s.events[0] === true, 'FAIL: jedno zdarzenie alt=true')

// 2. przerysowania nvima nie generują kolejnych zdarzeń (stan bez zmian)
feed(s, 'x'.repeat(50))
console.assert(s.events.length === 1, 'FAIL: brak zmiany stanu = brak zdarzeń')

// 3. wyjście z nvima → alt off
feed(s, '\x1b[?1049l\r\nprompt$ ')
console.assert(s.alt === false, 'FAIL: alt ma być false po ?1049l')
console.assert(s.events.length === 2 && s.events[1] === false, 'FAIL: zdarzenie alt=false')

// 4. sekwencja rozcięta między chunkami (granica pakietu PTY)
s = makeSession()
feed(s, 'x\x1b[?10')
feed(s, '49hreszta')
console.assert(s.alt === true, 'FAIL: rozcięta sekwencja niewykryta')

// 5. stan przeżywa przycięcie bufora — po to trzymamy go osobno, a nie czytamy z bufora
s = makeSession()
feed(s, '\x1b[?1049h')
feed(s, 'y'.repeat(MAX_BUFFER + 50))
console.assert(s.alt === true, 'FAIL: alt ma przetrwać przycięcie bufora')
console.assert(!/\x1b\[\?1049h/.test(s.buffer), 'FAIL: sekwencja miała wypaść z bufora')

// 6. warianty 47/1047 liczone tak samo
s = makeSession()
feed(s, '\x1b[?47h')
console.assert(s.alt === true, 'FAIL: ?47h niewykryte')
feed(s, '\x1b[?1047l')
console.assert(s.alt === false, 'FAIL: ?1047l niewykryte')

console.log('alt-check OK')
