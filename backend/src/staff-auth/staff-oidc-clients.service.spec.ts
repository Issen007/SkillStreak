import { generateKeyPairSync } from 'crypto';
import { decode } from 'jsonwebtoken';
import { ConfigService } from '@nestjs/config';
import { Issuer } from 'openid-client';
import { StaffAuthProvider } from './entities/staff-account.entity';
import { StaffOidcClientsService } from './staff-oidc-clients.service';

// Never hits the network — Issuer.discover is mocked outright, since this
// spec only cares about StaffOidcClientsService's own logic (env wiring,
// the Apple client-secret JWT it signs itself), not real provider
// discovery documents (see ADR-0023 Decision B3's own "don't attempt live
// OAuth testing" reasoning).
jest.mock('openid-client', () => {
  const actual =
    jest.requireActual<typeof import('openid-client')>('openid-client');
  class FakeClient {
    metadata: Record<string, unknown>;
    constructor(metadata: Record<string, unknown>) {
      this.metadata = metadata;
    }
  }
  return {
    ...actual,
    Issuer: {
      discover: jest.fn().mockResolvedValue({ Client: FakeClient }),
    },
  };
});

describe('StaffOidcClientsService', () => {
  beforeEach(() => {
    // eslint-disable-next-line @typescript-eslint/unbound-method -- Issuer.discover is a jest.fn(), never called unbound
    const discoverMock = Issuer.discover as jest.Mock;
    discoverMock.mockClear();
  });

  function buildConfig(values: Record<string, string>): ConfigService {
    return {
      get: (key: string) => values[key],
    } as unknown as ConfigService;
  }

  it('builds a fresh, short-lived ES256 client_secret JWT for Apple from APPLE_TEAM_ID/APPLE_KEY_ID/APPLE_OAUTH_CLIENT_ID/APPLE_PRIVATE_KEY', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('ec', {
      namedCurve: 'prime256v1',
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    });
    void publicKey;

    const configService = buildConfig({
      APP_PUBLIC_URL: 'https://api.example.com',
      APPLE_OAUTH_CLIENT_ID: 'com.example.services',
      APPLE_TEAM_ID: 'TEAMID1234',
      APPLE_KEY_ID: 'KEYID5678',
      // .env/Secret values store real newlines as literal `\n` escapes —
      // see StaffOidcClientsService's own comment.
      APPLE_PRIVATE_KEY: privateKey.replace(/\n/g, '\\n'),
    });

    const service = new StaffOidcClientsService(configService);
    const client = (await service.getClient(
      StaffAuthProvider.APPLE,
    )) as unknown as {
      metadata: { client_id: string; client_secret: string };
    };

    expect(client.metadata.client_id).toBe('com.example.services');

    const decoded = decode(client.metadata.client_secret, { complete: true });
    expect(decoded).not.toBeNull();
    expect(decoded?.header.alg).toBe('ES256');
    expect(decoded?.header.kid).toBe('KEYID5678');
    const payload = decoded?.payload as {
      iss: string;
      sub: string;
      aud: string;
      exp: number;
      iat: number;
    };
    expect(payload.iss).toBe('TEAMID1234');
    expect(payload.sub).toBe('com.example.services');
    expect(payload.aud).toBe('https://appleid.apple.com');
    // Short-lived (5 minutes), not a static, long-lived secret stored
    // anywhere — see the service's own comment on why this removes the
    // periodic manual-regeneration task the ADR names as a real risk for
    // a pre-generated alternative.
    expect(payload.exp - payload.iat).toBe(5 * 60);
  });

  it('builds a static-secret client for Google from GOOGLE_OAUTH_CLIENT_ID/SECRET, and caches it across calls', async () => {
    const configService = buildConfig({
      APP_PUBLIC_URL: 'https://api.example.com',
      GOOGLE_OAUTH_CLIENT_ID: 'google-client-id',
      GOOGLE_OAUTH_CLIENT_SECRET: 'google-client-secret',
    });
    const service = new StaffOidcClientsService(configService);

    const first = await service.getClient(StaffAuthProvider.GOOGLE);
    const second = await service.getClient(StaffAuthProvider.GOOGLE);

    expect(first).toBe(second);
    // eslint-disable-next-line @typescript-eslint/unbound-method -- Issuer.discover is a jest.fn(), never called unbound
    const discoverMock = Issuer.discover as jest.Mock;
    expect(discoverMock).toHaveBeenCalledTimes(1);
  });

  it("throws a clear error when a provider's OAuth credentials are not configured yet", async () => {
    const configService = buildConfig({
      APP_PUBLIC_URL: 'https://api.example.com',
    });
    const service = new StaffOidcClientsService(configService);

    await expect(service.getClient(StaffAuthProvider.GOOGLE)).rejects.toThrow(
      /GOOGLE_OAUTH_CLIENT_ID/,
    );
  });
});
