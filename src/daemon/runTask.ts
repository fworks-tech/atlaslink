import { msg } from '../tasks/taskRegistry'
import { createContext } from './contextFactory'
import type { LLMConfig } from 'agenthood/dist/llm/types.js'
import type { RunEvent } from 'agenthood/dist/core/RunEventBus.js'
import { AskHumanSignal } from 'agenthood/dist/tools/human/AskHumanTool.js'

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
 * process-exit path), so status is never guessed. An AskHumanSignal parks the
 * session instead of failing it: the worker already returned, so the pump
 * slot is free the moment this function returns — no orphan, nothing held.
 *
 * A human steer/interrupt aborts the in-flight run: the call is raced against
 * the session's AbortController, and the abort win finalizes CANCELLED and
 * frees the slot immediately. The orphaned provider call still completes in
 * the background, but its continuations are suppressed — a late park must not
 * resurrect a cancelled session, and its output is discarded. (Provider-side
 * abort is a follow-up: the single-shot runMemberTask has no step boundary
 * to poll and the SDK path takes no signal.)
 */
export async function runSession(params: {
  registry: import('../tasks/taskRegistry.js').TaskRegistry
  session: import('../tasks/taskRegistry.js').Session
  config: LLMConfig
  onEvent?: (event: RunEvent) => void
  createApp?: (params: { config: LLMConfig; correlationId: string }) => Promise<AppLike>
}): Promise<import('../tasks/taskRegistry.js').Session> {
  params.registry.start(params.session.id)
  const controller = new AbortController()
  params.registry.attachAbort(params.session.id, controller)
  let unsubscribe = (): void => {}
  try {
    const app = params.createApp
      ? await params.createApp({ config: params.config, correlationId: params.session.correlationId })
      : await createContext({ config: params.config, correlationId: params.session.correlationId })

    unsubscribe = app.events.subscribe(params.onEvent ?? (() => {}))
    // settled values, never rejections: the raw promise keeps exactly one
    // consumer (this chain), so the post-abort orphan cannot go unhandled
    const run = app.runner
      .runMemberTask(params.session.task.member, params.session.task.prompt, params.config)
      .then(
        (res) => ({ aborted: false as const, ok: true as const, res }),
        (err) => ({ aborted: false as const, ok: false as const, err }),
      )
    const aborted = new Promise<{ aborted: true }>((resolve) => {
      if (controller.signal.aborted) resolve({ aborted: true as const })
      else controller.signal.addEventListener('abort', () => resolve({ aborted: true as const }), { once: true })
    })
    const outcome = await Promise.race([run, aborted])
    if (outcome.aborted) {
      // the human already has their answer (202/interrupt ack) — finalize now.
      // The orphan settles later into the suppressed chain above: no park, no
      // succeed, no fail, no unhandled rejection.
      try {
        params.registry.cancel(params.session.id)
      } catch {
        // the run finalized in the same tick — its outcome stands
      }
    } else if (!outcome.ok) {
      const err = outcome.err
      if (err instanceof AskHumanSignal) {
        params.registry.park(params.session.id, { question: err.payload })
      } else {
        params.registry.fail(params.session.id, { error: msg(err) })
      }
    } else {
      params.registry.succeed(params.session.id, { output: outcome.res.output, durationMs: outcome.res.durationMs })
    }
  } catch (err) {
    // the race promises settle values, never rejections — this only fires
    // when setup (createApp/subscribe) blew up before the run existed
    try {
      params.registry.fail(params.session.id, { error: msg(err) })
    } catch {
      // already finalized (abort won the same tick) — its outcome stands
    }
  } finally {
    params.registry.untrackAbort(params.session.id)
    unsubscribe()
  }
  return params.registry.get(params.session.id)!
}
