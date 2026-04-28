import { ConflictException, ForbiddenException } from '@nestjs/common';

// Class names are intentionally PascalCase so the global HttpExceptionFilter's
// toSnakeCase(exception.name) produces the exact error codes required by the
// payments spec: SubscriptionRequired → SUBSCRIPTION_REQUIRED, etc.

export class SubscriptionRequired extends ForbiddenException {
  constructor(message = 'Active subscription required.') {
    super(message);
  }
}

export class PlanDowngradeNotAllowed extends ConflictException {
  constructor(message = 'Plan downgrades are not allowed. Yearly cannot revert to monthly.') {
    super(message);
  }
}

export class ActiveSubscription extends ConflictException {
  constructor(message = 'Cannot remove the saved card while a subscription is active.') {
    super(message);
  }
}

export class ActiveRecurring extends ConflictException {
  constructor(message = 'Cannot remove the saved card while a recurring arrangement is active.') {
    super(message);
  }
}

export class ConnectRequired extends ConflictException {
  constructor(
    message = 'A Stripe Connect account with charges enabled is required for this action.'
  ) {
    super(message);
  }
}
