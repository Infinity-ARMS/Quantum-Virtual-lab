import { EXPERIMENTS, type ActivityStatus, type AnalyticsEvent, type ExperimentId } from '../../analytics/types'
import { fmtDuration } from '../../app/format'

export const EXP_NAME = Object.fromEntries(EXPERIMENTS.map((e) => [e.id, e.title])) as Record<ExperimentId, string>

export const STATUS_LABEL: Record<ActivityStatus, string> = {
  active: 'Active',
  recent: 'Recent',
  inactive: 'Inactive',
  never: 'No activity',
}

export function StatusChip({ status }: { status: ActivityStatus }) {
  return (
    <span className={`status-chip ${status}`}>
      <i aria-hidden />
      {STATUS_LABEL[status]}
    </span>
  )
}

/** One recorded event in words, e.g. "Ran 1,000 shots in Measurement · Hadamard". */
export function describeEvent(e: AnalyticsEvent): string {
  const exp = e.experiment ? EXP_NAME[e.experiment] : ''
  switch (e.type) {
    case 'login':
      return 'Logged in'
    case 'logout':
      return 'Logged out'
    case 'session_start':
      return 'Session started'
    case 'session_end':
      return 'Session ended'
    case 'gate_selected':
      return `Selected ${exp}`
    case 'experiment_start':
      return `Opened ${exp}`
    case 'experiment_complete':
      return `Completed ${exp}${typeof e.detail?.result === 'string' && e.detail.result ? ` — ${e.detail.result}` : ''}`
    case 'experiment_exit':
      return `Left ${exp} after ${fmtDuration(Number(e.detail?.seconds ?? 0) * 1000)}`
    case 'wire_connection':
      return `Connected a cable in ${exp}`
    case 'measurement': {
      const n = Number(e.detail?.shots ?? 0)
      return `Ran ${n.toLocaleString()} measurement shot${n === 1 ? '' : 's'} in ${exp}`
    }
    case 'reset':
      return `Reset ${exp}`
    case 'example_loaded':
      return `Loaded the example circuit in ${exp}`
    case 'teacher_linked':
      return e.detail?.via === 'admin' ? 'Was linked to a teacher by an administrator' : 'Joined using the teacher reference ID'
    default:
      return e.type
  }
}
