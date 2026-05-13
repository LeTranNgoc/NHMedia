import type { FastifyError, FastifyRequest, FastifyReply } from 'fastify';

interface AppError extends Error {
  statusCode?: number;
  code?: string;
  validation?: unknown[];
}

/**
 * Centralized Fastify error handler.
 * Never leaks stack traces. Returns structured { code, message }.
 */
export function errorHandler(
  error: FastifyError | AppError,
  _request: FastifyRequest,
  reply: FastifyReply,
): void {
  // Fastify validation errors (from schema or @fastify/rate-limit)
  if ('validation' in error && error.validation) {
    void reply.status(400).send({
      code: 'VALIDATION_ERROR',
      message: error.message,
    });
    return;
  }

  const status = (error as AppError).statusCode ?? 500;
  const code =
    (error as AppError).code ??
    (status === 401
      ? 'UNAUTHORIZED'
      : status === 403
        ? 'FORBIDDEN'
        : status === 404
          ? 'NOT_FOUND'
          : status === 429
            ? 'RATE_LIMITED'
            : status === 503
              ? 'SERVICE_UNAVAILABLE'
              : 'INTERNAL_ERROR');

  const message =
    status < 500
      ? error.message
      : 'An internal error occurred'; // never leak 5xx details

  void reply.status(status).send({ code, message });
}
