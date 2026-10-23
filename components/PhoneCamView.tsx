// The phone camera's feed (MJPEG from /api/phonecam), shown wherever the Ring live view would be.

export default function PhoneCamView() {
  return (
    <div className="relative overflow-hidden rounded-md border border-line bg-black">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/api/phonecam" alt="Live porch camera" className="aspect-video w-full object-cover" />
      <span className="tag absolute left-2 top-2 rounded-sm bg-black/75 px-2 py-1 text-white">
        <span className="blink h-1.5 w-1.5 rounded-full bg-alarm" />
        LIVE · Porch camera
      </span>
    </div>
  )
}
