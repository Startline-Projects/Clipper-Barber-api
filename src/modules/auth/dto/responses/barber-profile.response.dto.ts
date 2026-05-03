import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class BarberProfileResponseDto {
  @ApiProperty({ description: 'Canonical user id — same value as auth.users.id' })
  id: string;

  @ApiProperty()
  full_name: string;

  @ApiProperty()
  shop_name: string;

  @ApiPropertyOptional()
  phone?: string;

  @ApiPropertyOptional()
  street_address?: string;

  @ApiPropertyOptional()
  city?: string;

  @ApiPropertyOptional()
  state?: string;

  @ApiPropertyOptional()
  zip_code?: string;

  @ApiPropertyOptional()
  latitude?: number;

  @ApiPropertyOptional()
  longitude?: number;

  @ApiPropertyOptional()
  bio?: string;

  @ApiPropertyOptional()
  instagram_handle?: string;

  @ApiPropertyOptional()
  profile_photo_url?: string;

  @ApiProperty()
  onboarding_step: number;

  @ApiProperty()
  onboarding_complete: boolean;

  @ApiProperty()
  allowAutoConfirm: boolean;

  @ApiProperty()
  autoConfirmToday: boolean;

  @ApiProperty()
  recurringEnabled: boolean;

  @ApiProperty()
  noShowChargeEnabled: boolean;

  @ApiProperty({ nullable: true, type: Number })
  noShowChargeAmountUsd: number | null;

  @ApiProperty({ description: 'True when the barber has a Stripe Connect account on file' })
  stripeConnected: boolean;

  @ApiProperty({ description: 'True when both latitude and longitude are set on the profile' })
  locationSet: boolean;

  @ApiProperty()
  created_at: string;
}
