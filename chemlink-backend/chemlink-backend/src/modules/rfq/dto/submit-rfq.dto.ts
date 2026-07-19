import { ArrayMinSize, ArrayUnique, IsArray, IsEnum, IsOptional, IsString, ValidateIf } from 'class-validator';
import { RfqDistributionType } from '@prisma/client';

export class SubmitRfqDto {
  @IsEnum(RfqDistributionType)
  distributionType: RfqDistributionType;

  // Required only for TARGETED — the buyer's chosen seller companies.
  // Ignored for MARKET, where sellers are matched by category/CAS instead.
  @ValidateIf((dto: SubmitRfqDto) => dto.distributionType === RfqDistributionType.TARGETED)
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsString({ each: true })
  sellerCompanyIds?: string[];
}
