export class PublishError extends Error {
  constructor(message, { code = 'publish_error', retryable = true, status = 502, details = null } = {}) {
    super(message);
    this.name = 'PublishError';
    this.code = code;
    this.retryable = retryable;
    this.status = status;
    this.details = details;
  }
}

export function configError(message) {
  return new PublishError(message, { code: 'integration_not_configured', retryable: false, status: 503 });
}
export function authError(message) {
  return new PublishError(message, { code: 'account_reauthorization_required', retryable: false, status: 401 });
}
export function duplicateError(message) {
  return new PublishError(message, { code: 'duplicate_post', retryable: false, status: 409 });
}
