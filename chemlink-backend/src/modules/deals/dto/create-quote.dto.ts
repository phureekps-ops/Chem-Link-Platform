import { IsDateString, IsInt, IsNumber, IsOptional, IsString, Min, MinLength } from 'class-validator';

export class CreateQuoteDto {
  @IsNumber()
  @Min(0.01)
  price: number;

  @IsString()
  @MinLength(1)
  priceUnit: string;

  @IsString()
  @MinLength(1)
  paymentTerms: string;

  @IsInt()
  @Min(0)
  leadTimeDays: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  moqValue?: number;

  @IsOptional()
  @IsDateString()
  validUntil?: string;
}
