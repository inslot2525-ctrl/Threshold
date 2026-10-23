// Fallback describer: Amazon Rekognition labels turned into a search description.
// Used when Bedrock is unavailable (e.g. new-account quota). Rekognition can't say which
// way someone is walking, so we report where they stand in the frame instead.

import { DetectLabelsCommand, RekognitionClient, type Label } from '@aws-sdk/client-rekognition'
import type { Description } from '@/lib/types'

export const REKOGNITION_MODEL = 'Amazon Rekognition labels'

const MIN_CONFIDENCE = 70

// Identity-adjacent labels are dropped: we describe clothing and surroundings, never who someone is.
const IDENTITY = new Set(['Man', 'Woman', 'Boy', 'Girl', 'Male', 'Female', 'Adult', 'Child', 'Teen', 'Baby', 'Elderly', 'Face', 'Head', 'Portrait', 'Selfie', 'Beard', 'Hair'])
const PERSON = new Set(['Person', 'Human', 'People', 'Pedestrian'])
const CARRIED = new Set(['Bag', 'Handbag', 'Backpack', 'Suitcase', 'Luggage', 'Purse', 'Umbrella', 'Cane', 'Stick', 'Walking Stick', 'Walker', 'Phone', 'Mobile Phone', 'Cell Phone', 'Flashlight', 'Box', 'Package', 'Dog', 'Leash'])
const OUTERWEAR = new Set(['Coat', 'Jacket', 'Overcoat', 'Raincoat', 'Parka', 'Blazer', 'Hoodie', 'Sweater'])
const FOOTWEAR = new Set(['Shoe', 'Footwear', 'Boot', 'Sneaker', 'Sandal', 'Slipper'])
// Generic labels that add nothing a searcher could use.
const GENERIC_CLOTHING = new Set(['Clothing', 'Apparel', 'Accessories', 'Fashion'])

function isClothing(label: Label): boolean {
  const name = label.Name ?? ''
  if (GENERIC_CLOTHING.has(name) || IDENTITY.has(name)) return false
  if (FOOTWEAR.has(name) || OUTERWEAR.has(name)) return true
  return (label.Categories ?? []).some((c) => c.Name === 'Apparel and Accessories')
}

function frameSide(labels: Label[]): string {
  const person = labels.find((l) => PERSON.has(l.Name ?? ''))
  const box = person?.Instances?.[0]?.BoundingBox
  if (box?.Left === undefined || box.Width === undefined) return 'Position in frame unknown'
  const center = box.Left + box.Width / 2
  const where = center < 0.4 ? 'left side' : center > 0.6 ? 'right side' : 'middle'
  return `On the ${where} of the camera's view (direction of travel not known)`
}

/** Pure, so it can be tested without AWS. */
export function describeFromLabels(raw: Label[]): Description {
  const labels = raw.filter((l) => (l.Confidence ?? 0) >= MIN_CONFIDENCE && !IDENTITY.has(l.Name ?? ''))
  const names = new Set(labels.map((l) => l.Name ?? ''))
  const hasPerson = labels.some((l) => PERSON.has(l.Name ?? ''))

  const clothing = labels.filter(isClothing).map((l) => (l.Name ?? '').toLowerCase())
  const carrying = labels.filter((l) => CARRIED.has(l.Name ?? '')).map((l) => (l.Name ?? '').toLowerCase())

  const concerns: string[] = []
  const dark = names.has('Night') || names.has('Darkness') || names.has('Dark')
  if (hasPerson && names.has('Barefoot')) concerns.push('Appears barefoot')
  if (hasPerson && dark && ![...OUTERWEAR].some((o) => names.has(o))) concerns.push('No coat or jacket detected, at night')
  if (names.has('Rain') || names.has('Snow') || names.has('Storm')) concerns.push(`${names.has('Snow') ? 'Snow' : 'Rain'} visible`)
  if (names.has('Road') || names.has('Street') || names.has('Highway')) concerns.push('Road or street in view')

  let summary: string
  if (!hasPerson) {
    summary = 'No person visible in this frame.'
  } else {
    const parts = ['Person']
    if (clothing.length) parts.push(`wearing ${clothing.slice(0, 4).join(', ')}`)
    if (carrying.length) parts.push(`carrying ${carrying.slice(0, 2).join(' and ')}`)
    if (names.has('Barefoot')) parts.push('barefoot')
    summary = parts.join(', ') + (dark ? ', at night.' : '.')
  }

  return {
    summary,
    clothing: clothing.length ? clothing.join(', ') : 'unknown',
    carrying: carrying.length ? carrying.join(', ') : 'nothing detected',
    direction: hasPerson ? frameSide(labels) : 'unknown',
    concerns,
    model: REKOGNITION_MODEL,
    generatedAt: Date.now(),
  }
}

let client: RekognitionClient | null = null

export async function describeWithRekognition(image: Buffer): Promise<Description> {
  client ??= new RekognitionClient({ region: process.env.AWS_REGION || 'us-east-1' })
  const res = await client.send(
    new DetectLabelsCommand({ Image: { Bytes: image }, MaxLabels: 50, MinConfidence: MIN_CONFIDENCE })
  )
  return describeFromLabels(res.Labels ?? [])
}

/** True if Rekognition sees a person in the frame. Used to turn phone-camera motion into an exit. */
export async function detectPerson(image: Buffer): Promise<boolean> {
  client ??= new RekognitionClient({ region: process.env.AWS_REGION || 'us-east-1' })
  const res = await client.send(new DetectLabelsCommand({ Image: { Bytes: image }, MaxLabels: 20, MinConfidence: MIN_CONFIDENCE }))
  return (res.Labels ?? []).some((l) => PERSON.has(l.Name ?? ''))
}
