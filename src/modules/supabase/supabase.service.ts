import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import messages from '../../common/messages.json';

export interface SupabaseUserPayload {
  sub: string;
  email: string;
  role: string;
  aud: string;
  exp: number;
  user_metadata: {
    role: 'barber' | 'client';
    full_name?: string;
    username?: string;
    onboarding_complete?: boolean;
    onboarding_step?: number;
  };
}

@Injectable()
export class SupabaseService {
  private readonly adminClient: SupabaseClient;

  private readonly supabaseUrl: string;
  private readonly supabaseAnonKey: string;

  constructor(private readonly configService: ConfigService) {
    const url = this.configService.getOrThrow<string>('SUPABASE_URL');
    const serviceRoleKey = this.configService.getOrThrow<string>('SUPABASE_SERVICE_ROLE_KEY');
    const anonKey = this.configService.getOrThrow<string>('SUPABASE_ANON_KEY');

    this.supabaseUrl = url;
    this.supabaseAnonKey = anonKey;

    this.adminClient = createClient(url, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  getClient(): SupabaseClient {
    return this.adminClient;
  }

  getAuthClient(): SupabaseClient {
    return createClient(this.supabaseUrl, this.supabaseAnonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  async getUserFromToken(token: string): Promise<SupabaseUserPayload> {
    const { data, error } = await this.adminClient.auth.getUser(token);

    if (error || !data.user) {
      throw new UnauthorizedException(messages.auth.INVALID_TOKEN);
    }

    const u = data.user;
    return {
      sub: u.id,
      email: u.email ?? '',
      role: u.role ?? '',
      aud: u.aud ?? '',
      exp: u.confirmed_at ? Math.floor(new Date(u.confirmed_at).getTime() / 1000) : 0,
      user_metadata: u.user_metadata as SupabaseUserPayload['user_metadata'],
    };
  }
}
