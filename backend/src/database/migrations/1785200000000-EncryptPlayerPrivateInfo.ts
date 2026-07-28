import { MigrationInterface, QueryRunner } from 'typeorm';
import {
  decryptPii,
  encryptPii,
  requirePiiEncryptionKeyFromEnv,
} from '../../common/crypto/pii-encryption.util';

// Fas 4 encryption-at-rest, 2026-07-28 — see
// backend/src/common/crypto/pii-encryption.util.ts's comment for why this
// is application-level AES-256-GCM, not Postgres' pgcrypto. No column
// type change (parent_contact/real_name are already unbounded varchar,
// plenty of room for the base64-encoded ciphertext) — this is a pure data
// migration, encrypting every existing plaintext value in place.
// PlayerPrivateInfoService's createForNewPlayer/getParentContact/
// getRealName already encrypt/decrypt going forward as of this same
// change — this migration only covers rows that existed before it.
export class EncryptPlayerPrivateInfo1785200000000 implements MigrationInterface {
  name = 'EncryptPlayerPrivateInfo1785200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const key = requirePiiEncryptionKeyFromEnv();
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- queryRunner.query returns any; the shape is guaranteed by the SELECT above
    const rows: Array<{
      player_id: string;
      real_name: string | null;
      parent_contact: string;
    }> = await queryRunner.query(
      `SELECT player_id, real_name, parent_contact FROM "player_private_info"`,
    );

    for (const row of rows) {
      await queryRunner.query(
        `UPDATE "player_private_info" SET "real_name" = $1, "parent_contact" = $2 WHERE "player_id" = $3`,
        [
          row.real_name === null ? null : encryptPii(row.real_name, key),
          encryptPii(row.parent_contact, key),
          row.player_id,
        ],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const key = requirePiiEncryptionKeyFromEnv();
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- queryRunner.query returns any; the shape is guaranteed by the SELECT above
    const rows: Array<{
      player_id: string;
      real_name: string | null;
      parent_contact: string;
    }> = await queryRunner.query(
      `SELECT player_id, real_name, parent_contact FROM "player_private_info"`,
    );

    for (const row of rows) {
      await queryRunner.query(
        `UPDATE "player_private_info" SET "real_name" = $1, "parent_contact" = $2 WHERE "player_id" = $3`,
        [
          row.real_name === null ? null : decryptPii(row.real_name, key),
          decryptPii(row.parent_contact, key),
          row.player_id,
        ],
      );
    }
  }
}
