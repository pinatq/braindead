import { useStore } from '../state/store'

// Pasek zużycia (wartość / maks) w MB → GB do podpisu.
function Bar({ label, value, max, warn }: { label: string; value: number; max: number; warn?: boolean }): JSX.Element {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0
  return (
    <div className="ram-bar">
      <div className="ram-bar-head">
        <span>{label}</span>
        <span>{(value / 1024).toFixed(1)} GB</span>
      </div>
      <div className="ram-bar-track">
        <div className={'ram-bar-fill' + (warn ? ' ram-bar-fill--warn' : '')} style={{ width: pct + '%' }} />
      </div>
    </div>
  )
}

/** Wspólne ustawienia RAM + podgląd zużycia (best-effort). Używane w ustawieniach i popoverze. */
export default function RamControls(): JSX.Element {
  const ram = useStore((s) => s.ram)
  const stats = useStore((s) => s.ramStats)
  const setRam = useStore((s) => s.setRam)

  const usedSys = stats ? stats.totalMb - stats.freeMb : 0

  return (
    <div className="ram-controls">
      <div className="ram-usage">
        {stats ? (
          <>
            <Bar label="App memory" value={stats.appMb} max={ram.maxMb} warn={stats.appMb > ram.maxMb} />
            <Bar
              label="System RAM"
              value={usedSys}
              max={stats.totalMb}
              warn={stats.freeMb < ram.minFreeMb}
            />
          </>
        ) : (
          <p className="setting-sub">Reading memory usage…</p>
        )}
      </div>

      <label className="setting-row setting-row--toggle">
        <span>
          <b>Max app RAM</b>
          <span className="setting-sub">Target {Math.round(ram.maxMb / 1024)} GB. Enforce = sleep tabs &amp; block new browsers over this.</span>
        </span>
        <input
          type="checkbox"
          checked={ram.enforce}
          onChange={(e) => setRam({ enforce: e.target.checked })}
        />
      </label>
      <input
        className="ram-slider"
        type="range"
        min={512}
        max={16384}
        step={256}
        value={ram.maxMb}
        onChange={(e) => setRam({ maxMb: Number(e.target.value) })}
      />

      <label className="setting-row setting-row--toggle">
        <span>
          <b>Sleep inactive tabs</b>
          <span className="setting-sub">Unloads background browser tabs to free RAM; click a tab to wake it.</span>
        </span>
        <input
          type="checkbox"
          checked={ram.sleepInactive}
          onChange={(e) => setRam({ sleepInactive: e.target.checked })}
        />
      </label>
      <div className="setting-row">
        <span className="setting-sub">After</span>
        <input
          type="number"
          min={1}
          max={120}
          value={ram.sleepAfterMin}
          onChange={(e) => setRam({ sleepAfterMin: Math.max(1, Number(e.target.value) || 1) })}
        />
        <span className="setting-sub">min of inactivity</span>
      </div>

      <label className="setting-row setting-row--toggle">
        <span>
          <b>Min free system RAM</b>
          <span className="setting-sub">When free RAM drops below {Math.round(ram.minFreeMb / 1024)} GB, block new browsers.</span>
        </span>
        <input
          type="checkbox"
          checked={ram.minFreeEnforce}
          onChange={(e) => setRam({ minFreeEnforce: e.target.checked })}
        />
      </label>
      <input
        className="ram-slider"
        type="range"
        min={256}
        max={8192}
        step={256}
        value={ram.minFreeMb}
        onChange={(e) => setRam({ minFreeMb: Number(e.target.value) })}
      />

      <p className="setting-sub ram-note">
        Best-effort: Chromium can&apos;t be hard-capped from the app, so these are mitigations
        (sleeping tabs, blocking new browsers) rather than a strict limit.
      </p>
    </div>
  )
}
