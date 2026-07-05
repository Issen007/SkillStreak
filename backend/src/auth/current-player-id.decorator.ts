import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';

// Only valid behind JwtAuthGuard, which populates request.playerId — every
// route using this decorator must also be guarded, or playerId will be
// undefined (a controller-wiring bug to catch in review, not something this
// decorator defends against at runtime).
export const CurrentPlayerId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest<Request>();
    return request.playerId as string;
  },
);
