// Polyfille dla pdf.js v6, który używa świeżych API JS niedostępnych w Chromium 126 (Electron 31).
// Bez nich worker pdf.js wywala się przy pierwszej wiadomości / przy parsowaniu i render PDF wisi.
// Ten moduł MUSI załadować się PRZED importami pdfjs.

// 1) Promise.try(fn, ...args) — uruchamia fn synchronicznie; wynik → rozwiązanie, wyjątek → odrzucenie.
const P = Promise as unknown as { try?: unknown }
if (typeof P.try !== 'function') {
  P.try = function (fn: (...args: unknown[]) => unknown, ...args: unknown[]): Promise<unknown> {
    return new Promise((resolve) => resolve(fn(...args)))
  }
}

// 2) Uint8Array <-> hex/base64 (TC39 „Uint8Array to/from base64", Chrome 133+).
const proto = Uint8Array.prototype as unknown as {
  toHex?: () => string
  toBase64?: () => string
}
if (typeof proto.toHex !== 'function') {
  proto.toHex = function (this: Uint8Array): string {
    let s = ''
    for (let i = 0; i < this.length; i++) s += this[i].toString(16).padStart(2, '0')
    return s
  }
}
if (typeof proto.toBase64 !== 'function') {
  proto.toBase64 = function (this: Uint8Array): string {
    let bin = ''
    for (let i = 0; i < this.length; i++) bin += String.fromCharCode(this[i])
    return btoa(bin)
  }
}

const ctor = Uint8Array as unknown as {
  fromBase64?: (s: string) => Uint8Array
  fromHex?: (s: string) => Uint8Array
}
if (typeof ctor.fromBase64 !== 'function') {
  ctor.fromBase64 = (str: string): Uint8Array => {
    const bin = atob(str)
    const out = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
    return out
  }
}
if (typeof ctor.fromHex !== 'function') {
  ctor.fromHex = (hex: string): Uint8Array => {
    const clean = hex.length % 2 ? hex.slice(0, -1) : hex
    const out = new Uint8Array(clean.length / 2)
    for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16)
    return out
  }
}

// 3) Map/WeakMap.prototype.getOrInsertComputed(key, fn) (TC39 „upsert", jeszcze poza stabilnym
//    Chrome). Zwraca istniejącą wartość lub liczy fn(key), wstawia i zwraca.
type GOIC = { getOrInsertComputed?: (key: unknown, fn: (key: unknown) => unknown) => unknown }
const mapProto = Map.prototype as unknown as GOIC
if (typeof mapProto.getOrInsertComputed !== 'function') {
  mapProto.getOrInsertComputed = function (this: Map<unknown, unknown>, key, fn) {
    if (this.has(key)) return this.get(key)
    const v = fn(key)
    this.set(key, v)
    return v
  }
}
const weakProto = WeakMap.prototype as unknown as GOIC
if (typeof weakProto.getOrInsertComputed !== 'function') {
  weakProto.getOrInsertComputed = function (this: WeakMap<object, unknown>, key, fn) {
    if (this.has(key as object)) return this.get(key as object)
    const v = fn(key)
    this.set(key as object, v)
    return v
  }
}

// 4) Math.sumPrecise(iterable) (TC39, Chrome 137+) — pdf.js woła bez guardu. Prosta suma wystarcza
//    (pdf.js sumuje tu długości linii). Float16Array NIE polyfillujemy — pdf.js sam sprawdza jego
//    obecność (FeatureTest.isFloat16ArraySupported) i spada na Float32Array.
const M = Math as unknown as { sumPrecise?: (it: Iterable<number>) => number }
if (typeof M.sumPrecise !== 'function') {
  M.sumPrecise = (it: Iterable<number>): number => {
    let s = 0
    for (const v of it) s += v
    return s
  }
}
