import { ApplicationContext } from 'agenthood/dist/runtime/ApplicationContext.js'
import { MissingApiKeyError } from 'agenthood/dist/llm/validateApiKeys.js'
import type { LLMConfig } from 'agenthood/dist/llm/types.js'

/**
 * Validates the agenthood LLM config at boot. Fails fast with a clear message
 * when the provider key is absent instead of hanging on first use.
 */
export function validateConfig(config: LLMConfig): void {
  ApplicationContext.validateConfig(config)
}

/**
 * Builds one ApplicationContext per session. Deliberately NOT called at boot:
 * ApplicationContext.create connects the vector store and touches the LLM
 * (pattern re-index), so contexts are created lazily when a task actually runs.
 */
export async function createContext(params: {
  config: LLMConfig
  correlationId: string
}): Promise<ApplicationContext> {
  const app = await ApplicationContext.create(process.cwd(), params.config)
  app.ctx.source = 'api'
  app.ctx.correlationId = params.correlationId
  return app
}

export { MissingApiKeyError }
