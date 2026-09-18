import { Controller, Post, Get, Body, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { IsString, IsNumber, IsOptional, IsBoolean } from 'class-validator';
import { ExchangePublisherService, PublishOfferInput } from './exchange-publisher.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CompanyGuard } from '../common/guards/company.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { JwtUser } from '../common/types/authenticated-request';

export class PublishOfferDto implements Omit<PublishOfferInput, 'companyId'> {
  @IsString() originCountry: string;
  @IsString() originCity: string;
  @IsOptional() @IsString() originPostalCode?: string;
  @IsOptional() @IsString() originStreet?: string;
  @IsString() destCountry: string;
  @IsString() destCity: string;
  @IsOptional() @IsString() destPostalCode?: string;
  @IsOptional() @IsString() destStreet?: string;
  @IsString() loadingDateFrom: string;
  @IsString() loadingDateTo: string;
  @IsOptional() @IsString() deliveryDateFrom?: string;
  @IsOptional() @IsString() deliveryDateTo?: string;
  @IsNumber() weightKg: number;
  @IsOptional() @IsNumber() volumeM3?: number;
  @IsOptional() @IsNumber() palletCount?: number;
  @IsOptional() @IsNumber() loadingMeters?: number;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsBoolean() isAdr?: boolean;
  @IsOptional() @IsString() adrClass?: string;
  @IsOptional() @IsBoolean() isRefrigerated?: boolean;
  @IsOptional() @IsNumber() tempFrom?: number;
  @IsOptional() @IsNumber() tempTo?: number;
  @IsOptional() @IsString() vehicleType?: string;
  @IsOptional() @IsString() truckBody?: string;
  @IsOptional() @IsNumber() price?: number;
  @IsOptional() @IsString() currency?: string;
  @IsOptional() @IsBoolean() isNegotiable?: boolean;
  @IsOptional() @IsBoolean() publishToTransEu?: boolean;
  @IsOptional() @IsBoolean() publishToTimocom?: boolean;
  @IsOptional() @IsBoolean() publishToPublicExchange?: boolean;
}

@ApiTags('exchange-publisher')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, CompanyGuard)
@Controller('exchange-publisher')
export class ExchangePublisherController {
  constructor(private readonly service: ExchangePublisherService) {}

  @Post('publish')
  @ApiOperation({ summary: 'Publish offer to freight exchanges (Trans.eu, Timocom)' })
  publish(@CurrentUser() user: JwtUser, @Body() dto: PublishOfferDto) {
    return this.service.publishOffer({ ...dto, companyId: user.companyId });
  }

  @Get('published')
  @ApiOperation({ summary: 'Published offers history' })
  async getPublished(@CurrentUser() user: JwtUser) {
    return this.service.getPublishedOffers(user.companyId);
  }
}
