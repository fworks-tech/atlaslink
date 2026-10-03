import { graphql, type GraphQLSchema } from 'graphql'
import type { FastifyInstance, FastifyRequest } from 'fastify'

interface SubgraphBody {
  query?: unknown
  variables?: unknown
  operationName?: unknown
}

/**
 * Mount one subgraph endpoint on the shared Fastify instance at
 * `POST /graphql/<name>` — the spike-proven executor path (buildSubgraphSchema
 * + graphql()), served in-process so the monolith hosts every subgraph until
 * physical extraction. Always HTTP 200 with a GraphQL envelope; only a
 * missing/non-string `query` is a 400.
 */
export function registerSubgraph<TContext>(
  app: FastifyInstance,
  name: string,
  schema: GraphQLSchema,
  makeContext: (request: FastifyRequest) => TContext
): void {
  app.post<{ Body: SubgraphBody }>(`/graphql/${name}`, async (request, reply) => {
    const body = request.body ?? {}
    if (typeof body.query !== 'string' || body.query.length === 0) {
      return reply.code(400).send({ errors: [{ message: 'query must be a non-empty string' }] })
    }
    const result = await graphql({
      schema,
      source: body.query,
      variableValues: isRecord(body.variables) ? body.variables : undefined,
      operationName: typeof body.operationName === 'string' ? body.operationName : undefined,
      contextValue: makeContext(request),
    })
    return reply.send(result)
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
