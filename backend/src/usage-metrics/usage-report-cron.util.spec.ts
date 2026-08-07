import { DEFAULT_USAGE_REPORT_CRON } from './usage-metrics.constants';
import { resolveUsageReportCron } from './usage-report-cron.util';

// docs/adr/0020-usage-analytics-product-metrics.md Decision 6 — cadence is
// a config value with a monthly default, and a bad value must degrade
// rather than crash-loop the pod (@Cron would throw during ScheduleModule
// init on an unparseable expression).
describe('resolveUsageReportCron', () => {
  it('defaults to monthly when USAGE_REPORT_CRON is unset', () => {
    expect(resolveUsageReportCron({})).toEqual({
      expression: DEFAULT_USAGE_REPORT_CRON,
      rejectedValue: null,
    });
  });

  it('defaults to monthly when USAGE_REPORT_CRON is an empty string (the k8s/compose "unset" shape)', () => {
    expect(resolveUsageReportCron({ USAGE_REPORT_CRON: '  ' })).toEqual({
      expression: DEFAULT_USAGE_REPORT_CRON,
      rejectedValue: null,
    });
  });

  it('accepts a 5-field expression (e.g. weekly instead of monthly)', () => {
    expect(resolveUsageReportCron({ USAGE_REPORT_CRON: '30 7 * * 1' })).toEqual(
      { expression: '30 7 * * 1', rejectedValue: null },
    );
  });

  it('accepts a 6-field expression with a leading seconds field', () => {
    expect(
      resolveUsageReportCron({ USAGE_REPORT_CRON: '0 0 6 1 * *' }),
    ).toEqual({ expression: '0 0 6 1 * *', rejectedValue: null });
  });

  it('accepts step/range/list syntax', () => {
    expect(
      resolveUsageReportCron({ USAGE_REPORT_CRON: '0 6 1,15 */2 1-5' })
        .expression,
    ).toBe('0 6 1,15 */2 1-5');
  });

  it('falls back to the default, and reports what it rejected, for a malformed value', () => {
    for (const bad of [
      'monthly',
      '0 6 1 *',
      'every day at six',
      '0 6 1 * * * *',
    ]) {
      expect(resolveUsageReportCron({ USAGE_REPORT_CRON: bad })).toEqual({
        expression: DEFAULT_USAGE_REPORT_CRON,
        rejectedValue: bad,
      });
    }
  });

  // The regression this validation exists for, found by code-critic and
  // reproduced live against the real AppModule: each of these is
  // *shape*-valid (right field count, only legal characters) but throws
  // "Field value is out of range" from @nestjs/schedule's
  // onApplicationBootstrap, which has no try/catch of its own — so before
  // this, a single-character typo in a ConfigMap crash-looped both API
  // replicas, the exact failure four config files promise is impossible.
  it('rejects a shape-valid but out-of-range expression instead of letting it reach @Cron', () => {
    for (const outOfRange of [
      '60 6 1 * *', // minute 60
      '0 24 1 * *', // hour 24
      '0 6 32 * *', // day-of-month 32
      '0 6 1 13 *', // month 13
    ]) {
      expect(resolveUsageReportCron({ USAGE_REPORT_CRON: outOfRange })).toEqual(
        {
          expression: DEFAULT_USAGE_REPORT_CRON,
          rejectedValue: outOfRange,
        },
      );
    }
  });

  it('rejects the other parser-level errors a character-class check cannot see', () => {
    // A reversed range and a zero step — legal characters, right field
    // count, both still throw out of the real parser.
    expect(
      resolveUsageReportCron({ USAGE_REPORT_CRON: '5-1 * * * *' })
        .rejectedValue,
    ).toBe('5-1 * * * *');
    expect(
      resolveUsageReportCron({ USAGE_REPORT_CRON: '*/0 * * * *' })
        .rejectedValue,
    ).toBe('*/0 * * * *');
  });

  it('accepts every expression this repo documents as an example', () => {
    // The values in backend/.env.example, .env.example, docker-compose.yml
    // and k8s/configmap.yaml — a typo in any of them would otherwise only
    // ever be found by a crash-looping pod.
    for (const documented of ['0 6 1 * *', '*/5 * * * *']) {
      expect(
        resolveUsageReportCron({ USAGE_REPORT_CRON: documented }).expression,
      ).toBe(documented);
    }
  });
});
