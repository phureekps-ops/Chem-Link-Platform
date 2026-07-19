import { IsEnum } from 'class-validator';
import { RoleType } from '@prisma/client';

export class ActivateRoleDto {
  @IsEnum(RoleType)
  roleType: RoleType;
}
