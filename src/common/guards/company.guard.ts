import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import type { MaybeAuthenticatedRequest } from '../types/authenticated-request';

@Injectable()
export class CompanyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<MaybeAuthenticatedRequest>();
    const user = request.user;
    const paramCompanyId = request.params?.companyId;

    if (paramCompanyId && paramCompanyId !== user?.companyId) {
      throw new ForbiddenException('Access denied to this company\'s resources');
    }
    return true;
  }
}
