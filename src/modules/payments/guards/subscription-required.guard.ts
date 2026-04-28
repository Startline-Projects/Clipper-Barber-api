import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { SupabaseService, SupabaseUserPayload } from '../../supabase/supabase.service';
import { SubscriptionRequired } from '../payments.exceptions';

// Apply via @UseGuards(JwtAuthGuard, RolesGuard, SubscriptionRequiredGuard) on
// any client-facing endpoint that creates or modifies a booking. The guard
// delegates the actual entitlement check to the Postgres helper
// is_client_subscribed(uuid), which mirrors the same condition used in RLS
// policies — so the API guard and the DB stay in lockstep.
@Injectable()
export class SubscriptionRequiredGuard implements CanActivate {
  constructor(private readonly supabaseService: SupabaseService) {}

  public async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{ user: SupabaseUserPayload }>();
    const authUserId = request.user?.sub;

    if (!authUserId) {
      throw new SubscriptionRequired();
    }

    const db = this.supabaseService.getClient();
    const { data, error } = await db.rpc('is_client_subscribed', {
      p_client_user_id: authUserId,
    });

    if (error) {
      // Fail closed — if the entitlement check itself errors, treat as unsub.
      throw new SubscriptionRequired();
    }

    if (data !== true) {
      throw new SubscriptionRequired();
    }

    return true;
  }
}
