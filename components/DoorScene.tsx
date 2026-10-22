// The front door, drawn to match the status: shut under a warm porch light, ajar while
// watching, wide open under a red light (with footsteps leading away) on an alert.

export type DoorMood = 'calm' | 'watch' | 'alarm'

const LAMP = { calm: '#F2B84B', watch: '#EB9550', alarm: '#EF5A4C' }

export default function DoorScene({ mood }: { mood: DoorMood }) {
  const lamp = LAMP[mood]
  // x of the door's free edge: shut, ajar, open.
  const edge = mood === 'calm' ? 132 : mood === 'watch' ? 112 : 86

  return (
    <svg viewBox="0 0 220 200" className="h-auto w-full" role="img" aria-label={`Front door, ${mood === 'calm' ? 'closed' : 'open'}`}>
      {/* wall and ground */}
      <rect x="0" y="0" width="220" height="200" rx="10" fill="#1F1D1A" />
      <rect x="0" y="176" width="220" height="24" fill="#24221F" />
      <path d="M0 176h220" stroke="#2D2B28" />

      {/* light cone from the porch lamp */}
      <polygon points="166,64 120,176 212,176" fill={lamp} opacity={mood === 'calm' ? 0.1 : 0.16} />

      {/* frame and doorway */}
      <rect x="60" y="34" width="80" height="142" rx="3" fill="#2D2B28" />
      <rect x="66" y="40" width="68" height="136" fill="#0C0B0A" />

      {/* door leaf, hinged on the left */}
      <polygon points={`66,40 ${edge},${mood === 'calm' ? 40 : 46} ${edge},${mood === 'calm' ? 176 : 170} 66,176`} fill="#4A3A2C" />
      {mood === 'calm' && (
        <>
          <rect x="76" y="52" width="48" height="46" rx="2" fill="none" stroke="#5C493A" strokeWidth="2" />
          <rect x="76" y="110" width="48" height="54" rx="2" fill="none" stroke="#5C493A" strokeWidth="2" />
          <circle cx="124" cy="112" r="3" fill={lamp} />
        </>
      )}

      {/* step */}
      <rect x="52" y="176" width="96" height="8" rx="2" fill="#35322E" />

      {/* porch lamp */}
      <rect x="160" y="50" width="12" height="16" rx="2" fill="#35322E" />
      <rect x="162" y="54" width="8" height="9" rx="1" fill={lamp} />

      {/* house number */}
      <text x="100" y="27" textAnchor="middle" fontFamily="var(--font-mono)" fontSize="11" fill="#9A948A">
        12
      </text>

      {/* footsteps leading away on an alert */}
      {mood === 'alarm' &&
        [
          [154, 190],
          [170, 186],
          [184, 191],
          [198, 187],
        ].map(([x, y], i) => <ellipse key={i} cx={x} cy={y} rx="4" ry="2" fill="#EDE8DF" opacity={0.55 - i * 0.1} />)}
    </svg>
  )
}
