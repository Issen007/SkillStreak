import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';

// Only valid behind StaffAuthGuard/PtAuthGuard (staff-auth/guards/), which
// populate request.staffAccountId — mirrors auth/current-player-id.decorator.ts's
// exact shape/reasoning for the player-facing JwtAuthGuard.
export const CurrentStaffAccountId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest<Request>();
    return request.staffAccountId as string;
  },
);
