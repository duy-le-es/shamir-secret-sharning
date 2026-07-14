import type { RecoveryStep } from '../models/types'

export function RecoveryTimeline({ steps }: { steps: RecoveryStep[] }) {
  return (
    <ul className="timeline">
      {steps.map((step, i) => (
        <li key={i} className={step.state}>
          <span className={`marker ${step.state === 'active' ? 'pulsing' : ''}`}>
            {step.state === 'done' ? '✓' : i + 1}
          </span>
          <span>
            {step.label}
            {step.detail && <span className="step-detail">{step.detail}</span>}
          </span>
        </li>
      ))}
    </ul>
  )
}
