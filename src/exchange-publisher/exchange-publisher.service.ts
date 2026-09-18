import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TransEuAuthService } from '../trans-eu-auth/trans-eu-auth.service';

const TRANS_EU_API = 'https://api.platform.trans.eu';
const TIMOCOM_API  = 'https://api.timocom.com';

export interface PublishOfferInput {
  companyId: string;
  originCountry: string;
  originCity: string;
  originPostalCode?: string;
  destCountry: string;
  destCity: string;
  destPostalCode?: string;
  loadingDateFrom: string;
  loadingDateTo: string;
  deliveryDateFrom?: string;
  deliveryDateTo?: string;
  weightKg: number;
  volumeM3?: number;
  palletCount?: number;
  loadingMeters?: number;
  description?: string;
  isAdr?: boolean;
  adrClass?: string;
  isRefrigerated?: boolean;
  tempFrom?: number;
  tempTo?: number;
  vehicleType?: string;
  truckBody?: string;
  price?: number;
  currency?: string;
  isNegotiable?: boolean;
  publishToTransEu?: boolean;
  publishToTimocom?: boolean;
  publishToPublicExchange?: boolean;
}

export interface PublishResult {
  exchange: string;
  success: boolean;
  offerId?: string;
  error?: string;
}

@Injectable()
export class ExchangePublisherService {
  private readonly logger = new Logger(ExchangePublisherService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly transEuAuth: TransEuAuthService,
  ) {}

  async publishOffer(input: PublishOfferInput): Promise<PublishResult[]> {
    const results: PublishResult[] = [];
    if (input.publishToTransEu) results.push(await this.publishToTransEu(input));
    if (input.publishToTimocom) results.push(await this.publishToTimocom(input));
    await this.savePublishResults(input, results);
    return results;
  }

  async getPublishedOffers(companyId: string) {
    return this.prisma.publishedOffer.findMany({
      where: { companyId },
      orderBy: { publishedAt: 'desc' },
      take: 100,
    });
  }

  private async publishToTransEu(input: PublishOfferInput): Promise<PublishResult> {
    try {
      const accessToken = await this.transEuAuth.getValidAccessToken(input.companyId);
      const apiKey = process.env.TRANS_EU_API_KEY;
      if (!apiKey) throw new BadRequestException('TRANS_EU_API_KEY is not configured');
      const response = await fetch(`${TRANS_EU_API}/ext/freights-api/v2/freights`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'Authorization': `Bearer ${accessToken}`, 'Api-key': apiKey },
        body: JSON.stringify(this.buildTransEuPayload(input)),
      });
      if (!response.ok) {
        const err = await response.text();
        return { exchange: 'TRANS_EU', success: false, error: `HTTP ${response.status}: ${err}` };
      }
      const data = await response.json();
      return { exchange: 'TRANS_EU', success: true, offerId: data.id };
    } catch (err: any) {
      return { exchange: 'TRANS_EU', success: false, error: err.message };
    }
  }

  private async publishToTimocom(input: PublishOfferInput): Promise<PublishResult> {
    try {
      const groupId = process.env.TIMOCOM_GROUP_ID;
      const password = process.env.TIMOCOM_PASSWORD;
      const timocomId = process.env.TIMOCOM_ID;
      if (!groupId || !password || !timocomId) {
        return { exchange: 'TIMOCOM', success: false, error: 'Timocom is not configured' };
      }
      const credentials = Buffer.from(`${groupId}:${password}`).toString('base64');
      const response = await fetch(`${TIMOCOM_API}/v1/freights`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'Authorization': `Basic ${credentials}`, 'X-Timocom-Id': timocomId },
        body: JSON.stringify(this.buildTimocomPayload(input)),
      });
      if (!response.ok) {
        const err = await response.text();
        return { exchange: 'TIMOCOM', success: false, error: `HTTP ${response.status}: ${err}` };
      }
      const data = await response.json();
      return { exchange: 'TIMOCOM', success: true, offerId: String(data.id) };
    } catch (err: any) {
      return { exchange: 'TIMOCOM', success: false, error: err.message };
    }
  }

  private buildTransEuPayload(input: PublishOfferInput): object {
    const loads: object[] = [];
    if (input.palletCount) loads.push({ load_id: 'pallet-1', name: 'Pallets', amount: input.palletCount, type_of_load: 'europalette' });
    const requirements: Record<string, any> = { is_ftl: true, vehicle_size: input.vehicleType?.toUpperCase() === 'VAN' ? 'van' : 'lorry' };
    if (input.truckBody) requirements.required_truck_bodies = [this.mapTruckBody(input.truckBody)];
    if (input.isAdr) requirements.adr = true;
    if (input.isRefrigerated) { requirements.required_truck_bodies = ['reefer']; if (input.tempFrom !== undefined && input.tempTo !== undefined) requirements.temperature = { from: input.tempFrom, to: input.tempTo }; }
    const payload: Record<string, any> = {
      capacity: input.weightKg / 1000, requirements, loads,
      spots: [
        { spot_order: 1, place: { address: { country: input.originCountry.toLowerCase(), locality: input.originCity, ...(input.originPostalCode ? { postal_code: input.originPostalCode } : {}) } }, operations: [{ type: 'loading', operation_order: 1, timespans: { begin: input.loadingDateFrom, end: input.loadingDateTo } }] },
        { spot_order: 2, place: { address: { country: input.destCountry.toLowerCase(), locality: input.destCity, ...(input.destPostalCode ? { postal_code: input.destPostalCode } : {}) } }, operations: [{ type: 'unloading', operation_order: 1, timespans: { begin: input.deliveryDateFrom ?? input.loadingDateTo, end: input.deliveryDateTo ?? input.loadingDateTo } }] },
      ],
      receivers: { public_exchange: input.publishToPublicExchange ?? true },
    };
    if (input.price) payload.price = { value: input.price, currency: input.currency ?? 'EUR', type: input.isNegotiable ? 'negotiable' : 'fixed' };
    if (input.description) payload.description = input.description;
    return payload;
  }

  private buildTimocomPayload(input: PublishOfferInput): object {
    return {
      departure: { country: input.originCountry.toUpperCase(), city: input.originCity, ...(input.originPostalCode ? { zipCode: input.originPostalCode } : {}), date: { from: input.loadingDateFrom, to: input.loadingDateTo } },
      destination: { country: input.destCountry.toUpperCase(), city: input.destCity, ...(input.destPostalCode ? { zipCode: input.destPostalCode } : {}), ...(input.deliveryDateFrom ? { date: { from: input.deliveryDateFrom, to: input.deliveryDateTo ?? input.deliveryDateFrom } } : {}) },
      freight: { weight: { value: input.weightKg / 1000, unit: 'T' }, ...(input.volumeM3 ? { volume: { value: input.volumeM3, unit: 'CBM' } } : {}), ...(input.loadingMeters ? { loadingMeters: input.loadingMeters } : {}), ...(input.description ? { description: input.description } : {}), ...(input.isAdr ? { dangerousGoods: true, adrClass: input.adrClass } : {}) },
      vehicle: { type: this.mapTimocomVehicleType(input.vehicleType, input.truckBody), ...(input.isRefrigerated ? { temperature: { from: input.tempFrom, to: input.tempTo } } : {}) },
      ...(input.price ? { price: { amount: input.price, currency: input.currency ?? 'EUR' } } : {}),
    };
  }

  private mapTruckBody(truckBody?: string): string {
    const map: Record<string, string> = { 'CURTAIN': 'curtainsider', 'CURTAINSIDER': 'curtainsider', 'BOX': 'box-truck', 'REEFER': 'reefer', 'FLATBED': 'flatbed', 'TANKER': 'tanker', 'MEGA': 'mega-trailer' };
    return map[truckBody?.toUpperCase() ?? ''] ?? 'curtainsider';
  }

  private mapTimocomVehicleType(vehicleType?: string, truckBody?: string): string {
    const tb = truckBody?.toUpperCase() ?? '';
    if (tb === 'REEFER' || tb === 'REFRIGERATED') return 'REFRIGERATED_TRUCK';
    if (tb === 'FLATBED') return 'FLATBED_TRUCK';
    if (tb === 'TANKER') return 'TANKER';
    if (vehicleType?.toUpperCase() === 'VAN') return 'VAN';
    return 'TARPAULIN_TRUCK';
  }

  private async savePublishResults(input: PublishOfferInput, results: PublishResult[]): Promise<void> {
    for (const result of results) {
      if (result.success && result.offerId) {
        await this.prisma.publishedOffer.create({
          data: { companyId: input.companyId, exchange: result.exchange, externalOfferId: result.offerId, originCity: input.originCity, originCountry: input.originCountry, destCity: input.destCity, destCountry: input.destCountry, weightKg: input.weightKg, publishedAt: new Date() },
        });
      }
    }
  }
}
