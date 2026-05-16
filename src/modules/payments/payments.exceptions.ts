import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';

// Class names are intentionally PascalCase so the global HttpExceptionFilter's
// toSnakeCase(exception.name) produces the exact error codes required by the
// payments spec: SubscriptionRequired → SUBSCRIPTION_REQUIRED, etc.

export class SubscriptionRequired extends ForbiddenException {
  constructor(message = 'Active subscription required.') {
    super(message);
  }
}

export class PlanDowngradeNotAllowed extends BadRequestException {
  constructor(
    message = 'Downgrading from yearly to monthly is not supported. Please cancel and re-subscribe.'
  ) {
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
