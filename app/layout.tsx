import './globals.css'

export const metadata = {
  title: 'Threshold',
  description: 'Night-exit alerts for dementia caregivers, built on Ring',
}

export const viewport = { width: 'device-width', initialScale: 1, themeColor: '#0F172A' }

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-ink text-slate-200 antialiased">{children}</body>
    </html>
  )
}
