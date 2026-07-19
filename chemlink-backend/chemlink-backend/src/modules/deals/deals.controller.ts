import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { RoleType } from '@prisma/client';
import { DealsService } from './deals.service';
import { CreateQuoteDto } from './dto/create-quote.dto';
import { PostMessageDto } from './dto/post-message.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';

@Controller('deals')
@UseGuards(JwtAuthGuard)
export class DealsController {
  constructor(private readonly dealsService: DealsService) {}

  // Seller's RFQ inbox (Section 5.6)
  @Get('incoming')
  @UseGuards(RolesGuard)
  @Roles(RoleType.SELLER)
  findIncoming(@CurrentUser() user: AuthenticatedUser) {
    return this.dealsService.findIncomingForSeller(user.companyId);
  }

  // Deal Room view — either the buyer or the seller on this deal may read it.
  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.dealsService.findOne(id, user.companyId);
  }

  @Post(':id/acknowledge')
  @UseGuards(RolesGuard)
  @Roles(RoleType.SELLER)
  acknowledge(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.dealsService.acknowledge(id, user.companyId);
  }

  @Post(':id/quotes')
  @UseGuards(RolesGuard)
  @Roles(RoleType.SELLER)
  addQuote(
    @Param('id') id: string,
    @Body() dto: CreateQuoteDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.dealsService.addQuote(id, user.companyId, user.userId, dto);
  }

  @Post(':id/decline')
  @UseGuards(RolesGuard)
  @Roles(RoleType.SELLER)
  decline(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.dealsService.decline(id, user.companyId);
  }

  // Either side can post a message in the thread.
  @Post(':id/messages')
  addMessage(
    @Param('id') id: string,
    @Body() dto: PostMessageDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.dealsService.addMessage(id, user.companyId, user.userId, dto);
  }

  @Post(':id/close')
  @UseGuards(RolesGuard)
  @Roles(RoleType.BUYER)
  close(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.dealsService.close(id, user.companyId);
  }
}
