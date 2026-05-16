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
import { BarberSignupCategoriesDto } from './dto/barber-step4.dto';
import { normalizeCategories } from '../../common/enums/barber-category-tag.enum';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ClientRegisterDto } from './dto/client-register.dto';
import { GoogleLoginDto } from './dto/google-login.dto';
import { LoginDto } from './dto/login.dto';
import { ResendVerificationDto, VerifyEmailDto } from './dto/verify-email.dto';
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
      email_confirm: false,
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

    await this.sendSignupConfirmation(dto.email);
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

    return this.projectBarberProfile(data as Record<string, unknown>);
  }

  /**
   * Barber signup step 4 — persist optional category/specialty tags.
   * Skippable: an omitted `categories` field clears nothing and saves an
   * empty selection. The supplied array fully replaces any existing tags.
   * Onboarding state is intentionally left untouched (step 3 already
   * completes onboarding).
   */
  public async updateBarberStep4(
    userId: string,
    dto: BarberSignupCategoriesDto
  ): Promise<BarberProfileResponseDto> {
    const categories = normalizeCategories(dto.categories);

    const { data, error } = await this.client
      .from('barbers')
      .update({ categories })
      .eq('user_id', userId)
      .select('*')
      .single();

    if (error || !data) {
      throw new InternalServerErrorException(messages.barber.PROFILE_UPDATE_FAILED);
    }

    return this.projectBarberProfile(data as Record<string, unknown>);
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
      email_confirm: false,
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

    await this.sendSignupConfirmation(dto.email);
    return this.signInAndReturnTokens(dto.email, dto.password);
  }

  /**
   * Google sign-in for clients only.
   *
   * The mobile app obtains a Google id_token natively and posts it here.
   * We exchange it for a Supabase session via signInWithIdToken; Supabase
   * either matches an existing auth user by email or provisions a new one
   * with email_verified=true (Google has already attested the email).
   *
   * If the user is new we also create the matching `clients` row.
   * Barbers cannot sign in with Google — the barber flow requires the
   * multi-step onboarding, so we reject if the email already belongs to a
   * barber.
   */
  public async googleLogin(dto: GoogleLoginDto): Promise<LoginResponseDto> {
    const anonClient = this.supabaseService.getAuthClient();
    const { data, error } = await anonClient.auth.signInWithIdToken({
      provider: 'google',
      token: dto.idToken,
      access_token: dto.accessToken,
    });

    if (error || !data.session || !data.user) {
      throw new UnauthorizedException(messages.auth.GOOGLE_INVALID_TOKEN);
    }

    const user = data.user;
    const existingRole = (user.user_metadata?.role as string | undefined) ?? undefined;

    if (existingRole === 'barber') {
      throw new ConflictException(messages.auth.GOOGLE_ROLE_RESERVED);
    }

    if (!existingRole) {
      const username = await this.deriveUniqueUsername(dto.username, user.email ?? '');

      await this.client.auth.admin.updateUserById(user.id, {
        user_metadata: { ...user.user_metadata, role: 'client', username },
      });

      const { error: insertError } = await this.client.from('clients').insert({
        user_id: user.id,
        username,
        name: (user.user_metadata?.full_name as string | undefined) ?? username,
      });

      if (insertError && insertError.code !== '23505') {
        throw new InternalServerErrorException(insertError.message);
      }
    }

    const payload = await this.supabaseService.getUserFromToken(data.session.access_token);
    const tokens: TokensResponseDto = {
      accessToken: data.session.access_token,
      refreshToken: data.session.refresh_token,
    };
    return this.buildClientLoginResponse(tokens, payload);
  }

  public async verifyEmail(dto: VerifyEmailDto): Promise<SuccessResponseDto> {
    const { error } = await this.client.auth.verifyOtp({
      token_hash: dto.token,
      type: dto.type ?? 'signup',
    });

    if (error) {
      throw new UnauthorizedException(messages.auth.EMAIL_VERIFY_FAILED);
    }

    return { success: true };
  }

  /**
   * Re-sends the signup confirmation email. Always returns success — we
   * don't reveal whether the email exists, mirroring forgotPassword.
   */
  public async resendVerification(dto: ResendVerificationDto): Promise<SuccessResponseDto> {
    const anonClient = this.supabaseService.getAuthClient();
    await anonClient.auth.resend({ type: 'signup', email: dto.email });
    return { success: true };
  }

  private async sendSignupConfirmation(email: string): Promise<void> {
    const anonClient = this.supabaseService.getAuthClient();
    // Best-effort — never block account creation on email transport.
    await anonClient.auth.resend({ type: 'signup', email }).catch(() => undefined);
  }

  private async deriveUniqueUsername(preferred: string | undefined, email: string): Promise<string> {
    const base = (preferred ?? email.split('@')[0] ?? 'user')
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, '_')
      .slice(0, 24) || 'user';

    for (let i = 0; i < 5; i++) {
      const candidate = i === 0 ? base : `${base}_${Math.floor(Math.random() * 10000)}`;
      const { data } = await this.client
        .from('clients')
        .select('id')
        .eq('username', candidate)
        .maybeSingle();
      if (!data) return candidate;
    }
    return `${base}_${Date.now().toString(36)}`;
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

      return this.projectBarberProfile(data as Record<string, unknown>);
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

  private projectBarberProfile(row: Record<string, unknown>): BarberProfileResponseDto {
    const {
      id: _internalId,
      user_id,
      allow_auto_confirm,
      auto_confirm_today,
      recurring_enabled,
      no_show_charge_enabled,
      no_show_charge_amount_usd,
      stripe_connect_account_id,
      latitude,
      longitude,
      ...rest
    } = row;
    return {
      ...(rest as Record<string, unknown>),
      id: user_id,
      latitude,
      longitude,
      allowAutoConfirm: !!allow_auto_confirm,
      autoConfirmToday: !!auto_confirm_today,
      recurringEnabled: !!recurring_enabled,
      noShowChargeEnabled: !!no_show_charge_enabled,
      noShowChargeAmountUsd:
        no_show_charge_amount_usd !== null && no_show_charge_amount_usd !== undefined
          ? Number(no_show_charge_amount_usd)
          : null,
      stripeConnected: !!stripe_connect_account_id,
      locationSet:
        latitude !== null &&
        latitude !== undefined &&
        longitude !== null &&
        longitude !== undefined,
    } as unknown as BarberProfileResponseDto;
  }

  public async forgotPassword(email: string): Promise<SuccessResponseDto> {
    await this.client.auth.resetPasswordForEmail(email);
    return { success: true };
  }

  public async changePassword(
    user: SupabaseUserPayload,
    dto: ChangePasswordDto
  ): Promise<SuccessResponseDto> {
    if (dto.currentPassword === dto.newPassword) {
      throw new BadRequestException(messages.password.SAME_AS_CURRENT);
    }

    if (!user.email) {
      throw new UnauthorizedException(messages.auth.INVALID_TOKEN);
    }

    const anonClient = this.supabaseService.getAuthClient();
    const { error: signInError } = await anonClient.auth.signInWithPassword({
      email: user.email,
      password: dto.currentPassword,
    });

    if (signInError) {
      throw new UnauthorizedException(messages.password.CURRENT_INVALID);
    }

    const { error: updateError } = await this.client.auth.admin.updateUserById(user.sub, {
      password: dto.newPassword,
    });

    if (updateError) {
      throw new InternalServerErrorException(messages.password.UPDATE_FAILED);
    }

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
    const path = `profiles/${userId}/profile.${ext}`;

    const { error } = await this.client.storage
      .from('images')
      .upload(path, photo.buffer, { contentType: photo.mimetype, upsert: true });

    if (error) {
      throw new InternalServerErrorException(messages.barber.PHOTO_UPLOAD_FAILED);
    }

    const { data } = this.client.storage.from('images').getPublicUrl(path);
    return data.publicUrl;
  }
}
