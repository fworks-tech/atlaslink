import { msg } from '../tasks/taskRegistry'
import type { LLMConfig } from 'agenthood/dist/llm/types.js'
import type { RunEvent } from 'agenthood/dist/core/RunEventBus.js'

export interface AppLike {
  events: { subscribe(listener: (event: RunEvent) => void): () => void }
  runner: {
    runMemberTask(memberName: string, task: string, config: LLMConfig): Promise<{ output: string; durationMs: number }>
  }
}

/**
 * Executes one session to completion: builds a dedicated ApplicationContext,
 * subscribes to its RunEventBus, invokes the member, and finalizes the session
 * from the real run outcome. runMemberTask throws on failure (unlike the CLI's
 * process-exit path), so status is never guessed.
 */
export async function runSession(params: {
  registry: import('../tasks/taskRegistry.js').TaskRegistry
  session: import('../tasks/taskRegistry.js').Session
  config: LLMConfig
  onEvent?: (event: RunEvent) => void
  createApp?: (params: { config: LLMConfig; correlationId: string }) => Promise<AppLike>
}): Promise<import('../tasks/taskRegistry.js').Session> {
  const app = params.createApp
    ? await params.createApp({ config: params.config, correlationId: params.session.correlationId })
    : await (await import('./contextFactory')).createContext({ config: params.config, correlationId: params.session.correlationId })

  const unsubscribe = app.events.subscribe(params.onEvent ?? (() => {}))
  params.registry.start(params.session.id)
  try {
    const { output, durationMs } = await app.runner.runMemberTask(params.session.task.member, params.session.task.prompt, params.config)
    params.registry.succeed(params.session.id, { output, durationMs })
  } catch (err) {
    params.registry.fail(params.session.id, { error: msg(err) })
  } finally {
    unsubscribe()
  }
  return params.registry.get(params.session.id)!
}