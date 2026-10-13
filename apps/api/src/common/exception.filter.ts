import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { Response } from 'express';

/** Normalises every error into the ApiError shape from @evtap/shared. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly log = new Logger('Exceptions');
  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      res.status(status).json(typeof body === 'string' ? { statusCode: status, message: body } : body);
      return;
    }
    const pgCode = (exception as { code?: string })?.code;
    if (pgCode === '23505') {
      res.status(409).json({ statusCode: 409, code: 'CONFLICT', message: 'Already exists', error: 'Conflict' });
      return;
    }
    this.log.error(exception instanceof Error ? exception.stack : String(exception));
    res.status(500).json({ statusCode: 500, code: 'INTERNAL', message: 'Internal server error', error: 'Internal Server Error' });
  }
}
