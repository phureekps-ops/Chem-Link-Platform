import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { RoleType } from '@prisma/client';
import { RfqService } from './rfq.service';
import { CreateRfqDto } from './dto/create-rfq.dto';
import { UpdateRfqDto } from './dto/update-rfq.dto';
import { SubmitRfqDto } from './dto/submit-rfq.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';

@Controller('rfqs')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(RoleType.BUYER)
export class RfqController {
  constructor(private readonly rfqService: RfqService) {}

  @Post()
  create(@Body() dto: CreateRfqDto, @CurrentUser() user: AuthenticatedUser) {
    return this.rfqService.create(user.companyId, user.userId, dto);
  }

  @Get('mine')
  findMine(@CurrentUser() user: AuthenticatedUser) {
    return this.rfqService.findMine(user.companyId);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.rfqService.findOneOwned(user.companyId, id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateRfqDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.rfqService.update(user.companyId, id, dto);
  }

  // Section 5.4 step 2 — choose recipients and send (Section 6 step 1->2)
  @Post(':id/submit')
  submit(
    @Param('id') id: string,
    @Body() dto: SubmitRfqDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.rfqService.submit(user.companyId, id, dto);
  }

  @Post(':id/cancel')
  cancel(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.rfqService.cancel(user.companyId, id);
  }
}
