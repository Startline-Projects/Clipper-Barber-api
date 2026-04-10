import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { SupabaseUserPayload } from '../../supabase/supabase.service';
import messages from '../../../common/messages.json';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles || requiredRoles.length === 0) return true;

    const request = context.switchToHttp().getRequest<{ user: SupabaseUserPayload }>();
    const user = request.user;

    // Custom role is stored in user_metadata within the Supabase JWT
    const userRole = user.user_metadata?.role;

    if (!requiredRoles.includes(userRole)) {
      throw new ForbiddenException(messages.auth.INSUFFICIENT_ROLE);
    }

    return true;
  }
}
