import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { TransEuAuthService } from '../src/trans-eu-auth/trans-eu-auth.service';

// ── fetch mock ───────────────────────────────────────────────────────────────
const fetchMock = jest.fn() as jest.MockedFunction<typeof globalThis.fetch>;
globalThis.fetch = fetchMock;

// ── PrismaService mock ──────────────────────────────────────────────────────
function makePrismaMock() {
  return {
    exchangeConnection: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
      update: jest.fn(),
      deleteMany: jest.fn(),
    },
  } as any;
}

function makeService(prisma = makePrismaMock()) {
  return { service: new TransEuAuthService(prisma), prisma };
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function okTokenResponse(overrides: Record<string, any> = {}) {
  return {
    ok: true,
    json: async () => ({
      access_token: 'at_new',
      refresh_token: 'rt_new',
      expires_in: 3600,
      scope: 'offers.loads.manage',
      ...overrides,
    }),
    text: async () => '',
  } as unknown as Response;
}

function errorResponse(status = 401, body = 'Unauthorized') {
  return {
    ok: false,
    status,
    json: async () => ({}),
    text: async () => body,
  } as unknown as Response;
}

// ═════════════════════════════════════════════════════════════════════════════
describe('TransEuAuthService', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    jest.resetAllMocks();
    process.env = {
      ...OLD_ENV,
      TRANS_EU_CLIENT_ID: 'test-client-id',
      TRANS_EU_CLIENT_SECRET: 'test-client-secret',
    };
  });

  afterAll(() => {
    process.env = OLD_ENV;
  });

  // ── getAuthorizationUrl ──────────────────────────────────────────────────
  describe('getAuthorizationUrl', () => {
    it('returns URL containing encoded state with companyId', () => {
      const { service } = makeService();
      const url = service.getAuthorizationUrl('company-1', 'https://app/callback');

      expect(url).toContain('https://auth.system.trans.eu/oauth2/authorize');
      expect(url).toContain('client_id=test-client-id');
      expect(url).toContain('response_type=code');
      expect(url).toContain('redirect_uri=');

      // Extract and decode state
      const parsed = new URL(url);
      const state = parsed.searchParams.get('state')!;
      const decoded = JSON.parse(Buffer.from(state, 'base64url').toString());
      expect(decoded.companyId).toBe('company-1');
      expect(decoded.ts).toEqual(expect.any(Number));
    });

    it('includes correct scopes', () => {
      const { service } = makeService();
      const url = service.getAuthorizationUrl('c1', 'https://app/cb');
      expect(url).toContain('scope=offers.loads.manage+offers.vehicles.manage');
    });

    it('throws BadRequestException when TRANS_EU_CLIENT_ID is missing', () => {
      delete process.env.TRANS_EU_CLIENT_ID;
      const { service } = makeService();

      expect(() => service.getAuthorizationUrl('c1', 'https://app/cb'))
        .toThrow(BadRequestException);
    });
  });

  // ── handleCallback ───────────────────────────────────────────────────────
  describe('handleCallback', () => {
    function validState(companyId = 'company-1') {
      return Buffer.from(JSON.stringify({ companyId, ts: Date.now() })).toString('base64url');
    }

    it('exchanges code for tokens and saves them', async () => {
      const { service, prisma } = makeService();
      fetchMock.mockResolvedValueOnce(okTokenResponse());

      const result = await service.handleCallback('auth-code', validState(), 'https://app/cb');

      expect(result.companyId).toBe('company-1');
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(prisma.exchangeConnection.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { companyId_exchange: { companyId: 'company-1', exchange: 'TRANS_EU' } },
          create: expect.objectContaining({ accessToken: 'at_new', refreshToken: 'rt_new' }),
          update: expect.objectContaining({ accessToken: 'at_new', refreshToken: 'rt_new' }),
        }),
      );
    });

    it('throws BadRequestException on invalid (corrupt) state', async () => {
      const { service } = makeService();

      await expect(service.handleCallback('code', '!!!invalid!!!', 'https://app/cb'))
        .rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when env vars are missing', async () => {
      delete process.env.TRANS_EU_CLIENT_ID;
      const { service } = makeService();

      await expect(service.handleCallback('code', validState(), 'https://app/cb'))
        .rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when only client secret is missing', async () => {
      delete process.env.TRANS_EU_CLIENT_SECRET;
      const { service } = makeService();

      await expect(service.handleCallback('code', validState(), 'https://app/cb'))
        .rejects.toThrow(BadRequestException);
    });

    it('throws UnauthorizedException when token exchange fails', async () => {
      const { service } = makeService();
      fetchMock.mockResolvedValueOnce(errorResponse(400, 'invalid_grant'));

      await expect(service.handleCallback('bad-code', validState(), 'https://app/cb'))
        .rejects.toThrow(UnauthorizedException);
    });
  });

  // ── getValidAccessToken ──────────────────────────────────────────────────
  describe('getValidAccessToken', () => {
    it('returns existing token when still valid', async () => {
      const { service, prisma } = makeService();
      prisma.exchangeConnection.findUnique.mockResolvedValue({
        accessToken: 'valid-token',
        refreshToken: 'rt',
        accessTokenExpiresAt: new Date(Date.now() + 3_600_000), // 1h from now
        status: 'ACTIVE',
      });

      const token = await service.getValidAccessToken('company-1');
      expect(token).toBe('valid-token');
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('throws UnauthorizedException when company is not connected', async () => {
      const { service, prisma } = makeService();
      prisma.exchangeConnection.findUnique.mockResolvedValue(null);

      await expect(service.getValidAccessToken('company-1'))
        .rejects.toThrow(UnauthorizedException);
    });

    it('refreshes token when expired and returns new access token', async () => {
      const { service, prisma } = makeService();
      prisma.exchangeConnection.findUnique.mockResolvedValue({
        accessToken: 'expired-token',
        refreshToken: 'rt-old',
        accessTokenExpiresAt: new Date(Date.now() - 1000), // already expired
        status: 'ACTIVE',
      });
      fetchMock.mockResolvedValueOnce(okTokenResponse({ access_token: 'at_refreshed' }));

      const token = await service.getValidAccessToken('company-1');
      expect(token).toBe('at_refreshed');
      expect(prisma.exchangeConnection.upsert).toHaveBeenCalled();
    });

    it('refreshes token when it expires within 60 seconds', async () => {
      const { service, prisma } = makeService();
      prisma.exchangeConnection.findUnique.mockResolvedValue({
        accessToken: 'almost-expired',
        refreshToken: 'rt',
        accessTokenExpiresAt: new Date(Date.now() + 30_000), // 30s — within the 60s buffer
        status: 'ACTIVE',
      });
      fetchMock.mockResolvedValueOnce(okTokenResponse({ access_token: 'at_fresh' }));

      const token = await service.getValidAccessToken('company-1');
      expect(token).toBe('at_fresh');
    });

    it('marks connection EXPIRED and throws when refresh fails', async () => {
      const { service, prisma } = makeService();
      prisma.exchangeConnection.findUnique.mockResolvedValue({
        accessToken: 'expired-token',
        refreshToken: 'rt-dead',
        accessTokenExpiresAt: new Date(Date.now() - 1000),
        status: 'ACTIVE',
      });
      fetchMock.mockResolvedValueOnce(errorResponse(401, 'invalid_grant'));

      await expect(service.getValidAccessToken('company-1'))
        .rejects.toThrow(UnauthorizedException);

      expect(prisma.exchangeConnection.update).toHaveBeenCalledWith({
        where: { companyId_exchange: { companyId: 'company-1', exchange: 'TRANS_EU' } },
        data: { status: 'EXPIRED' },
      });
    });
  });

  // ── getConnectionStatus ──────────────────────────────────────────────────
  describe('getConnectionStatus', () => {
    it('returns connected: false when no connection exists', async () => {
      const { service, prisma } = makeService();
      prisma.exchangeConnection.findUnique.mockResolvedValue(null);

      const status = await service.getConnectionStatus('company-1');
      expect(status).toEqual({ connected: false, exchange: 'TRANS_EU' });
    });

    it('returns full status when connection exists', async () => {
      const { service, prisma } = makeService();
      const expiresAt = new Date('2025-12-31');
      prisma.exchangeConnection.findUnique.mockResolvedValue({
        status: 'ACTIVE',
        accessTokenExpiresAt: expiresAt,
        scope: 'offers.loads.manage',
      });

      const status = await service.getConnectionStatus('company-1');
      expect(status).toEqual({
        connected: true,
        exchange: 'TRANS_EU',
        status: 'ACTIVE',
        expiresAt,
        scope: 'offers.loads.manage',
      });
    });

    it('returns connected: false when status is EXPIRED', async () => {
      const { service, prisma } = makeService();
      prisma.exchangeConnection.findUnique.mockResolvedValue({
        status: 'EXPIRED',
        accessTokenExpiresAt: new Date(),
        scope: '',
      });

      const status = await service.getConnectionStatus('company-1');
      expect(status.connected).toBe(false);
    });
  });

  // ── disconnect ─────────────────────────────────────────────────────────
  describe('disconnect', () => {
    it('deletes exchange connection for company', async () => {
      const { service, prisma } = makeService();
      prisma.exchangeConnection.deleteMany.mockResolvedValue({ count: 1 });

      await service.disconnect('company-1');

      expect(prisma.exchangeConnection.deleteMany).toHaveBeenCalledWith({
        where: { companyId: 'company-1', exchange: 'TRANS_EU' },
      });
    });
  });
});
