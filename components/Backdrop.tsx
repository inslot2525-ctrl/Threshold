export type Mood = 'calm' | 'watch' | 'alarm'

/** Drifting aurora behind every page. The mood tints it: lilac at rest, peach while watching, coral on alert. */
export default function Backdrop({ mood = 'calm' }: { mood?: Mood }) {
  return (
    <div className="aurora" data-mood={mood} aria-hidden>
      <div className="blob b1" />
      <div className="blob b2" />
      <div className="blob b3" />
      <div className="grain" />
    </div>
  )
}
