import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CompaniesService } from './companies.service';
import { ActivateRoleDto } from './dto/activate-role.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';

@Controller('companies')
@UseGuards(JwtAuthGuard)
export class CompaniesController {
  constructor(private readonly companiesService: CompaniesService) {}

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.companiesService.findById(id);
  }

  @Get(':id/roles')
  listRoles(@Param('id') id: string) {
    return this.companiesService.listRoles(id);
  }

  // Only a company admin of that same company may activate a new role
  // for it — this is intentionally not opened up to any authenticated
  // user, since it changes what the whole company is allowed to do.
  @Post(':id/roles')
  activateRole(
    @Param('id') id: string,
    @Body() dto: ActivateRoleDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    if (user.companyId !== id || !user.isCompanyAdmin) {
      throw new ForbiddenException('Only a company admin can activate a new role.');
    }
    return this.companiesService.activateRole(id, dto.roleType);
  }
}
