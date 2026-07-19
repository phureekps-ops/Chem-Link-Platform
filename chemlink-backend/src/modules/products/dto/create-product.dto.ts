import { Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { ProductSpecGroup, StockStatus } from '@prisma/client';

// One row in the Enhanced TDS tabs (Section 5.3) — e.g.
// { group: 'PHYSICAL_CHEMICAL', label: 'ความบริสุทธิ์ (Purity)', value: '99.2%' }
class ProductSpecInput {
  @IsEnum(ProductSpecGroup)
  group: ProductSpecGroup;

  @IsString()
  @MinLength(1)
  label: string;

  @IsString()
  @MinLength(1)
  value: string;

  @IsOptional()
  @IsInt()
  sortOrder?: number;
}

export class CreateProductDto {
  @IsString()
  @MinLength(2)
  categoryId: string;

  @IsString()
  @MinLength(2)
  name: string;

  @IsOptional()
  @IsString()
  casNumber?: string;

  @IsOptional()
  @IsString()
  grade?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  moqValue?: number;

  @IsOptional()
  @IsString()
  moqUnit?: string;

  @IsOptional()
  priceMin?: number;

  @IsOptional()
  priceMax?: number;

  @IsOptional()
  @IsString()
  priceUnit?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  leadTimeDays?: number;

  @IsOptional()
  @IsEnum(StockStatus)
  stockStatus?: StockStatus;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProductSpecInput)
  specs?: ProductSpecInput[];
}
