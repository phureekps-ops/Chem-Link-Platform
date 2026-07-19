import { IsDateString, IsEnum, IsOptional, IsString, MinLength } from 'class-validator';
import { ProductDocType } from '@prisma/client';

// File upload/storage (S3 or similar) is not wired up in this slice —
// fileUrl is accepted as-is. Swap this for a signed-upload flow when
// object storage is chosen (Section 8, Integration Layer).
export class AddProductDocumentDto {
  @IsEnum(ProductDocType)
  docType: ProductDocType;

  @IsString()
  @MinLength(4)
  fileUrl: string;

  @IsOptional()
  @IsString()
  version?: string;

  @IsOptional()
  @IsDateString()
  issuedAt?: string;
}
