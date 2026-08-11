import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';
import { StaffAccountRole } from '../staff-auth/entities/staff-account.entity';

/**
 * The role claim from the staff session, as a display/branching hint.
 *
 * Only valid behind StaffAuthGuard/PtAuthGuard, which populate it. Read
 * from the JWT rather than the database, so it must never be the thing
 * that grants access — `AdminAuthGuard` deliberately distrusts this claim
 * for exactly that reason. Use it to decide what to *show*, never what to
 * *allow*.
 */
export const CurrentStaffRole = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): StaffAccountRole | undefined => {
    const request = ctx.switchToHttp().getRequest<Request>();
    return request.staffRole;
  },
);
