import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';
import { SupabaseService, SupabaseUserPayload } from '../../supabase/supabase.service';
import messages from '../../../common/messages.json';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly supabaseService: SupabaseService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request & { user: SupabaseUserPayload }>();
    const authHeader = request.headers['authorization'];

    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException(messages.auth.MISSING_AUTH_HEADER);
    }

    const token = authHeader.slice(7);
    request.user = await this.supabaseService.getUserFromToken(token);

    return true;
  }
}
