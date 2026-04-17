import 'multer';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { SupabaseService, SupabaseUserPayload } from '../supabase/supabase.service';
import { BarberStep1Dto } from './dto/barber-step1.dto';
import { BarberStep2Dto } from './dto/barber-step2.dto';
import { BarberStep3Dto } from './dto/barber-step3.dto';
import { ClientRegisterDto } from './dto/client-register.dto';
import { LoginDto } from './dto/login.dto';
import { TokensResponseDto } from './dto/responses/tokens.response.dto';
import { LoginResponseDto } from './dto/responses/login.response.dto';
import { BarberProfileResponseDto } from './dto/responses/barber-profile.response.dto';
import { SuccessResponseDto } from './dto/responses/success.response.dto';
import messages from '../../common/messages.json';

@Injectable()
export class AuthService {
  constructor(private readonly supabaseService: SupabaseService) {}

  private get client() {
    return this.supabaseService.getClient();
  }

  public async registerBarberStep1(dto: BarberStep1Dto): Promise<TokensResponseDto> {
    const { data: userData, error: createError } = await this.client.auth.admin.createUser({
      email: dto.email,
      password: dto.password,
      email_confirm: true,
      user_metadata: {
        role: 'barber',
        full_name: dto.fullName,
        onboarding_step: 1,
        onboarding_complete: false,
      },
    });

    if (createError || !userData.user) {
      throw new BadRequestException(createError?.message ?? 'Failed to create user');
    }

    const { error: insertError } = await this.client.from('barbers').insert({
      user_id: userData.user.id,
      full_name: dto.fullName,
      onboarding_step: 1,
      onboarding_complete: false,
    });

    if (insertError) {
      await this.client.auth.admin.deleteUser(userData.user.id);
      throw new BadRequestException(insertError.message);
    }

    return this.signInAndReturnTokens(dto.email, dto.password);
  }

  public async updateBarberStep2(userId: string, dto: BarberStep2Dto): Promise<SuccessResponseDto> {
    const { data, error } = await this.client
      .from('barbers')
      .update({
        shop_name: dto.shopName,
        phone: dto.phone,
        street_address: dto.streetAddress,
        city: dto.city,
        state: dto.state,
        zip_code: dto.zipCode,
        latitude: dto.latitude,
        longitude: dto.longitude,
        onboarding_step: 2,
      })
      .eq('user_id', userId)
      .select('user_id')
      .single();

    if (error || !data) {
      throw new InternalServerErrorException(messages.barber.PROFILE_UPDATE_FAILED);
    }

    await this.client.auth.admin.updateUserById(userId, {
      user_metadata: { onboarding_step: 2 },
    });

    return { success: true };
  }

  public async updateBarberStep3(
    userId: string,
    dto: BarberStep3Dto,
    photo?: Express.Multer.File
  ): Promise<BarberProfileResponseDto> {
    const profilePhotoUrl = photo ? await this.uploadProfilePhoto(userId, photo) : undefined;

    const updatePayload: Record<string, unknown> = {
      onboarding_step: 3,
      onboarding_complete: true,
    };

    if (profilePhotoUrl) updatePayload['profile_photo_url'] = profilePhotoUrl;
    if (dto.bio) updatePayload['bio'] = dto.bio;
    if (dto.instagramHandle) updatePayload['instagram_handle'] = dto.instagramHandle;

    const { data, error } = await this.client
      .from('barbers')
      .update(updatePayload)
      .eq('user_id', userId)
      .select('*')
      .single();

    if (error || !data) {
      throw new InternalServerErrorException(messages.barber.PROFILE_COMPLETE_FAILED);
    }

    await this.client.auth.admin.updateUserById(userId, {
      user_metadata: { onboarding_step: 3, onboarding_complete: true },
    });

    return data as BarberProfileResponseDto;
  }

  public async registerClient(dto: ClientRegisterDto): Promise<TokensResponseDto> {
    const { data: existing } = await this.client
      .from('clients')
      .select('id')
      .eq('username', dto.username)
      .maybeSingle();

    if (existing) {
      throw new ConflictException(messages.client.USERNAME_TAKEN);
    }

    const { data: userData, error: createError } = await this.client.auth.admin.createUser({
      email: dto.email,
      password: dto.password,
      email_confirm: true,
      user_metadata: { role: 'client', username: dto.username },
    });

    if (createError || !userData.user) {
      throw new BadRequestException(createError?.message ?? 'Failed to create user');
    }

    const { error: insertError } = await this.client.from('clients').insert({
      user_id: userData.user.id,
      username: dto.username,
      name: dto.username,
    });

    if (insertError) {
      await this.client.auth.admin.deleteUser(userData.user.id);
      throw new BadRequestException(insertError.message);
    }

    return this.signInAndReturnTokens(dto.email, dto.password);
  }

  public async login(dto: LoginDto): Promise<LoginResponseDto> {
    const anonClient = this.supabaseService.getAuthClient();
    const { data, error } = await anonClient.auth.signInWithPassword({
      email: dto.email,
      password: dto.password,
    });

    if (error || !data.session) {
      throw new UnauthorizedException(messages.auth.INVALID_CREDENTIALS);
    }

    const payload = await this.supabaseService.getUserFromToken(data.session.access_token);
    const jwtRole = payload.user_metadata?.role;
    if (jwtRole !== dto.role) {
      throw new UnauthorizedException(messages.auth.ROLE_MISMATCH);
    }

    const tokens: TokensResponseDto = {
      accessToken: data.session.access_token,
      refreshToken: data.session.refresh_token,
    };
    if (dto.role === 'barber') {
      return this.buildBarberLoginResponse(tokens, payload);
    }

    return this.buildClientLoginResponse(tokens, payload);
  }

  public async refresh(refreshToken: string): Promise<TokensResponseDto> {
    const anonClient = this.supabaseService.getAuthClient();
    const { data, error } = await anonClient.auth.refreshSession({ refresh_token: refreshToken });

    if (error || !data.session) {
      throw new UnauthorizedException(messages.auth.INVALID_REFRESH_TOKEN);
    }

    return {
      accessToken: data.session.access_token,
      refreshToken: data.session.refresh_token,
    };
  }

  public async logout(userId: string): Promise<SuccessResponseDto> {
    await this.client.auth.admin.signOut(userId);
    return { success: true };
  }

  public async getMe(
    user: SupabaseUserPayload
  ): Promise<BarberProfileResponseDto | Record<string, unknown>> {
    const role = user.user_metadata?.role;

    if (role === 'barber') {
      const { data, error } = await this.client
        .from('barbers')
        .select('*')
        .eq('user_id', user.sub)
        .maybeSingle();

      if (error) {
        throw new InternalServerErrorException(messages.barber.PROFILE_LOAD_FAILED);
      }

      if (!data) {
        throw new NotFoundException('Barber profile not found');
      }

      return this.projectCanonicalId(
        data as Record<string, unknown>,
      ) as unknown as BarberProfileResponseDto;
    }

    const { data, error } = await this.client
      .from('clients')
      .select('*')
      .eq('user_id', user.sub)
      .maybeSingle();

    if (error) {
      throw new InternalServerErrorException(messages.client.PROFILE_LOAD_FAILED);
    }

    if (!data) {
      throw new NotFoundException('Client profile not found');
    }

    return this.projectCanonicalId(data as Record<string, unknown>);
  }

  // Profile rows still carry both the internal `id` (barbers.id / clients.id)
  // and `user_id` (auth.users.id). For API responses we expose only the auth id
  // — under the field name `id` — so every endpoint speaks the same identifier.
  private projectCanonicalId(row: Record<string, unknown>): Record<string, unknown> {
    const { id: _internalId, user_id, ...rest } = row;
    return { id: user_id, ...rest };
  }

  public async forgotPassword(email: string): Promise<SuccessResponseDto> {
    await this.client.auth.resetPasswordForEmail(email);
    return { success: true };
  }

  public async resetPassword(token: string, newPassword: string): Promise<SuccessResponseDto> {
    const { data, error } = await this.client.auth.verifyOtp({
      token_hash: token,
      type: 'recovery',
    });

    if (error || !data.user) {
      throw new UnauthorizedException(messages.auth.INVALID_RESET_TOKEN);
    }

    const { error: updateError } = await this.client.auth.admin.updateUserById(data.user.id, {
      password: newPassword,
    });

    if (updateError) {
      throw new InternalServerErrorException(messages.password.UPDATE_FAILED);
    }

    return { success: true };
  }

  private async signInAndReturnTokens(email: string, password: string): Promise<TokensResponseDto> {
    const anonClient = this.supabaseService.getAuthClient();
    const { data, error } = await anonClient.auth.signInWithPassword({ email, password });

    if (error || !data.session) {
      throw new InternalServerErrorException(messages.auth.ACCOUNT_SIGNIN_FAILED);
    }

    return {
      accessToken: data.session.access_token,
      refreshToken: data.session.refresh_token,
    };
  }

  private buildBarberLoginResponse(
    tokens: TokensResponseDto,
    payload: SupabaseUserPayload
  ): LoginResponseDto {
    const { full_name, onboarding_complete, onboarding_step } = payload.user_metadata;

    const response: LoginResponseDto = {
      ...tokens,
      id: payload.sub,
      email: payload.email,
      username: full_name ?? '',
    };

    if (!onboarding_complete) {
      response.redirectTo = `barber/step${(onboarding_step ?? 1) + 1}`;
    }

    return response;
  }

  private buildClientLoginResponse(
    tokens: TokensResponseDto,
    payload: SupabaseUserPayload
  ): LoginResponseDto {
    return {
      ...tokens,
      id: payload.sub,
      email: payload.email,
      username: payload.user_metadata.username ?? '',
    };
  }

  private async uploadProfilePhoto(userId: string, photo: Express.Multer.File): Promise<string> {
    const ext = photo.mimetype.split('/')[1] ?? 'jpg';
    const path = `${userId}/profile.${ext}`;

    const { error } = await this.client.storage
      .from('profile-photos')
      .upload(path, photo.buffer, { contentType: photo.mimetype, upsert: true });

    if (error) {
      throw new InternalServerErrorException(messages.barber.PHOTO_UPLOAD_FAILED);
    }

    const { data } = this.client.storage.from('profile-photos').getPublicUrl(path);
    return data.publicUrl;
  }
}
