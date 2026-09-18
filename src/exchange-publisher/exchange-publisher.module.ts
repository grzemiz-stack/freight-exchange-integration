import { Module } from '@nestjs/common';
import { ExchangePublisherService } from './exchange-publisher.service';
import { ExchangePublisherController } from './exchange-publisher.controller';
import { TransEuAuthModule } from '../trans-eu-auth/trans-eu-auth.module';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule, TransEuAuthModule],
  controllers: [ExchangePublisherController],
  providers: [ExchangePublisherService],
  exports: [ExchangePublisherService],
})
export class ExchangePublisherModule {}
