/**
 * The mirror, held to the original.
 *
 * `CopilotAgentLike` describes the stream this package consumes, and it is written by
 * hand rather than imported so a consumer can bring any agent. That freedom has a cost,
 * and the cost was paid once already: the type declared `usage?: { costUsd?: number }`
 * while `@theokit/sdk` emitted `usage: { inputTokens, outputTokens }`, the runtime read
 * `costUsd`, and the spend ceiling of a self-triggering agent silently checked the
 * configured estimate for a whole release (#61).
 *
 * Nothing could have caught that, because nothing ever handed a real SDK event to the
 * local type. This file does exactly that, at compile time: if the SDK changes the event
 * and our mirror does not follow, `pnpm typecheck` fails here — no network, no key, no
 * cost, no waiting for a bill to notice.
 *
 * It is a type test first. The runtime assertions exist so the file is not silently
 * skipped by a runner that only counts `it()` blocks.
 */

import type { StreamObjectEvent } from '@theokit/sdk'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { settleCost } from '../src/internal/cost.js'
import type { CopilotAgentLike, CopilotUsage } from '../src/types.js'

const _answerSchema = z.object({ text: z.string() })
type Answer = z.infer<typeof _answerSchema>

/**
 * The element type of the stream `CopilotAgentLike` promises, for a given SCHEMA.
 *
 * The generic moved from the object to the schema so a real `Agent` can satisfy the
 * interface at all — see `src/types.ts`. A schema is what the caller actually passes,
 * and deriving the object from it is what the SDK does.
 *
 * `ReturnType<CopilotAgentLike['streamObject']>` would instantiate the generic with
 * `unknown` and silently drop `T` — the assertion below would then hold for every object
 * shape, which is not the property this file claims to prove. The instantiation
 * expression `typeof agent.streamObject<T>` passes `T` through.
 */
declare const _agent: CopilotAgentLike
type CopilotEvent<S extends z.ZodType> =
  ReturnType<typeof _agent.streamObject<S>> extends AsyncIterable<infer E> ? E : never

/**
 * The assignment under test. If a real `StreamObjectEvent<Answer>` stops fitting the
 * local union, this line stops compiling — which is the entire point of the file.
 */
function acceptsSdkEvent(event: StreamObjectEvent<Answer>): CopilotEvent<typeof _answerSchema> {
  return event
}

/** And the direction that matters for consumers: our `partial` is the SDK's `partial`. */
const sdkPartial: StreamObjectEvent<Answer> = {
  type: 'partial',
  partial: { text: 'hel' },
  attempt: 0,
}

/**
 * A `complete` event exactly as the SDK builds it — every field, including the ones this
 * package ignores. Ignoring them is fine; not accepting them would not be.
 */
const sdkComplete: StreamObjectEvent<Answer> = {
  type: 'complete',
  object: { text: 'hello' },
  raw: {},
  usage: { inputTokens: 1_000, outputTokens: 500 },
  finishReason: 'tool_use',
}

describe('CopilotAgentLike accepts what @theokit/sdk actually emits', () => {
  it('a real partial event fits the local union', () => {
    const accepted = acceptsSdkEvent(sdkPartial)
    expect(accepted.type).toBe('partial')
  })

  it('a real complete event fits, extra fields and all', () => {
    const accepted = acceptsSdkEvent(sdkComplete)
    expect(accepted.type).toBe('complete')
    // `raw` and `finishReason` are not in our union and must not need to be: the local
    // type is a SUPERTYPE of the SDK event, not a copy that has to track every field.
    expect(sdkComplete.type === 'complete' ? sdkComplete.raw : undefined).toBeDefined()
  })

  it("the SDK's usage shape is priceable — the assertion #61 needed and never had", () => {
    // This is the specific drift that shipped. The SDK reports tokens; the runtime read
    // `costUsd`; the two never met. Pricing the real shape here proves they do now.
    const usage: CopilotUsage =
      sdkComplete.type === 'complete' ? sdkComplete.usage : { inputTokens: 0, outputTokens: 0 }

    const settled = settleCost(usage, 'openrouter/openai/gpt-4o-mini')

    expect(settled.amountUsd, 'the SDK usage shape produced no price').toBeGreaterThan(0)
    expect(settled.source, 'priced without saying where the number came from').toBeTruthy()
  })

  it('a complete event carrying no usage settles as unknown, not as free', () => {
    // The failure mode a naive fix introduces: pricing an unpriceable call at zero makes
    // the ceiling infinite, which is worse than the estimate it replaced.
    const settled = settleCost(undefined, 'openrouter/openai/gpt-4o-mini')
    expect(settled.amountUsd).toBeUndefined()
    expect(settled.status).toBe('no_usage')
  })
})
