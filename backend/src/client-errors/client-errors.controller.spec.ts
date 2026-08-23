import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { ErrorLogService } from '../error-log/error-log.service';
import { ClientErrorsController } from './client-errors.controller';
import { ReportClientErrorDto } from './dto/report-client-error.dto';

/**
 * The ingest endpoint is unauthenticated, so what keeps child data out of
 * it is the DTO's shape rather than anything about the caller. These tests
 * exercise that shape through the SAME pipe configuration main.ts installs
 * globally — asserting it in the abstract would prove nothing about what
 * the running app accepts.
 */
const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
});

const meta = {
  type: 'body' as const,
  metatype: ReportClientErrorDto,
};

function valid(): Record<string, unknown> {
  return {
    platform: 'android',
    appVersion: 'v0.3.1',
    errorName: 'TypeError',
    message: 'undefined is not a function',
  };
}

describe('ReportClientErrorDto: what a crashing app may say', () => {
  it('accepts an ordinary report', async () => {
    await expect(pipe.transform(valid(), meta)).resolves.toMatchObject({
      platform: 'android',
      appVersion: 'v0.3.1',
    });
  });

  // The load-bearing test of the whole feature. If a caller can attach a
  // player id, the endpoint has become a channel for exactly the data
  // ADR-0022 Decision 6 built this table to be incapable of holding —
  // and it would arrive from a device, unauthenticated.
  it.each([
    'playerId',
    'teamId',
    'screenName',
    'deviceId',
    'context',
    'breadcrumbs',
  ])(
    'refuses the whole report rather than ignoring a %s field',
    async (field) => {
      await expect(
        pipe.transform({ ...valid(), [field]: 'anything' }, meta),
      ).rejects.toThrow();
    },
  );

  it('refuses a platform outside the fixed vocabulary', async () => {
    await expect(
      pipe.transform({ ...valid(), platform: 'windows-phone' }, meta),
    ).rejects.toThrow();
  });

  it('refuses an app version that is really free text', async () => {
    // The character-set constraint is what stops a 64-character opaque
    // field from becoming somewhere to put a note about the user.
    await expect(
      pipe.transform({ ...valid(), appVersion: 'Emma on the red team' }, meta),
    ).rejects.toThrow();
  });

  it('accepts a report with no stack, which a non-Error throw has', async () => {
    const { stack, ...withoutStack } = { ...valid(), stack: undefined };
    void stack;
    await expect(pipe.transform(withoutStack, meta)).resolves.toBeDefined();
  });
});

describe('ClientErrorsController', () => {
  it('hands the report to ErrorLogService as a client-source row', async () => {
    const record = jest.fn().mockResolvedValue(undefined);
    const controller = new ClientErrorsController({
      record,
    } as unknown as ErrorLogService);

    const dto = new ReportClientErrorDto();
    Object.assign(dto, valid(), { stack: 'Error: x\n    at y (z.tsx:1:1)' });

    await controller.report(dto);

    expect(record).toHaveBeenCalledWith({
      source: 'client',
      platform: 'android',
      appVersion: 'v0.3.1',
      errorName: 'TypeError',
      message: 'undefined is not a function',
      stack: 'Error: x\n    at y (z.tsx:1:1)',
    });
  });

  it('normalises an absent stack to null rather than undefined', async () => {
    const record = jest.fn().mockResolvedValue(undefined);
    const controller = new ClientErrorsController({
      record,
    } as unknown as ErrorLogService);

    const dto = new ReportClientErrorDto();
    Object.assign(dto, valid());

    await controller.report(dto);

    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ stack: null }),
    );
  });
});
