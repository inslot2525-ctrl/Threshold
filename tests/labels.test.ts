import { describe, expect, it } from 'vitest'
import { describeFromLabels } from '@/lib/ai/labels'

const apparel = [{ Name: 'Apparel and Accessories' }]

describe('describeFromLabels', () => {
  it('builds a search description from person, clothing and scene labels', () => {
    const d = describeFromLabels([
      { Name: 'Person', Confidence: 99, Instances: [{ BoundingBox: { Left: 0.05, Width: 0.2, Top: 0.2, Height: 0.6 } }] },
      { Name: 'Robe', Confidence: 91, Categories: apparel },
      { Name: 'Clothing', Confidence: 99, Categories: apparel },
      { Name: 'Night', Confidence: 88 },
      { Name: 'Road', Confidence: 80 },
      { Name: 'Umbrella', Confidence: 75 },
    ])
    expect(d.summary).toBe('Person, wearing robe, carrying umbrella, at night.')
    expect(d.clothing).toBe('robe')
    expect(d.direction).toMatch(/left side/)
    expect(d.concerns).toEqual(['No coat or jacket detected, at night', 'Road or street in view'])
  })

  it('never reports identity-adjacent labels', () => {
    const d = describeFromLabels([
      { Name: 'Person', Confidence: 99 },
      { Name: 'Woman', Confidence: 97 },
      { Name: 'Elderly', Confidence: 90 },
      { Name: 'Face', Confidence: 95 },
      { Name: 'Coat', Confidence: 92, Categories: apparel },
    ])
    const text = JSON.stringify(d)
    for (const word of ['Woman', 'woman', 'Elderly', 'elderly', 'Face', 'face']) expect(text).not.toContain(word)
    expect(d.summary).toBe('Person, wearing coat.')
  })

  it('flags barefoot and does not warn about a coat when one is worn', () => {
    const d = describeFromLabels([
      { Name: 'Person', Confidence: 95 },
      { Name: 'Barefoot', Confidence: 82 },
      { Name: 'Jacket', Confidence: 85 },
      { Name: 'Darkness', Confidence: 90 },
    ])
    expect(d.concerns).toEqual(['Appears barefoot'])
    expect(d.summary).toBe('Person, wearing jacket, barefoot, at night.')
  })

  it('says so when nobody is in the frame', () => {
    const d = describeFromLabels([
      { Name: 'Bird', Confidence: 98 },
      { Name: 'Bird Feeder', Confidence: 93 },
      { Name: 'Snow', Confidence: 90 },
    ])
    expect(d.summary).toBe('No person visible in this frame.')
    expect(d.direction).toBe('unknown')
  })

  it('ignores low-confidence labels', () => {
    const d = describeFromLabels([
      { Name: 'Person', Confidence: 95 },
      { Name: 'Pajamas', Confidence: 40, Categories: apparel },
    ])
    expect(d.clothing).toBe('unknown')
  })
})
