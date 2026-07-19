import { IsDateString, IsNumber, IsOptional, IsString, Min, MinLength } from 'class-validator';

export class CreateRfqDto {
  @IsOptional()
  @IsString()
  productId?: string; // link to a catalog Product if the buyer RFQ'd from a product page

  @IsString()
  @MinLength(2)
  categoryId: string;

  @IsString()
  @MinLength(2)
  productName: string;

  @IsOptional()
  @IsString()
  casNumber?: string;

  @IsOptional()
  @IsString()
  gradeRequirement?: string;

  @IsOptional()
  @IsString()
  purityRequirement?: string;

  @IsNumber()
  @Min(0.01)
  quantityValue: number;

  @IsString()
  @MinLength(1)
  quantityUnit: string;

  @IsString()
  @MinLength(2)
  deliveryLocation: string;

  @IsOptional()
  @IsDateString()
  deliveryDeadline?: string;

  @IsOptional()
  @IsString()
  paymentTermsNote?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
