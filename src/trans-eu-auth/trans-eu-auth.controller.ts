import { Controller, Get, Query, Res, UseGuards, Delete, Req } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Response, Request } from 'express';
import { TransEuAuthService } from './trans-eu-auth.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CompanyGuard } from '../common/guards/company.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { JwtUser } from '../common/types/authenticated-request';

@ApiTags('trans-eu-auth')
@Controller('integrations/transeu')
export class TransEuAuthController {
  constructor(private readonly service: TransEuAuthService) {}

  @Get('connect')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, CompanyGuard)
  @ApiOperation({ summary: 'Start Trans.eu account linking (OAuth redirect)' })
  connect(@CurrentUser() user: JwtUser, @Res() res: Response) {
    const redirectUri = `${process.env.API_BASE_URL}/api/integrations/transeu/callback`;
    const url = this.service.getAuthorizationUrl(user.companyId, redirectUri);
    return res.redirect(url);
  }

  @Get('callback')
  @ApiOperation({ summary: 'OAuth callback from Trans.eu (do not call manually)' })
  async callback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Query('error') error: string,
    @Res() res: Response,
  ) {
    if (error) {
      const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:3000';
      return res.redirect(`${frontendUrl}/settings?transeu=error&reason=${error}`);
    }

    const redirectUri = `${process.env.API_BASE_URL}/api/integrations/transeu/callback`;
    await this.service.handleCallback(code, state, redirectUri);

    const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:3000';
    return res.redirect(`${frontendUrl}/settings?transeu=connected`);
  }

  @Get('status')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, CompanyGuard)
  @ApiOperation({ summary: 'Trans.eu connection status' })
  status(@CurrentUser() user: JwtUser) {
    return this.service.getConnectionStatus(user.companyId);
  }

  @Delete('disconnect')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, CompanyGuard)
  @ApiOperation({ summary: 'Disconnect Trans.eu account' })
  async disconnect(@CurrentUser() user: JwtUser) {
    await this.service.disconnect(user.companyId);
    return { success: true, message: 'Trans.eu disconnected' };
  }
}
