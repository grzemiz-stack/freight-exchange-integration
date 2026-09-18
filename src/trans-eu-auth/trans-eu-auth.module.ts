import { Module } from '@nestjs/common';
import { TransEuAuthService } from './trans-eu-auth.service';
import { TransEuAuthController } from './trans-eu-auth.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [TransEuAuthController],
  providers: [TransEuAuthService],
  exports: [TransEuAuthService],
})
export class TransEuAuthModule {}
