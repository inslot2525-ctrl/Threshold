// Turns a porch snapshot into a search-ready description with Amazon Bedrock.
// Deliberately describes clothing and direction only, never identity.

import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime'
import { describeWithRekognition } from '@/lib/ai/labels'
import type { Description } from '@/lib/types'

const MODEL_ID = process.env.BEDROCK_MODEL_ID || 'us.amazon.nova-lite-v1:0'

const PROMPT = `You are helping a family find a relative with dementia who has just walked out of their home at night.
This is a doorbell/porch camera frame taken moments after they left.

Describe ONLY what would help someone spot them on the street:
- clothing (colors, garment types, layers, footwear or barefoot)
- anything carried
- which way they are heading relative to the frame (left, right, toward the street, toward the camera)
- safety concerns visible in the frame (no coat in cold weather, barefoot, rain, darkness, a road nearby)

Do NOT describe or guess the face, age, race, ethnicity, identity, or any biometric detail.
If no person is visible, say so in the summary and leave the other fields as "unknown".

Reply with JSON only, no prose:
{"summary": "<one sentence a neighbor could act on>", "clothing": "...", "carrying": "...", "direction": "...", "concerns": ["..."]}`

let client: BedrockRuntimeClient | null = null

/** On when AWS credentials are present (env keys or a named profile) and not switched off. */
export function isAiEnabled(): boolean {
  if (process.env.AI_DISABLED === 'true') return false
  return Boolean(process.env.AWS_ACCESS_KEY_ID || process.env.AWS_PROFILE)
}

/** Name shown on the dashboard for whichever describer is in use. */
export function describerName(): string {
  const provider = process.env.DESCRIBE_PROVIDER ?? 'auto'
  if (provider === 'rekognition') return 'Rekognition'
  if (provider === 'bedrock') return 'Bedrock'
  return 'Bedrock + Rekognition'
}

export function imageFormat(image: Buffer): 'jpeg' | 'png' {
  return image[0] === 0x89 && image[1] === 0x50 ? 'png' : 'jpeg'
}

/** After Bedrock fails (quota, verification), skip it for a while instead of failing every alert. */
const BEDROCK_COOLDOWN_MS = 10 * 60_000
let bedrockDownUntil = 0

/**
 * Bedrock first, Rekognition labels as the fallback. DESCRIBE_PROVIDER=bedrock|rekognition pins one.
 */
export async function describeSnapshot(image: Buffer): Promise<Description> {
  const provider = process.env.DESCRIBE_PROVIDER ?? 'auto'
  if (provider === 'rekognition') return describeWithRekognition(image)
  if (provider === 'bedrock') return describeWithBedrock(image)

  if (Date.now() >= bedrockDownUntil) {
    try {
      return await describeWithBedrock(image)
    } catch (error) {
      bedrockDownUntil = Date.now() + BEDROCK_COOLDOWN_MS
      console.warn('[describe] Bedrock unavailable, falling back to Rekognition:', String(error).slice(0, 160))
    }
  }
  return describeWithRekognition(image)
}

export async function describeWithBedrock(image: Buffer): Promise<Description> {
  client ??= new BedrockRuntimeClient({ region: process.env.AWS_REGION || 'us-east-1' })

  const res = await client.send(
    new ConverseCommand({
      modelId: MODEL_ID,
      messages: [
        {
          role: 'user',
          content: [
            { image: { format: imageFormat(image), source: { bytes: image } } },
            { text: PROMPT },
          ],
        },
      ],
      inferenceConfig: { maxTokens: 400, temperature: 0.2 },
    })
  )

  const text = res.output?.message?.content?.find((block) => 'text' in block)?.text ?? ''
  return parseDescription(text, MODEL_ID)
}

export function parseDescription(text: string, model: string): Description {
  const match = text.match(/\{[\s\S]*\}/)
  if (!match) throw new Error(`Model returned no JSON: ${text.slice(0, 200)}`)
  const raw = JSON.parse(match[0])
  return {
    summary: String(raw.summary ?? 'No description available'),
    clothing: String(raw.clothing ?? 'unknown'),
    carrying: String(raw.carrying ?? 'unknown'),
    direction: String(raw.direction ?? 'unknown'),
    concerns: Array.isArray(raw.concerns) ? raw.concerns.map(String) : [],
    model,
    generatedAt: Date.now(),
  }
}
