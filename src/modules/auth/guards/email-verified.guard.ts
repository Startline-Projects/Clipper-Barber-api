import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { SupabaseService, SupabaseUserPayload } from '../../supabase/supabase.service';
import { EmailNotVerifiedException } from '../exceptions/email-not-verified.exception';

/**
 * Allows the request through only when the authenticated user's role row
 * has email_verified_at set. Must run AFTER JwtAuthGuard (relies on req.user).
 *
 * The role row is the source of truth — supabase's own email_confirmed_at
 * is set at createUser time and is intentionally not used here.
 */
@Injectable()
export class EmailVerifiedGuard implements CanActivate {
  constructor(private readonly supabaseService: SupabaseService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{ user: SupabaseUserPayload }>();
    const user = request.user;
    const role = user.user_metadata?.role;
    const table = role === 'barber' ? 'barbers' : 'clients';

    const { data } = await this.supabaseService
      .getClient()
      .from(table)
      .select('email_verified_at')
      .eq('user_id', user.sub)
      .maybeSingle();

    if (!data?.email_verified_at) {
      throw new EmailNotVerifiedException();
    }

    return true;
  }
}
