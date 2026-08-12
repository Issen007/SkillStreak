import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PtModule } from '../pt/pt.module';
import { StaffAuthModule } from '../staff-auth/staff-auth.module';
import { DrillAccessService } from './drill-access.service';
import { DrillGroupsController } from './drill-groups.controller';
import { DrillGroupsService } from './drill-groups.service';
import { DrillLibraryService } from './drill-library.service';
import { DrillsController } from './drills.controller';
import { DrillGroup, DrillGroupDrill } from './entities/drill-group.entity';

/**
 * The coach drill library (ADR-0029 Mechanism 1) and a trainer's own
 * groups over it.
 *
 * The library still has no table — DrillLibraryService reads Markdown
 * files, so there is no drill row for any query to join to a child.
 * Groups do have rows, and that is the one trade this module makes: they
 * reference a `staff_account` and a drill slug, never a player or a team.
 * See the entity and the migration for why that boundary is drawn there.
 *
 * The same files are intended to be ADR-0028 Phase 1's RAG corpus — one
 * corpus, two consumers. If that ships, it reads this directory rather
 * than keeping a second copy.
 */
@Module({
  imports: [
    StaffAuthModule,
    PtModule,
    TypeOrmModule.forFeature([DrillGroup, DrillGroupDrill]),
  ],
  controllers: [DrillsController, DrillGroupsController],
  providers: [DrillLibraryService, DrillGroupsService, DrillAccessService],
  exports: [DrillLibraryService],
})
export class DrillsModule {}
