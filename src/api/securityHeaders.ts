import type { FastifyInstance } from 'fastify'

/**
 * Security headers — applied via onSend hook so they reach every response
 * including SSE streams and error envelopes. No external dependency.
 *
 * CSP allows: self for scripts/styles, 'unsafe-inline' for styles (Mantine),
 * data: for images (inline SVGs), and the configured API origin for connections
 * (SSE). The dashboard is same-origin so 'self' covers the BFF proxy.
 */
export function registerSecurityHeaders(app: FastifyInstance, apiOrigin: string): void {
  app.addHook('onSend', (request, reply, payload, done) => {
    reply.header('X-Content-Type-Options', 'nosniff')
    reply.header('X-Frame-Options', 'DENY')
    reply.header('Referrer-Policy', 'strict-origin-when-cross-origin')
    reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
    reply.header(
      'Content-Security-Policy',
      [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data:",
        `connect-src 'self' ${apiOrigin}`,
        "font-src 'self' data:",
        "object-src 'none'",
        "base-uri 'self'",
        "frame-ancestors 'none'",
      ].join('; ')
    )
    done(null, payload)
  })
}
