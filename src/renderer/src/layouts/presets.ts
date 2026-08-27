// Presety układów w stylu TradingView. Każdy preset to siatka CSS Grid
// z nazwanymi obszarami (a..f). Panele mapują się kolejno na `slots`.

export interface LayoutPreset {
  id: string
  paneCount: number
  cols: string // grid-template-columns
  rows: string // grid-template-rows
  areas: string[] // wiersze grid-template-areas
  slots: string[] // nazwy obszarów w kolejności paneli
}

// Wyznacza unikalne nazwy obszarów w kolejności pojawienia się.
function slotsOf(areas: string[]): string[] {
  const seen: string[] = []
  for (const row of areas) {
    for (const name of row.trim().split(/\s+/)) {
      if (!seen.includes(name)) seen.push(name)
    }
  }
  return seen
}

function preset(id: string, cols: string, rows: string, areas: string[]): LayoutPreset {
  const slots = slotsOf(areas)
  return { id, paneCount: slots.length, cols, rows, areas, slots }
}

// Pogrupowane wg liczby paneli (1..6) — tak jak wiersze w pickerze TradingView.
export const LAYOUT_GROUPS: LayoutPreset[][] = [
  // 1
  [preset('1', '1fr', '1fr', ['a'])],
  // 2
  [
    preset('2-cols', '1fr 1fr', '1fr', ['a b']),
    preset('2-rows', '1fr', '1fr 1fr', ['a', 'b'])
  ],
  // 3
  [
    preset('3-cols', '1fr 1fr 1fr', '1fr', ['a b c']),
    preset('3-rows', '1fr', '1fr 1fr 1fr', ['a', 'b', 'c']),
    preset('3-1L-2R', '1fr 1fr', '1fr 1fr', ['a b', 'a c']),
    preset('3-2L-1R', '1fr 1fr', '1fr 1fr', ['a c', 'b c']),
    preset('3-1T-2B', '1fr 1fr', '1fr 1fr', ['a a', 'b c']),
    preset('3-2T-1B', '1fr 1fr', '1fr 1fr', ['a b', 'c c'])
  ],
  // 4
  [
    preset('4-grid', '1fr 1fr', '1fr 1fr', ['a b', 'c d']),
    preset('4-cols', '1fr 1fr 1fr 1fr', '1fr', ['a b c d']),
    preset('4-rows', '1fr', '1fr 1fr 1fr 1fr', ['a', 'b', 'c', 'd']),
    preset('4-1L-3R', '1fr 1fr', '1fr 1fr 1fr', ['a b', 'a c', 'a d']),
    preset('4-1T-3B', '1fr 1fr 1fr', '1fr 1fr', ['a a a', 'b c d'])
  ],
  // 5
  [
    preset('5-cols', '1fr 1fr 1fr 1fr 1fr', '1fr', ['a b c d e']),
    preset('5-1L-4R', '1fr 1fr', '1fr 1fr 1fr 1fr', ['a b', 'a c', 'a d', 'a e']),
    preset('5-1T-4B', '1fr 1fr 1fr 1fr', '1fr 1fr', ['a a a a', 'b c d e']),
    preset('5-rows', '1fr', '1fr 1fr 1fr 1fr 1fr', ['a', 'b', 'c', 'd', 'e'])
  ],
  // 6
  [
    preset('6-grid', '1fr 1fr 1fr', '1fr 1fr', ['a b c', 'd e f']),
    preset('6-grid-3x2', '1fr 1fr', '1fr 1fr 1fr', ['a b', 'c d', 'e f']),
    preset('6-cols', '1fr 1fr 1fr 1fr 1fr 1fr', '1fr', ['a b c d e f']),
    preset('6-rows', '1fr', '1fr 1fr 1fr 1fr 1fr 1fr', ['a', 'b', 'c', 'd', 'e', 'f'])
  ]
]

// --- Generator układów 7..16 paneli ---
const LETTERS = 'abcdefghijklmnop' // do 16 obszarów

// Buduje siatkę n paneli w `cols` kolumnach; ostatni panel rozciąga się na
// wolne komórki w ostatnim wierszu (zawsze tworzy poprawny prostokąt obszaru).
function gridPreset(n: number, cols: number): LayoutPreset {
  const rows = Math.ceil(n / cols)
  const areas: string[] = []
  for (let r = 0; r < rows; r++) {
    const row: string[] = []
    for (let c = 0; c < cols; c++) {
      const idx = Math.min(r * cols + c, n - 1)
      row.push(LETTERS[idx])
    }
    areas.push(row.join(' '))
  }
  return preset(
    `${n}-c${cols}`,
    Array(cols).fill('1fr').join(' '),
    Array(rows).fill('1fr').join(' '),
    areas
  )
}

// Kilka wariantów liczby kolumn dla danego n (zbalansowany + szerszy + węższy).
function gridGroup(n: number): LayoutPreset[] {
  const cands = [...new Set([Math.ceil(Math.sqrt(n)), Math.ceil(n / 2), Math.ceil(n / 3)])]
    .filter((c) => c >= 1 && c <= n)
    .sort((a, b) => a - b)
  return cands.map((c) => gridPreset(n, c))
}

for (let n = 7; n <= 16; n++) LAYOUT_GROUPS.push(gridGroup(n))

export const PRESETS: Record<string, LayoutPreset> = Object.fromEntries(
  LAYOUT_GROUPS.flat().map((p) => [p.id, p])
)

export function getPreset(id: string): LayoutPreset {
  return PRESETS[id] ?? PRESETS['1']
}
