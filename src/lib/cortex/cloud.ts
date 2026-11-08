/**
 * Cloud refinement engine — backend-only bridge to the GLM model via
 * z-ai-web-dev-sdk. Used as the "Deep-Path" executor when local Ollama is
 * offline, so the Tier-1 rewriter is always demonstrable end-to-end.
 * The SDK MUST stay on the server — it is never imported client-side.
 */
import ZAI from 'z-ai-web-dev-sdk'

interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

let zaiInstance: Awaited<ReturnType<typeof ZAI.create>> | null = null

async function getClient() {
  if (!zaiInstance) {
    zaiInstance = await ZAI.create()
  }
  return zaiInstance
}

export async function cloudChat(messages: ChatMessage[], retries = 2): Promise<string> {
  let lastError: unknown = null

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const client = await getClient()
      const completion = await client.chat.completions.create({
        messages,
        thinking: { type: 'disabled' },
      })
      const content = completion.choices[0]?.message?.content?.trim()
      if (!content) {
        throw new Error('Cloud engine returned an empty completion')
      }
      return content
    } catch (error) {
      lastError = error
      if (attempt < retries) {
        await new Promise((resolve) => setTimeout(resolve, 600 * attempt))
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Cloud engine failed')
}
