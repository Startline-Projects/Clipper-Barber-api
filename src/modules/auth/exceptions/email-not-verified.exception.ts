import { ForbiddenException } from '@nestjs/common';
import messages from '../../../common/messages.json';

/**
 * Thrown when an authenticated user attempts a gated action before
 * verifying their email. The global HTTP filter snake-cases the class
 * name into the response `code` field — apps detect EMAIL_NOT_VERIFIED_EXCEPTION
 * and surface the verify screen.
 */
export class EmailNotVerifiedException extends ForbiddenException {
  constructor(message: string = messages.auth.EMAIL_NOT_VERIFIED) {
    super(message);
  }
}
