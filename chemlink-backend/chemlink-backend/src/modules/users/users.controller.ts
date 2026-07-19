import { Body, Controller, ForbiddenException, Get, Post, UseGuards } from '@nestjs/common';
import { UsersService } from './users.service';
import { InviteUserDto } from './dto/invite-user.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  listMyCompanyUsers(@CurrentUser() user: AuthenticatedUser) {
    return this.usersService.listByCompany(user.companyId);
  }

  @Post('invite')
  invite(@Body() dto: InviteUserDto, @CurrentUser() user: AuthenticatedUser) {
    if (!user.isCompanyAdmin) {
      throw new ForbiddenException('Only a company admin can invite teammates.');
    }
    return this.usersService.inviteToCompany(user.companyId, dto);
  }
}
