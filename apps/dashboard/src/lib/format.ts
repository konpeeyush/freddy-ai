const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 1000 * 60 * 60 * 24 * 365],
  ["month", 1000 * 60 * 60 * 24 * 30],
  ["week", 1000 * 60 * 60 * 24 * 7],
  ["day", 1000 * 60 * 60 * 24],
  ["hour", 1000 * 60 * 60],
  ["minute", 1000 * 60],
]

const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" })

/** "3 hours ago", "yesterday" — no date library needed for one format. */
export function formatRelativeTime(ms: number): string {
  const diff = ms - Date.now()
  for (const [unit, unitMs] of UNITS) {
    if (Math.abs(diff) >= unitMs) {
      return rtf.format(Math.round(diff / unitMs), unit)
    }
  }
  return rtf.format(Math.round(diff / 1000), "second")
}

const BYTE_UNITS = ["B", "KB", "MB", "GB"]

export function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 B"
  const exponent = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    BYTE_UNITS.length - 1
  )
  const value = bytes / Math.pow(1024, exponent)
  return `${exponent === 0 ? value : value.toFixed(1)} ${BYTE_UNITS[exponent]}`
}
