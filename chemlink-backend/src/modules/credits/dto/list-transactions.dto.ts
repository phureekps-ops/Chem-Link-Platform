import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import { RoleType } from '@prisma/client';

export class ListTransactionsDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  // Section 14.5 — let a dual-role company filter its ledger to just the
  // buyer-side or seller-side activity.
  @IsOptional()
  @IsEnum(RoleType)
  roleContext?: RoleType;
}
