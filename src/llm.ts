/**
 * Thin wrapper over the Claude API (@anthropic-ai/sdk) used by the direction
 * layer (proposals) and the LocalEngine (grading). Kept minimal on purpose:
 * these are bounded, single-shot calls, so no thinking/streaming plumbing.
 */
import Anthropic from '@anthropic-ai/sdk'

let cached: Anthropic | null = null

/** Lazily construct the client. Resolves credentials from the environment. */
export function getAnthropic(): Anthropic {
  if (!cached) cached = new Anthropic()
  return cached
}

/** True when a credential is available; lets the harness degrade with a clear error. */
export function hasCredentials(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN)
}

export interface CompleteInput {
  model: string
  system: string
  user: string
  maxTokens?: number
}

/** One-shot completion; returns the concatenated text of the response. */
export async function complete(input: CompleteInput): Promise<string> {
  const client = getAnthropic()
  const res = await client.messages.create({
    model: input.model,
    max_tokens: input.maxTokens ?? 4096,
    system: input.system,
    messages: [{ role: 'user', content: input.user }],
  })
  return res.content
    .map((block) => (block.type === 'text' ? block.text : ''))
    .join('')
    .trim()
}
