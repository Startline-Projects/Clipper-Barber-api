import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { BookingCompletionService } from './booking-completion.service';

@Injectable()
export class BookingCompletionCron {
  constructor(private readonly completionService: BookingCompletionService) {}

  @Cron(CronExpression.EVERY_HOUR)
  public async handleCron(): Promise<void> {
    await this.completionService.runCompletionSweep();
  }
}
