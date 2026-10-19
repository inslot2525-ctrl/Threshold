// Caregiver alerts. The dashboard always gets a live push; SNS texts/emails if configured.

import { EventEmitter } from 'node:events'
import { PublishCommand, SNSClient } from '@aws-sdk/client-sns'
import { formatClock } from '@/lib/engine/time'
import type { Incident, Settings } from '@/lib/types'

const g = globalThis as unknown as { __thresholdBus?: EventEmitter }
export const bus = (g.__thresholdBus ??= new EventEmitter().setMaxListeners(100))

/** Tell open dashboards to refresh. */
export function publishChange() {
  bus.emit('change')
}

let sns: SNSClient | null = null

export function shareUrl(incident: Incident): string {
  const base = process.env.PUBLIC_BASE_URL || 'http://localhost:3000'
  return `${base.replace(/\/$/, '')}/share/${incident.shareToken}`
}

export function alertText(incident: Incident, settings: Settings): string {
  const left = formatClock(incident.doorOpenedAt, settings.timezone)
  const lines = [`${settings.personName} went out the front door at ${left} and hasn't come back.`]
  if (incident.description) lines.push(incident.description.summary)
  else if (incident.snapshot?.status === 'unavailable' && incident.snapshot.reason === 'encrypted') {
    lines.push('Camera video is end-to-end encrypted, so there is no photo. Door and motion sensors only.')
  }
  lines.push(`Details and photo: ${shareUrl(incident)}`)
  return lines.join('\n')
}

export function returnedText(incident: Incident, settings: Settings): string {
  return `Update: the front door opened again. ${settings.personName} may be back inside. Please check. ${shareUrl(incident)}`
}

export async function sendExternal(subject: string, message: string): Promise<string | null> {
  const topicArn = process.env.SNS_TOPIC_ARN
  if (!topicArn) return null
  sns ??= new SNSClient({ region: process.env.AWS_REGION || 'us-east-1' })
  const res = await sns.send(new PublishCommand({ TopicArn: topicArn, Subject: subject, Message: message }))
  return res.MessageId ?? null
}
