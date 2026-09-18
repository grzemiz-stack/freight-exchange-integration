import { Injectable, Logger, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const TRANS_EU_AUTH_URL = 'https://auth.system.trans.eu/oauth2';
const TRANS_EU_API_URL  = 'https://api.platform.trans.eu';

export interface TransEuTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  scope: string;
}

@Injectable()
export class TransEuAuthService {
  private readonly logger = new Logger(TransEuAuthService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ── Step 1: Generate Trans.eu login URL ────────────────────────────────────
  getAuthorizationUrl(companyId: string, redirectUri: string): string {
    const clientId = process.env.TRANS_EU_CLIENT_ID;
    if (!clientId) throw new BadRequestException('TRANS_EU_CLIENT_ID is not configured');

    const state = Buffer.from(JSON.stringify({ companyId, ts: Date.now() })).toString('base64url');
    const params = new URLSearchParams({
      client_id:     clientId,
      response_type: 'code',
      redirect_uri:  redirectUri,
      scope:         'offers.loads.manage offers.vehicles.manage',
      state,
    });

    const url = `${TRANS_EU_AUTH_URL}/authorize?${params.toString()}`;
    this.logger.log(`Auth URL generated for company ${companyId}`);
    return url;
  }

  // ── Step 2: Exchange code for tokens (post-login callback) ─────────────────
  async handleCallback(code: string, state: string, redirectUri: string): Promise<{ companyId: string }> {
    const clientId     = process.env.TRANS_EU_CLIENT_ID;
    const clientSecret = process.env.TRANS_EU_CLIENT_SECRET;
    if (!clientId || !clientSecret) throw new BadRequestException('Trans.eu is not configured');

    // Decode state -> companyId
    let companyId: string;
    try {
      const decoded = JSON.parse(Buffer.from(state, 'base64url').toString());
      companyId = decoded.companyId;
    } catch {
      throw new BadRequestException('Invalid state parameter');
    }

    // Exchange code for access_token
    const body = new URLSearchParams({
      grant_type:   'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id:    clientId,
      client_secret: clientSecret,
    });

    const response = await fetch(`${TRANS_EU_AUTH_URL}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!response.ok) {
      const err = await response.text();
      this.logger.error(`Token exchange failed: ${err}`);
      throw new UnauthorizedException('Trans.eu login failed — check account credentials');
    }

    const data = await response.json();
    await this.saveTokens(companyId, data);
    this.logger.log(`Trans.eu connected for company ${companyId}`);
    return { companyId };
  }

  // ── Step 3: Get valid access token (auto-refresh if expired) ───────────────
  async getValidAccessToken(companyId: string): Promise<string> {
    const conn = await this.prisma.exchangeConnection.findUnique({
      where: { companyId_exchange: { companyId, exchange: 'TRANS_EU' } },
    });

    if (!conn) throw new UnauthorizedException('Company is not connected to Trans.eu');

    // If the token is still valid, return it
    if (conn.accessTokenExpiresAt > new Date(Date.now() + 60_000)) {
      return conn.accessToken;
    }

    // Token expired — refresh it
    this.logger.log(`Refreshing Trans.eu token for company ${companyId}`);
    return this.refreshToken(companyId, conn.refreshToken);
  }

  // ── Refresh token ──────────────────────────────────────────────────────────
  private async refreshToken(companyId: string, refreshToken: string): Promise<string> {
    const clientId     = process.env.TRANS_EU_CLIENT_ID;
    const clientSecret = process.env.TRANS_EU_CLIENT_SECRET;

    const body = new URLSearchParams({
      grant_type:    'refresh_token',
      refresh_token: refreshToken,
      client_id:     clientId!,
      client_secret: clientSecret!,
    });

    const response = await fetch(`${TRANS_EU_AUTH_URL}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!response.ok) {
      await this.prisma.exchangeConnection.update({
        where: { companyId_exchange: { companyId, exchange: 'TRANS_EU' } },
        data: { status: 'EXPIRED' },
      });
      throw new UnauthorizedException('Trans.eu session expired — reconnection required');
    }

    const data = await response.json();
    await this.saveTokens(companyId, data);
    return data.access_token;
  }

  // ── Save tokens to database ────────────────────────────────────────────────
  private async saveTokens(companyId: string, data: any): Promise<void> {
    const expiresAt = new Date(Date.now() + (data.expires_in ?? 3600) * 1000);
    await this.prisma.exchangeConnection.upsert({
      where: { companyId_exchange: { companyId, exchange: 'TRANS_EU' } },
      create: {
        companyId,
        exchange: 'TRANS_EU',
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        accessTokenExpiresAt: expiresAt,
        scope: data.scope ?? '',
        status: 'ACTIVE',
      },
      update: {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        accessTokenExpiresAt: expiresAt,
        scope: data.scope ?? '',
        status: 'ACTIVE',
      },
    });
  }

  // ── Connection status ──────────────────────────────────────────────────────
  async getConnectionStatus(companyId: string) {
    const conn = await this.prisma.exchangeConnection.findUnique({
      where: { companyId_exchange: { companyId, exchange: 'TRANS_EU' } },
    });
    if (!conn) return { connected: false, exchange: 'TRANS_EU' };
    return {
      connected: conn.status === 'ACTIVE',
      exchange: 'TRANS_EU',
      status: conn.status,
      expiresAt: conn.accessTokenExpiresAt,
      scope: conn.scope,
    };
  }

  // ── Disconnect ─────────────────────────────────────────────────────────────
  async disconnect(companyId: string): Promise<void> {
    await this.prisma.exchangeConnection.deleteMany({
      where: { companyId, exchange: 'TRANS_EU' },
    });
    this.logger.log(`Trans.eu disconnected for company ${companyId}`);
  }
}
