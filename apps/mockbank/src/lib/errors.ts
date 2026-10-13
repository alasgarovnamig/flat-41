/** Error rendered by the merchant API as `{ error: code, message, details? }`. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message?: string,
    public readonly details?: unknown,
  ) {
    super(message ?? code);
  }
}

export const invalidSignature = () => new ApiError(401, 'INVALID_SIGNATURE', 'Invalid merchant signature');
export const orderNotFound = () => new ApiError(404, 'ORDER_NOT_FOUND', 'Order not found');
export const validationError = (details: string[]) =>
  new ApiError(400, 'VALIDATION_ERROR', details.join('; '), details);
