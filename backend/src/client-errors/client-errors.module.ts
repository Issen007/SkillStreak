import { Module } from '@nestjs/common';
import { ErrorLogModule } from '../error-log/error-log.module';
import { ClientErrorsController } from './client-errors.controller';

/**
 * The ingest endpoint for crashes reported by the Expo app.
 *
 * Its own module rather than a controller inside `error-log/`, for the
 * reason that module's docstring already gives about the admin read side:
 * every module that records a failure imports ErrorLogModule, and
 * importing it must never drag a public HTTP endpoint along with it.
 */
@Module({
  imports: [ErrorLogModule],
  controllers: [ClientErrorsController],
})
export class ClientErrorsModule {}
