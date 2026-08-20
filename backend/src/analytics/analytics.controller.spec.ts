import { ValidationPipe } from '@nestjs/common';
import { AnalyticsController } from './analytics.controller';
import { RecordSiteVisitDto } from './dto/record-site-visit.dto';
import { SiteLocale } from './entities/site-visit.entity';

/**
 * The public site-visit endpoint.
 *
 * **This file exists because its absence shipped two defects.** The first
 * pass tested only the pure `groupSiteVisits` folding function and
 * verified the route by hand with curl — which never sent
 * `dwellSeconds: null`, and never ran the page in a browser. A security
 * review found both. The endpoint is unauthenticated and anyone on the
 * internet can call it, so its input handling is the part that most needs
 * a test, not the arithmetic behind it.
 *
 * The pipe below is configured exactly as `main.ts` configures the global
 * one; a DTO test against a differently-configured pipe would be testing
 * a validator this app never runs.
 */
const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
});

const meta = {
  type: 'body' as const,
  metatype: RecordSiteVisitDto,
};

function validate(body: unknown): Promise<RecordSiteVisitDto> {
  return pipe.transform(body, meta) as Promise<RecordSiteVisitDto>;
}

describe('RecordSiteVisitDto through the real global pipe', () => {
  it('accepts a bare view', async () => {
    await expect(validate({ locale: 'sv' })).resolves.toMatchObject({
      locale: SiteLocale.SV,
      dwellSeconds: undefined,
    });
  });

  it('accepts a dwell report', async () => {
    await expect(
      validate({ locale: 'en', dwellSeconds: 42 }),
    ).resolves.toMatchObject({ locale: SiteLocale.EN, dwellSeconds: 42 });
  });

  it('lets null through validation — which is why the controller uses ==', async () => {
    // Pinning the surprising half of the bug, not just the fix.
    // `@IsOptional()` skips null as well as undefined, so this is a valid
    // body. The controller must therefore treat it as "no duration
    // reported" rather than as a zero-second read.
    const dto = await validate({ locale: 'sv', dwellSeconds: null });
    expect(dto.dwellSeconds).toBeNull();
    expect(dto.dwellSeconds === undefined).toBe(false);
  });

  it.each([
    ['a negative duration', { locale: 'sv', dwellSeconds: -5 }],
    ['a fractional duration', { locale: 'sv', dwellSeconds: 1.5 }],
    ['a non-numeric duration', { locale: 'sv', dwellSeconds: 'abc' }],
    ['a duration past the ceiling', { locale: 'sv', dwellSeconds: 999999 }],
    ['an unknown language', { locale: 'xx' }],
    ['a mis-cased language', { locale: 'SV' }],
    ['an extra field', { locale: 'sv', referrer: 'https://example.com' }],
  ])('rejects %s', async (_label, body) => {
    await expect(validate(body)).rejects.toBeDefined();
  });

  it('rejects any field that could identify a visitor', async () => {
    // The privacy claim is that the request has no field for these, so it
    // is enforced by shape rather than by restraint. `forbidNonWhitelisted`
    // is what makes that true, and it is worth a test of its own.
    for (const extra of ['sessionId', 'ip', 'userAgent', 'path', 'screen']) {
      await expect(
        validate({ locale: 'sv', [extra]: 'x' }),
      ).rejects.toBeDefined();
    }
  });
});

describe('AnalyticsController: which branch a body takes', () => {
  function build() {
    const service = {
      recordClick: jest.fn().mockResolvedValue(undefined),
      recordSiteView: jest.fn().mockResolvedValue(undefined),
      recordSiteDwell: jest.fn().mockResolvedValue(undefined),
    };
    return { service, controller: new AnalyticsController(service as never) };
  }

  it('counts a view when no duration is present', async () => {
    const { service, controller } = build();
    await controller.recordSiteVisit({ locale: SiteLocale.SV });

    expect(service.recordSiteView).toHaveBeenCalledWith(SiteLocale.SV);
    expect(service.recordSiteDwell).not.toHaveBeenCalled();
  });

  it('counts a view — not a zero-second read — when the duration is null', async () => {
    // THE REGRESSION. `=== undefined` sent this down the dwell path and
    // recorded a 0-second sample, which an unauthenticated caller could
    // repeat to drag the published average toward zero.
    const { service, controller } = build();
    await controller.recordSiteVisit({
      locale: SiteLocale.SV,
      dwellSeconds: null as unknown as undefined,
    });

    expect(service.recordSiteView).toHaveBeenCalledWith(SiteLocale.SV);
    expect(service.recordSiteDwell).not.toHaveBeenCalled();
  });

  it('records a duration when one is present', async () => {
    const { service, controller } = build();
    await controller.recordSiteVisit({
      locale: SiteLocale.EN,
      dwellSeconds: 90,
    });

    expect(service.recordSiteDwell).toHaveBeenCalledWith(SiteLocale.EN, 90);
    expect(service.recordSiteView).not.toHaveBeenCalled();
  });

  it('treats an explicit zero as no reading time rather than a sample', async () => {
    const { service, controller } = build();
    await controller.recordSiteVisit({
      locale: SiteLocale.SV,
      dwellSeconds: 0,
    });

    // 0 is not null, so it reaches the dwell path — the service is what
    // drops it, and that is asserted in the service's own tests.
    expect(service.recordSiteDwell).toHaveBeenCalledWith(SiteLocale.SV, 0);
  });
});
