import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { StockStatus } from '@prisma/client';

export class SearchProductsDto {
  // Free text — matches against product name and CAS number.
  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @IsString()
  categorySlug?: string;

  // Filters by the seller company's province (Section 5.2 location facet)
  @IsOptional()
  @IsString()
  province?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  maxLeadTimeDays?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  maxMoqValue?: number;

  @IsOptional()
  @IsEnum(StockStatus)
  stockStatus?: StockStatus;

  // Section 5.2: "Trust Score ขั้นต่ำ" filter — reads from the seller's
  // SELLER CompanyRole composite score (Section 15.1).
  @IsOptional()
  @Type(() => Number)
  @Min(0)
  @Max(5)
  minTrustScore?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number = 20;
}
