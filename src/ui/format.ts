const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const pad = (n: number) => String(n).padStart(2, '0')

export function formatDay(t: number) {
  const d = new Date(t)
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`
}

export function formatClock(t: number) {
  const d = new Date(t)
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
}

export function formatAgo(t: number, now = Date.now()) {
  const mins = Math.round((now - t) / 60000)
  if (mins < 45) return mins <= 1 ? 'now' : `${mins} min ago`
  const h = Math.floor(mins / 60)
  if (h < 24) return `${h} h ${pad(mins % 60)} min ago`
  return `${Math.floor(h / 24)} d ${h % 24} h ago`
}

export const minus = (v: number, digits = 1) => (v < 0 ? `−${Math.abs(v).toFixed(digits)}` : v.toFixed(digits))

export function kpLabel(kp: number) {
  const whole = Math.round(kp)
  const frac = kp - whole
  return `${whole}${frac > 0.15 ? '+' : frac < -0.15 ? '−' : ''}`
}
