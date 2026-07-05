// One-off manual test: (re)issues a consent token for an existing player
// and sends the real parental-consent email, using the exact same pieces
// OnboardingService uses (PlayersService.setConsentToken +
// buildConsentRequestEmail + MailService.sendMail) via a minimal Nest
// application context — not the full app/HTTP stack, and not a raw-SQL
// send. Doesn't create a player (avoids onboarding's duplicate-screenName
// check) — only looks an existing one up.
//
// Usage: `pnpm run send:test-consent-email [screenName]`
// (defaults to IssenDissen; reads DATABASE_URL/SMTP_*/APP_PUBLIC_URL from
// .env, same as the other scripts).
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { AppConfigModule } from '../config/app-config.module';
import { DatabaseModule } from '../database/database.module';
import { MailModule } from '../mail/mail.module';
import { MailService } from '../mail/mail.service';
import { buildConsentRequestEmail } from '../mail/templates/consent-request-email.template';
import { PlayerPrivateInfoModule } from '../player-private-info/player-private-info.module';
import { PlayerPrivateInfoService } from '../player-private-info/player-private-info.service';
import { generateConsentToken } from '../players/consent-token.util';
import { PlayersModule } from '../players/players.module';
import { PlayersService } from '../players/players.service';
import { TeamsModule } from '../teams/teams.module';
import { TeamsService } from '../teams/teams.service';

const DEFAULT_APP_PUBLIC_URL = 'http://localhost:3000';

@Module({
  imports: [
    AppConfigModule,
    DatabaseModule,
    PlayersModule,
    TeamsModule,
    PlayerPrivateInfoModule,
    MailModule,
  ],
})
class SendTestConsentEmailModule {}

async function run(): Promise<void> {
  const screenName = process.argv[2] ?? 'IssenDissen';

  const appContext = await NestFactory.createApplicationContext(
    SendTestConsentEmailModule,
    { logger: ['warn', 'error'] },
  );

  try {
    const playersService = appContext.get(PlayersService);
    const teamsService = appContext.get(TeamsService);
    const playerPrivateInfoService = appContext.get(PlayerPrivateInfoService);
    const mailService = appContext.get(MailService);
    const configService = appContext.get(ConfigService);
    const dataSource = appContext.get(DataSource);

    const player = await playersService.findByScreenName(screenName);
    if (!player) {
      throw new Error(`No player found with screen_name = '${screenName}'.`);
    }

    const team = await teamsService.findById(player.teamId);
    if (!team) {
      throw new Error(
        `Player ${player.id} references missing team ${player.teamId}.`,
      );
    }

    const parentContact = await playerPrivateInfoService.getParentContact(
      player.id,
    );
    if (!parentContact) {
      throw new Error(`No parent_contact on file for player ${player.id}.`);
    }

    const { token, expiresAt } = generateConsentToken();
    await dataSource.transaction((manager) =>
      playersService.setConsentToken(manager, player.id, token, expiresAt),
    );

    const appPublicUrl =
      configService.get<string>('APP_PUBLIC_URL') ?? DEFAULT_APP_PUBLIC_URL;
    const consentUrl = `${appPublicUrl}/api/v1/consent/${token}`;
    const email = buildConsentRequestEmail({
      screenName: player.screenName,
      teamName: team.name,
      consentUrl,
    });

    await mailService.sendMail({
      to: parentContact,
      subject: email.subject,
      html: email.html,
      text: email.text,
    });

    // Host/path only in the log — the token itself is a bearer-secret and
    // must never be printed.
    const url = new URL(consentUrl);
    console.log(`Consent email sent for player ${screenName} (${player.id}).`);
    console.log(
      `Consent link sent to the parent (host/path only): ${url.host}${url.pathname}`,
    );
    console.log(`Token expires at: ${expiresAt.toISOString()}`);
  } finally {
    await appContext.close();
  }
}

run().catch((error: unknown) => {
  console.error('send-test-consent-email script failed:', error);
  process.exitCode = 1;
});
