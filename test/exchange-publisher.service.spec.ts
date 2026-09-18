import { BadRequestException } from '@nestjs/common';
import { ExchangePublisherService, PublishOfferInput } from '../src/exchange-publisher/exchange-publisher.service';

// ── fetch mock ───────────────────────────────────────────────────────────────
const fetchMock = jest.fn() as jest.MockedFunction<typeof globalThis.fetch>;
globalThis.fetch = fetchMock;

// ── Mocks ────────────────────────────────────────────────────────────────────
function makePrismaMock() {
  return {
    publishedOffer: {
      findMany: jest.fn(),
      create: jest.fn(),
    },
  } as any;
}

function makeTransEuAuthMock() {
  return {
    getValidAccessToken: jest.fn().mockResolvedValue('test-access-token'),
  } as any;
}

function makeService(prisma = makePrismaMock(), transEuAuth = makeTransEuAuthMock()) {
  return { service: new ExchangePublisherService(prisma, transEuAuth), prisma, transEuAuth };
}

// ── Fixtures ─────────────────────────────────────────────────────────────────
function baseInput(overrides: Partial<PublishOfferInput> = {}): PublishOfferInput {
  return {
    companyId: 'company-1',
    originCountry: 'PL',
    originCity: 'Warszawa',
    destCountry: 'DE',
    destCity: 'Berlin',
    loadingDateFrom: '2025-06-01T08:00:00Z',
    loadingDateTo: '2025-06-01T16:00:00Z',
    weightKg: 20000,
    publishToTransEu: true,
    ...overrides,
  };
}

function okApiResponse(id = 'offer-123') {
  return {
    ok: true,
    status: 200,
    json: async () => ({ id }),
    text: async () => '',
  } as unknown as Response;
}

function errorApiResponse(status = 500, body = 'Internal Server Error') {
  return {
    ok: false,
    status,
    json: async () => ({}),
    text: async () => body,
  } as unknown as Response;
}

// ═════════════════════════════════════════════════════════════════════════════
describe('ExchangePublisherService', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    jest.resetAllMocks();
    process.env = {
      ...OLD_ENV,
      TRANS_EU_API_KEY: 'test-api-key',
      TIMOCOM_GROUP_ID: 'tg-1',
      TIMOCOM_PASSWORD: 'tp-1',
      TIMOCOM_ID: 'ti-1',
    };
  });

  afterAll(() => {
    process.env = OLD_ENV;
  });

  // ── publishOffer: Trans.eu ───────────────────────────────────────────────
  describe('publishOffer — Trans.eu', () => {
    it('publishes to Trans.eu and saves PublishedOffer', async () => {
      const { service, prisma } = makeService();
      fetchMock.mockResolvedValueOnce(okApiResponse('transeu-offer-1'));

      const results = await service.publishOffer(baseInput());

      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({
        exchange: 'TRANS_EU',
        success: true,
        offerId: 'transeu-offer-1',
      });

      // Verify PublishedOffer was saved
      expect(prisma.publishedOffer.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          companyId: 'company-1',
          exchange: 'TRANS_EU',
          externalOfferId: 'transeu-offer-1',
          originCity: 'Warszawa',
          originCountry: 'PL',
          destCity: 'Berlin',
          destCountry: 'DE',
          weightKg: 20000,
        }),
      });
    });

    it('sends correct Authorization and Api-key headers', async () => {
      const { service } = makeService();
      fetchMock.mockResolvedValueOnce(okApiResponse());

      await service.publishOffer(baseInput());

      const [url, options] = fetchMock.mock.calls[0];
      expect(url).toContain('freights-api/v2/freights');
      expect((options as any).headers['Authorization']).toBe('Bearer test-access-token');
      expect((options as any).headers['Api-key']).toBe('test-api-key');
    });

    it('returns error result when Trans.eu API responds with HTTP error', async () => {
      const { service, prisma } = makeService();
      fetchMock.mockResolvedValueOnce(errorApiResponse(422, 'Validation failed'));

      const results = await service.publishOffer(baseInput());

      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({
        exchange: 'TRANS_EU',
        success: false,
        error: 'HTTP 422: Validation failed',
      });

      // Should NOT save a failed offer
      expect(prisma.publishedOffer.create).not.toHaveBeenCalled();
    });

    it('returns error result when fetch throws (network error)', async () => {
      const { service, prisma } = makeService();
      fetchMock.mockRejectedValueOnce(new Error('Network timeout'));

      const results = await service.publishOffer(baseInput());

      expect(results[0]).toEqual({
        exchange: 'TRANS_EU',
        success: false,
        error: 'Network timeout',
      });
      expect(prisma.publishedOffer.create).not.toHaveBeenCalled();
    });

    it('catches BadRequestException from missing TRANS_EU_API_KEY', async () => {
      delete process.env.TRANS_EU_API_KEY;
      const { service, prisma } = makeService();

      const results = await service.publishOffer(baseInput());

      expect(results[0].success).toBe(false);
      expect(results[0].error).toContain('TRANS_EU_API_KEY');
      expect(prisma.publishedOffer.create).not.toHaveBeenCalled();
    });

    it('catches auth error when company is not connected', async () => {
      const transEuAuth = makeTransEuAuthMock();
      transEuAuth.getValidAccessToken.mockRejectedValue(
        new Error('Company is not connected to Trans.eu'),
      );
      const { service } = makeService(undefined, transEuAuth);

      const results = await service.publishOffer(baseInput());

      expect(results[0].success).toBe(false);
      expect(results[0].error).toContain('not connected');
    });
  });

  // ── publishOffer: Timocom ────────────────────────────────────────────────
  describe('publishOffer — Timocom', () => {
    it('publishes to Timocom and saves PublishedOffer', async () => {
      const { service, prisma } = makeService();
      fetchMock.mockResolvedValueOnce(okApiResponse('timocom-offer-1'));

      const results = await service.publishOffer(
        baseInput({ publishToTransEu: false, publishToTimocom: true }),
      );

      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({
        exchange: 'TIMOCOM',
        success: true,
        offerId: 'timocom-offer-1',
      });
      expect(prisma.publishedOffer.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          exchange: 'TIMOCOM',
          externalOfferId: 'timocom-offer-1',
        }),
      });
    });

    it('sends Basic auth header for Timocom', async () => {
      const { service } = makeService();
      fetchMock.mockResolvedValueOnce(okApiResponse());

      await service.publishOffer(
        baseInput({ publishToTransEu: false, publishToTimocom: true }),
      );

      const [url, options] = fetchMock.mock.calls[0];
      expect(url).toContain('timocom.com');
      const expectedAuth = `Basic ${Buffer.from('tg-1:tp-1').toString('base64')}`;
      expect((options as any).headers['Authorization']).toBe(expectedAuth);
      expect((options as any).headers['X-Timocom-Id']).toBe('ti-1');
    });

    it('returns error when Timocom env vars are missing', async () => {
      delete process.env.TIMOCOM_GROUP_ID;
      const { service } = makeService();

      const results = await service.publishOffer(
        baseInput({ publishToTransEu: false, publishToTimocom: true }),
      );

      expect(results[0]).toEqual({
        exchange: 'TIMOCOM',
        success: false,
        error: 'Timocom is not configured',
      });
    });

    it('returns error when Timocom API fails', async () => {
      const { service } = makeService();
      fetchMock.mockResolvedValueOnce(errorApiResponse(403, 'Forbidden'));

      const results = await service.publishOffer(
        baseInput({ publishToTransEu: false, publishToTimocom: true }),
      );

      expect(results[0].success).toBe(false);
      expect(results[0].error).toContain('HTTP 403');
    });
  });

  // ── publishOffer: multi-exchange ──────────────────────────────────────────
  describe('publishOffer — multi-exchange', () => {
    it('publishes to both Trans.eu and Timocom', async () => {
      const { service, prisma } = makeService();
      fetchMock
        .mockResolvedValueOnce(okApiResponse('te-1'))   // Trans.eu
        .mockResolvedValueOnce(okApiResponse('tc-1'));   // Timocom

      const results = await service.publishOffer(
        baseInput({ publishToTransEu: true, publishToTimocom: true }),
      );

      expect(results).toHaveLength(2);
      expect(results[0]).toEqual({ exchange: 'TRANS_EU', success: true, offerId: 'te-1' });
      expect(results[1]).toEqual({ exchange: 'TIMOCOM', success: true, offerId: 'tc-1' });
      expect(prisma.publishedOffer.create).toHaveBeenCalledTimes(2);
    });

    it('does nothing when neither exchange is selected', async () => {
      const { service, prisma } = makeService();

      const results = await service.publishOffer(
        baseInput({ publishToTransEu: false, publishToTimocom: false }),
      );

      expect(results).toHaveLength(0);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(prisma.publishedOffer.create).not.toHaveBeenCalled();
    });

    it('saves only successful results when one exchange fails', async () => {
      const { service, prisma } = makeService();
      fetchMock
        .mockResolvedValueOnce(okApiResponse('te-ok'))
        .mockResolvedValueOnce(errorApiResponse(500, 'down'));

      const results = await service.publishOffer(
        baseInput({ publishToTransEu: true, publishToTimocom: true }),
      );

      expect(results[0].success).toBe(true);
      expect(results[1].success).toBe(false);
      expect(prisma.publishedOffer.create).toHaveBeenCalledTimes(1);
      expect(prisma.publishedOffer.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ exchange: 'TRANS_EU', externalOfferId: 'te-ok' }),
      });
    });
  });

  // ── getPublishedOffers ───────────────────────────────────────────────────
  describe('getPublishedOffers', () => {
    it('queries by companyId, ordered desc, limited to 100', async () => {
      const { service, prisma } = makeService();
      const mockOffers = [{ id: '1' }, { id: '2' }];
      prisma.publishedOffer.findMany.mockResolvedValue(mockOffers);

      const result = await service.getPublishedOffers('company-1');

      expect(result).toEqual(mockOffers);
      expect(prisma.publishedOffer.findMany).toHaveBeenCalledWith({
        where: { companyId: 'company-1' },
        orderBy: { publishedAt: 'desc' },
        take: 100,
      });
    });
  });

  // ── payload building (Trans.eu) ──────────────────────────────────────────
  describe('Trans.eu payload', () => {
    it('includes price when provided', async () => {
      const { service } = makeService();
      fetchMock.mockResolvedValueOnce(okApiResponse());

      await service.publishOffer(baseInput({ price: 1500, currency: 'PLN', isNegotiable: true }));

      const body = JSON.parse((fetchMock.mock.calls[0][1] as any).body);
      expect(body.price).toEqual({ value: 1500, currency: 'PLN', type: 'negotiable' });
    });

    it('sets capacity in tonnes (weightKg / 1000)', async () => {
      const { service } = makeService();
      fetchMock.mockResolvedValueOnce(okApiResponse());

      await service.publishOffer(baseInput({ weightKg: 24000 }));

      const body = JSON.parse((fetchMock.mock.calls[0][1] as any).body);
      expect(body.capacity).toBe(24);
    });

    it('includes pallet loads when palletCount is set', async () => {
      const { service } = makeService();
      fetchMock.mockResolvedValueOnce(okApiResponse());

      await service.publishOffer(baseInput({ palletCount: 33 }));

      const body = JSON.parse((fetchMock.mock.calls[0][1] as any).body);
      expect(body.loads).toEqual([
        expect.objectContaining({ amount: 33, type_of_load: 'europalette' }),
      ]);
    });

    it('maps truck body to Trans.eu format', async () => {
      const { service } = makeService();
      fetchMock.mockResolvedValueOnce(okApiResponse());

      await service.publishOffer(baseInput({ truckBody: 'FLATBED' }));

      const body = JSON.parse((fetchMock.mock.calls[0][1] as any).body);
      expect(body.requirements.required_truck_bodies).toEqual(['flatbed']);
    });

    it('sets reefer requirements for refrigerated shipments', async () => {
      const { service } = makeService();
      fetchMock.mockResolvedValueOnce(okApiResponse());

      await service.publishOffer(baseInput({ isRefrigerated: true, tempFrom: -18, tempTo: -20 }));

      const body = JSON.parse((fetchMock.mock.calls[0][1] as any).body);
      expect(body.requirements.required_truck_bodies).toEqual(['reefer']);
      expect(body.requirements.temperature).toEqual({ from: -18, to: -20 });
    });
  });
});
