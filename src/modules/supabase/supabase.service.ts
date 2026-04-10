import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as jwt from 'jsonwebtoken';

export interface SupabaseUserPayload {
  sub: string;
  email: string;
  role: string;
  aud: string;
  exp: number;
}

@Injectable()
export class SupabaseService {
  private readonly client: SupabaseClient;

  constructor(private readonly configService: ConfigService) {
    const url = this.configService.getOrThrow<string>('SUPABASE_URL');
    const serviceRoleKey = this.configService.getOrThrow<string>('SUPABASE_SERVICE_ROLE_KEY');

    this.client = createClient(url, serviceRoleKey, {
      auth: { persistSession: false },
    });
  }

  getClient(): SupabaseClient {
    return this.client;
  }

  getUserFromToken(token: string): SupabaseUserPayload {
    const secret = this.configService.getOrThrow<string>('SUPABASE_JWT_SECRET');

    try {
      const payload = jwt.verify(token, secret) as SupabaseUserPayload;
      return payload;
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }
}
