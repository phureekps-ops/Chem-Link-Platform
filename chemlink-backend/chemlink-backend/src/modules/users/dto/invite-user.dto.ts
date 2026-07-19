import { ArrayMinSize, ArrayUnique, IsArray, IsEmail, IsEnum, IsOptional, IsString, MinLength } from 'class-validator';
import { RoleType } from '@prisma/client';

// A company admin uses this to add a teammate and scope which of the
// company's activated roles they can act under — e.g. a sales rep only
// gets SELLER even if the company also has BUYER activated (Section 14.1).
export class InviteUserDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  temporaryPassword: string;

  @IsString()
  @MinLength(2)
  fullName: string;

  @IsOptional()
  @IsString()
  position?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsEnum(RoleType, { each: true })
  allowedRoles: RoleType[];
}
