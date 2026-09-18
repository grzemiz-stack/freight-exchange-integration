import type { Request } from 'express';

export interface JwtUser {
  userId: string;
  companyId: string;
  role: string;
  email: string;
}

export interface AuthenticatedRequest extends Request {
  user: JwtUser;
}

export interface MaybeAuthenticatedRequest extends Request {
  user?: JwtUser;
}
