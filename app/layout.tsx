import { Geist, Geist_Mono, Instrument_Serif } from 'next/font/google'
import './globals.css'

const serif = Instrument_Serif({ subsets: ['latin'], variable: '--font-serif', weight: '400', style: ['normal', 'italic'] })
const body = Geist({ subsets: ['latin'], variable: '--font-body' })
const mono = Geist_Mono({ subsets: ['latin'], variable: '--font-mono' })

export const metadata = {
  title: 'Threshold',
  description: 'Night-exit alerts for dementia caregivers, built on Ring',
}

export const viewport = { width: 'device-width', initialScale: 1, themeColor: '#121110' }

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${serif.variable} ${body.variable} ${mono.variable}`}>
      <body className="min-h-screen bg-ink font-sans text-paper antialiased">{children}</body>
    </html>
  )
}
