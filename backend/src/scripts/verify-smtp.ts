// Standalone "Authorize test" for the SMTP config in .env — connects and
// authenticates only, sends nothing. Deliberately doesn't require
// Postgres/Redis to be up (unlike the full app), since this only exercises
// MailModule/AppConfigModule.
//
// Usage: `pnpm run verify:smtp`
import { NestFactory } from '@nestjs/core';
import { Module } from '@nestjs/common';
import { AppConfigModule } from '../config/app-config.module';
import { MailModule } from '../mail/mail.module';
import { MailService } from '../mail/mail.service';

@Module({
  imports: [AppConfigModule, MailModule],
})
class SmtpCheckModule {}

async function run(): Promise<void> {
  const appContext = await NestFactory.createApplicationContext(
    SmtpCheckModule,
    { logger: ['warn', 'error'] },
  );

  const mailService = appContext.get(MailService);
  const result = await mailService.verifyConnection();

  console.log(result.ok ? '✅ SMTP OK' : '❌ SMTP failed');
  console.log(result.message);

  await appContext.close();
  process.exitCode = result.ok ? 0 : 1;
}

run().catch((error: unknown) => {
  console.error('verify-smtp script crashed:', error);
  process.exitCode = 1;
});
