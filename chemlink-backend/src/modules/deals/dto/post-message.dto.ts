import { IsOptional, IsString, MinLength } from 'class-validator';

export class PostMessageDto {
  @IsString()
  @MinLength(1)
  content: string;

  @IsOptional()
  @IsString()
  attachmentUrl?: string;
}
