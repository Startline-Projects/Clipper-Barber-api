import 'multer';
import {
  Body,
  Controller,
  Get,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { BarberStep1Dto } from './dto/barber-step1.dto';
import { BarberStep2Dto } from './dto/barber-step2.dto';
import { BarberStep3Dto } from './dto/barber-step3.dto';
import { ClientRegisterDto } from './dto/client-register.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { TokensResponseDto } from './dto/responses/tokens.response.dto';
import { LoginResponseDto } from './dto/responses/login.response.dto';
import { BarberProfileResponseDto } from './dto/responses/barber-profile.response.dto';
import { SuccessResponseDto } from './dto/responses/success.response.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { Roles } from './decorators/roles.decorator';
import { CurrentUser } from './decorators/current-user.decorator';
import { SupabaseUserPayload } from '../supabase/supabase.service';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('barber/step1')
  @ApiOperation({
    summary: 'Barber signup step 1 — create account',
    description:
      'Creates a Supabase auth user with role barber. Returns tokens to authenticate steps 2 and 3.',
  })
  @ApiBody({ type: BarberStep1Dto })
  @ApiResponse({ status: 201, description: 'Account created', type: TokensResponseDto })
  public registerBarberStep1(@Body() dto: BarberStep1Dto): Promise<TokensResponseDto> {
    return this.authService.registerBarberStep1(dto);
  }

  @Post('barber/step2')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('barber')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Barber signup step 2 — shop details',
    description:
      'Updates the barber row with shop info and coordinates. Requires bearer token from step 1.',
  })
  @ApiBody({ type: BarberStep2Dto })
  @ApiResponse({ status: 201, description: 'Shop details saved', type: SuccessResponseDto })
  public updateBarberStep2(
    @CurrentUser() user: SupabaseUserPayload,
    @Body() dto: BarberStep2Dto
  ): Promise<SuccessResponseDto> {
    return this.authService.updateBarberStep2(user.sub, dto);
  }

  @Post('barber/step3')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('barber')
  @UseInterceptors(FileInterceptor('photo'))
  @ApiBearerAuth()
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Barber signup step 3 — profile photo and bio',
    description:
      'Optionally uploads a photo to Supabase Storage and marks onboarding complete. Returns the full barber profile.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        photo: {
          type: 'string',
          format: 'binary',
          description: 'Optional profile photo (max 5 MB)',
        },
        bio: { type: 'string', maxLength: 500 },
        instagramHandle: { type: 'string', maxLength: 50, description: 'No @ symbol' },
      },
    },
  })
  @ApiResponse({
    status: 201,
    description: 'Onboarding complete — returns full barber profile',
    type: BarberProfileResponseDto,
  })
  public updateBarberStep3(
    @CurrentUser() user: SupabaseUserPayload,
    @Body() dto: BarberStep3Dto,
    @UploadedFile() photo?: Express.Multer.File
  ): Promise<BarberProfileResponseDto> {
    console.log(dto);
    return this.authService.updateBarberStep3(user.sub, dto, photo);
  }

  @Post('client/register')
  @ApiOperation({
    summary: 'Client signup — single step',
    description: 'Validates username uniqueness, creates account, returns tokens.',
  })
  @ApiBody({ type: ClientRegisterDto })
  @ApiResponse({ status: 201, description: 'Account created', type: TokensResponseDto })
  public registerClient(@Body() dto: ClientRegisterDto): Promise<TokensResponseDto> {
    return this.authService.registerClient(dto);
  }

  @Post('login')
  @ApiOperation({
    summary: 'Login — barbers and clients',
    description:
      'Role is sent by the app (not the user). Returns tokens + id/email/username. Barbers with incomplete onboarding receive a redirectTo field.',
  })
  @ApiBody({ type: LoginDto })
  @ApiResponse({ status: 201, description: 'Login successful', type: LoginResponseDto })
  public login(@Body() dto: LoginDto): Promise<LoginResponseDto> {
    return this.authService.login(dto);
  }

  @Post('refresh')
  @ApiOperation({ summary: 'Refresh access token' })
  @ApiBody({ type: RefreshTokenDto })
  @ApiResponse({ status: 201, description: 'New tokens issued', type: TokensResponseDto })
  public refresh(@Body() dto: RefreshTokenDto): Promise<TokensResponseDto> {
    return this.authService.refresh(dto.refreshToken);
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Logout — invalidates session server-side' })
  @ApiResponse({ status: 201, description: 'Session invalidated', type: SuccessResponseDto })
  public logout(@CurrentUser() user: SupabaseUserPayload): Promise<SuccessResponseDto> {
    return this.authService.logout(user.sub);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get current user profile',
    description: 'Returns the barber or client profile based on the JWT role.',
  })
  @ApiResponse({ status: 201, description: 'Profile returned', type: BarberProfileResponseDto })
  public getMe(
    @CurrentUser() user: SupabaseUserPayload
  ): Promise<BarberProfileResponseDto | Record<string, unknown>> {
    return this.authService.getMe(user);
  }

  @Post('forgot-password')
  @ApiOperation({
    summary: 'Request a password reset email',
    description:
      'Sends a reset email via Supabase. Always returns success to prevent email enumeration.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['email'],
      properties: { email: { type: 'string', format: 'email', example: 'user@example.com' } },
    },
  })
  @ApiResponse({ status: 201, description: 'Reset email dispatched', type: SuccessResponseDto })
  public forgotPassword(@Body('email') email: string): Promise<SuccessResponseDto> {
    return this.authService.forgotPassword(email);
  }

  @Post('reset-password')
  @ApiOperation({ summary: 'Reset password using OTP token from email link' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['token', 'newPassword'],
      properties: {
        token: { type: 'string', description: 'token_hash from the Supabase reset email link' },
        newPassword: { type: 'string', minLength: 8, example: 'NewSecurePass1!' },
      },
    },
  })
  @ApiResponse({ status: 201, description: 'Password updated', type: SuccessResponseDto })
  public resetPassword(
    @Body('token') token: string,
    @Body('newPassword') newPassword: string
  ): Promise<SuccessResponseDto> {
    return this.authService.resetPassword(token, newPassword);
  }
}
