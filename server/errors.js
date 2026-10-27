export class AppError extends Error {
  constructor(status, code, message, details = null) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function badRequest(message = 'Invalid request', details = null) {
  return new AppError(400, 'bad_request', message, details);
}
export function unauthorized(message = 'Authentication required') {
  return new AppError(401, 'unauthorized', message);
}
export function forbidden(message = 'You do not have access to this resource') {
  return new AppError(403, 'forbidden', message);
}
export function notFound(message = 'Resource not found') {
  return new AppError(404, 'not_found', message);
}
export function conflict(message = 'Resource already exists', details = null) {
  return new AppError(409, 'conflict', message, details);
}
export function tooMany(message = 'Too many requests') {
  return new AppError(429, 'rate_limited', message);
}
export function serviceUnavailable(message = 'Service temporarily unavailable') {
  return new AppError(503, 'service_unavailable', message);
}

export function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

export function errorMiddleware(err, req, res, _next) {
  if (res.headersSent) return;
  const status = err instanceof AppError ? err.status : (err.status >= 400 && err.status < 600 ? err.status : 500);
  const code = err instanceof AppError ? err.code : (status === 500 ? 'internal_error' : 'request_error');
  const body = {
    error: {
      code,
      message: status === 500 ? 'An unexpected server error occurred.' : err.message,
      ...(err.details ? { details: err.details } : {}),
      requestId: req.id,
    },
  };
  if (status >= 500) req.log?.error({ err: { message: err.message, stack: err.stack, code: err.code, status }, code }, 'Request failed');
  else req.log?.warn({ err: { message: err.message, code }, code }, 'Request rejected');
  res.status(status).json(body);
}
