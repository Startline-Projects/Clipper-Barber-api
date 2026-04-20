import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';

// Class names are intentionally PascalCase so the global HttpExceptionFilter's
// toSnakeCase(exception.name) produces the exact error codes required by spec:
// Forbidden → FORBIDDEN, ScheduleNotFound → SCHEDULE_NOT_FOUND, etc.

export class Forbidden extends ForbiddenException {}
export class ScheduleNotFound extends NotFoundException {}
export class InvalidRegularHours extends BadRequestException {}
export class InvalidAfterHours extends BadRequestException {}
export class InvalidDayOffHours extends BadRequestException {}
export class DayOffConflict extends BadRequestException {}
export class InvalidSlotDuration extends BadRequestException {}
export class InvalidAdvanceNotice extends BadRequestException {}
export class InvalidRecurringConfig extends BadRequestException {}
