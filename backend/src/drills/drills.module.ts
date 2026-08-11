import { Module } from '@nestjs/common';
import { PtModule } from '../pt/pt.module';
import { StaffAuthModule } from '../staff-auth/staff-auth.module';
import { DrillLibraryService } from './drill-library.service';
import { DrillsController } from './drills.controller';

/**
 * The coach drill library (ADR-0029 Mechanism 1).
 *
 * No TypeOrmModule import, and that absence is the design: the library has
 * no table, so there is no row for any query to join to a child. See
 * DrillLibraryService.
 *
 * The same files are intended to be ADR-0028 Phase 1's RAG corpus — one
 * corpus, two consumers. If that ships, it reads this directory rather
 * than keeping a second copy.
 */
@Module({
  imports: [StaffAuthModule, PtModule],
  controllers: [DrillsController],
  providers: [DrillLibraryService],
  exports: [DrillLibraryService],
})
export class DrillsModule {}
