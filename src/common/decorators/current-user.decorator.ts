import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { JwtUser, MaybeAuthenticatedRequest } from '../types/authenticated-request';

export const CurrentUser = createParamDecorator(
  (data: keyof JwtUser | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<MaybeAuthenticatedRequest>();
    const user = request.user;
    return data ? user?.[data] : user;
  },
);
