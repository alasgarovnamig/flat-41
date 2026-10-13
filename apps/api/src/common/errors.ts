import { HttpException, HttpStatus } from '@nestjs/common';

/** Domain error with a stable machine-readable `code` that clients can switch on. */
export class AppError extends HttpException {
  constructor(code: string, message: string, status: HttpStatus = HttpStatus.BAD_REQUEST) {
    super({ statusCode: status, code, message, error: HttpStatus[status] }, status);
  }
}
export const notFound = (what = 'Resource') => new AppError('NOT_FOUND', `${what} not found`, HttpStatus.NOT_FOUND);
export const forbidden = (msg = 'Forbidden') => new AppError('FORBIDDEN', msg, HttpStatus.FORBIDDEN);
