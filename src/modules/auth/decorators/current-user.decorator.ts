import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { SupabaseUserPayload } from '../../supabase/supabase.service';

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): SupabaseUserPayload => {
    const request = ctx.switchToHttp().getRequest<{ user: SupabaseUserPayload }>();
    return request.user;
  }
);
