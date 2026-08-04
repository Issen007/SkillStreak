import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client, Issuer } from 'openid-client';
import { sign } from 'jsonwebtoken';
import { StaffAuthProvider } from './entities/staff-account.entity';

const DEFAULT_APP_PUBLIC_URL = 'http://localhost:3000';

// Fixed, provider-inherent discovery issuers — not per-cluster config,
// unlike the OAuth client id/secret and the redirect URI (ADR-0023
// Decision B6: redirect URIs reuse the existing APP_PUBLIC_URL ConfigMap
// value, no new URL config is introduced). `common` accepts both personal
// Microsoft accounts and any Entra ID tenant — narrowing to one specific
// tenant is a plausible future config knob, not needed for a small
// internal staff/PT user base.
const ISSUER_URL: Record<StaffAuthProvider, string> = {
  [StaffAuthProvider.GOOGLE]: 'https://accounts.google.com',
  [StaffAuthProvider.MICROSOFT]:
    'https://login.microsoftonline.com/common/v2.0',
  [StaffAuthProvider.APPLE]: 'https://appleid.apple.com',
};

// One generic OIDC client library used three times (ADR-0023 Decision B6),
// rather than three separate Passport strategy packages.
@Injectable()
export class StaffOidcClientsService {
  // Only the (network-round-trip) discovery document is worth caching per
  // provider — client instances themselves are cheap to (re)construct, and
  // for Apple must be rebuilt per use anyway (see buildClient below).
  private readonly issuers = new Map<
    StaffAuthProvider,
    Promise<Issuer<Client>>
  >();
  private readonly staticClients = new Map<StaffAuthProvider, Client>();

  constructor(private readonly configService: ConfigService) {}

  redirectUriFor(provider: StaffAuthProvider): string {
    const appPublicUrl =
      this.configService.get<string>('APP_PUBLIC_URL') ??
      DEFAULT_APP_PUBLIC_URL;
    return `${appPublicUrl}/api/v1/staff-auth/${provider}/callback`;
  }

  async getClient(provider: StaffAuthProvider): Promise<Client> {
    const issuer = await this.getIssuer(provider);

    // Apple's "client secret" is a JWT this app signs itself, not a static
    // string (ADR-0023 Decision B6) — rebuilt fresh on every call rather
    // than cached/pre-generated-and-rotated, since APPLE_PRIVATE_KEY/
    // APPLE_KEY_ID/APPLE_TEAM_ID are already held directly as Secrets. This
    // removes the "remember to regenerate before it expires" operational
    // task the ADR names as a real (if small) risk for a
    // pre-generated-and-stored alternative — an ES256 signature is cheap,
    // and staff/PT login is low-volume traffic.
    if (provider === StaffAuthProvider.APPLE) {
      return new issuer.Client({
        client_id: this.requireEnv('APPLE_OAUTH_CLIENT_ID'),
        client_secret: this.buildAppleClientSecret(),
        redirect_uris: [this.redirectUriFor(provider)],
        response_types: ['code'],
        token_endpoint_auth_method: 'client_secret_post',
      });
    }

    let client = this.staticClients.get(provider);
    if (!client) {
      const prefix =
        provider === StaffAuthProvider.GOOGLE ? 'GOOGLE' : 'MICROSOFT';
      client = new issuer.Client({
        client_id: this.requireEnv(`${prefix}_OAUTH_CLIENT_ID`),
        client_secret: this.requireEnv(`${prefix}_OAUTH_CLIENT_SECRET`),
        redirect_uris: [this.redirectUriFor(provider)],
        response_types: ['code'],
      });
      this.staticClients.set(provider, client);
    }
    return client;
  }

  private async getIssuer(
    provider: StaffAuthProvider,
  ): Promise<Issuer<Client>> {
    let pending = this.issuers.get(provider);
    if (!pending) {
      pending = Issuer.discover(ISSUER_URL[provider]);
      this.issuers.set(provider, pending);
    }
    try {
      return await pending;
    } catch (error) {
      // Don't cache a failed discovery attempt — a transient network blip
      // talking to the provider's own discovery endpoint shouldn't
      // permanently wedge this provider until the pod restarts.
      this.issuers.delete(provider);
      throw error;
    }
  }

  private requireEnv(key: string): string {
    const value = this.configService.get<string>(key);
    if (!value) {
      throw new InternalServerErrorException(
        `${key} is not configured — this provider's OAuth application ` +
          "hasn't been registered yet (see docs/adr/0023-pt-role-and-" +
          'staff-sso-rbac.md Decision B6).',
      );
    }
    return value;
  }

  private buildAppleClientSecret(): string {
    const teamId = this.requireEnv('APPLE_TEAM_ID');
    const keyId = this.requireEnv('APPLE_KEY_ID');
    const clientId = this.requireEnv('APPLE_OAUTH_CLIENT_ID');
    // .env/Secret values can't hold real newlines — the private key is
    // stored with literal `\n` escapes, same convention this app would
    // need for any other multi-line PEM secret.
    const privateKey = this.requireEnv('APPLE_PRIVATE_KEY').replace(
      /\\n/g,
      '\n',
    );

    return sign({}, privateKey, {
      algorithm: 'ES256',
      keyid: keyId,
      issuer: teamId,
      subject: clientId,
      audience: 'https://appleid.apple.com',
      expiresIn: '5m',
    });
  }
}
