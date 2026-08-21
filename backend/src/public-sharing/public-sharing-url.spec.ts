import { PATH_METADATA } from '@nestjs/common/constants';
import { Repository } from 'typeorm';
import { PlayerPrivateInfoService } from '../player-private-info/player-private-info.service';
import { PublicSharingConsent } from './entities/public-sharing-consent.entity';
import { PublicSharingConsentService } from './public-sharing-consent.service';
import { PublicSharingPublicController } from './public-sharing-public.controller';

/**
 * The links SkillStreak mails a parent must resolve on the API that mails
 * them.
 *
 * This exists because on 2026-08-21 they did not. Both builders wrote
 * `/api/v1/public-sharing-consent/...` — the service *file*'s name —
 * while `PublicSharingPublicController` mounts `/api/v1/public-sharing/...`,
 * so the first consent mail ever delivered in production handed a parent
 * `Cannot GET /api/v1/public-sharing-consent/GSK2777S`. Nothing caught it:
 * the HTML templates build their own (correct) form actions, the unit
 * suite never looked at a mail body, and an e2e test that hard-coded the
 * path would have agreed with whichever copy it was written against.
 *
 * So the assertion here is deliberately *not* against a third copy of the
 * string. It reads the controller's own Nest route metadata and requires
 * every mailed URL to match one of the routes actually mounted. Rename a
 * route and this fails until the mail follows.
 */

const BASE = 'https://api.example.test';

/** Every GET path `PublicSharingPublicController` mounts, as a matcher. */
function mountedGetRoutes(): RegExp[] {
  const rawPrefix: unknown = Reflect.getMetadata(
    PATH_METADATA,
    PublicSharingPublicController,
  );
  const prefix = (typeof rawPrefix === 'string' ? rawPrefix : '').replace(
    /^\/|\/$/g,
    '',
  );

  const proto = PublicSharingPublicController.prototype as unknown as Record<
    string,
    unknown
  >;

  return Object.getOwnPropertyNames(proto)
    .filter((name) => name !== 'constructor')
    .map((name): unknown =>
      Reflect.getMetadata(PATH_METADATA, proto[name] as object),
    )
    .filter((path): path is string => typeof path === 'string')
    .map((path) => [prefix, path.replace(/^\//, '')].filter(Boolean).join('/'))
    .map(
      (path) => new RegExp(`^/${path.replace(/:[^/]+/g, '[^/]+')}(?:/[^/]+)?$`),
    );
}

/**
 * Mails go out best-effort and off the transaction, so the assertion is on
 * what was handed to the mail service — the same string the parent sees.
 */
function urlsIn(bodies: string[]): string[] {
  return bodies.flatMap((body) => body.match(/https?:\/\/\S+/g) ?? []);
}

function build() {
  const rows: PublicSharingConsent[] = [];
  const repo = {
    rows,
    create: (partial: Partial<PublicSharingConsent>) =>
      ({ id: 'id-1', ...partial }) as PublicSharingConsent,
    save: jest.fn((row: PublicSharingConsent) => {
      if (!rows.includes(row)) rows.push(row);
      return Promise.resolve(row);
    }),
    findOne: jest.fn(() => Promise.resolve(null)),
    update: jest.fn(() => Promise.resolve({ affected: 1 })),
    createQueryBuilder: () => {
      const qb = {
        setLock: () => qb,
        where: () => qb,
        getOne: () => Promise.resolve(rows[0] ?? null),
      };
      return qb;
    },
  };
  const mailService = {
    sendMail: jest.fn(() => Promise.resolve({ handedOff: true, rejected: [] })),
  };
  const service = new PublicSharingConsentService(
    repo as unknown as Repository<PublicSharingConsent>,
    {
      findOne: jest.fn().mockResolvedValue({ screenName: 'FloorballStar15' }),
    } as never,
    {
      transaction: (fn: (m: unknown) => unknown) =>
        Promise.resolve(fn({ getRepository: () => repo })),
    } as never,
    {
      getParentContact: jest.fn(() => Promise.resolve('parent@example.se')),
      hasPendingContactChange: jest.fn(() => Promise.resolve(false)),
    } as unknown as PlayerPrivateInfoService,
    mailService as never,
    {
      tryClaimPublicSharingRequestCooldown: jest.fn(() =>
        Promise.resolve(true),
      ),
      tryClaimPublicSharingRequestDailyCap: jest.fn(() =>
        Promise.resolve(true),
      ),
    } as never,
    {
      getOrThrow: jest.fn(() => 'Y2ktb25seS10ZXN0LWtleS0zMi1ieXRlcy1sb25nISE='),
      get: jest.fn(() => BASE),
    } as never,
  );
  const sentBodies = () =>
    mailService.sendMail.mock.calls.map(
      (call) => (call[0] as unknown as { text: string }).text,
    );
  return { service, repo, mailService, sentBodies };
}

describe('the links a parent is mailed', () => {
  it('mounts every route the request and approval mails point at', async () => {
    const { service, repo, sentBodies } = build();

    await service.request('player-1');
    await service.approveByReviewCode(repo.rows[0].reviewCode!);

    const urls = urlsIn(sentBodies());
    // Two mails, two links: approve the request, then turn it back off.
    expect(urls).toHaveLength(2);

    const routes = mountedGetRoutes();
    expect(routes.length).toBeGreaterThan(0);

    for (const url of urls) {
      expect(url.startsWith(`${BASE}/`)).toBe(true);
      const path = url.slice(BASE.length);
      expect(
        routes.some((route) => route.test(path)),
        // Jest prints the matcher, not the path, on failure — so name it.
      ).toBe(true);
      if (!routes.some((route) => route.test(path))) {
        throw new Error(`mailed link ${path} matches no mounted route`);
      }
    }
  });
});
