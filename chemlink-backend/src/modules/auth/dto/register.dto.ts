import {
  IsArray,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  MinLength,
  ArrayMinSize,
  ArrayUnique,
} from 'class-validator';
import { RoleType } from '@prisma/client';

// Registration form maps directly to Section 14.1: at sign-up, the company
// picks one or more roles via multi-select rather than being forced into
// a single BUYER-or-SELLER choice.
export class RegisterDto {
  // --- Company fields ---
  @IsString()
  @MinLength(2)
  companyLegalName: string;

  @IsString()
  @MinLength(5)
  companyTaxId: string;

  @IsOptional()
  @IsString()
  companyAddress?: string;

  @IsOptional()
  @IsString()
  companyProvince?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsEnum(RoleType, { each: true })
  roles: RoleType[];

  // --- First admin user fields ---
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  password: string;

  @IsString()
  @MinLength(2)
  fullName: string;

  @IsOptional()
  @IsString()
  position?: string;
}
