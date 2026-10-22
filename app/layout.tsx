import { Bricolage_Grotesque, Geist, Geist_Mono } from 'next/font/google'
import './globals.css'

const display = Bricolage_Grotesque({ subsets: ['latin'], variable: '--font-display', weight: ['500', '600', '700', '800'] })
const body = Geist({ subsets: ['latin'], variable: '--font-body' })
const mono = Geist_Mono({ subsets: ['latin'], variable: '--font-mono' })

export const metadata = {
  title: 'Threshold',
  description: 'Night-exit alerts for dementia caregivers, built on Ring',
}

export const viewport = { width: 'device-width', initialScale: 1, themeColor: '#09090F' }

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <body className="min-h-screen bg-ink font-sans text-slate-200 antialiased">{children}</body>
    </html>
  )
}
