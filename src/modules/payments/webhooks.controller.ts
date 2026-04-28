import { Controller, Headers, HttpCode, HttpStatus, Logger, Post, Req, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { WebhooksService } from './webhooks.service';

// IMPORTANT — main.ts wires `express.raw({ type: 'application/json' })` on
// `/webhooks/stripe` BEFORE the global JSON parser. The handler reads the
// raw Buffer from `req.body` for signature verification.
//
// This route MUST always return 200 once the signature is valid, regardless
// of internal handling outcome. Stripe retries on non-2xx, and we have
// idempotency on stripe_event_id — retries are wasted budget.
@ApiTags('Stripe Webhooks')
@Controller('webhooks/stripe')
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);

  constructor(private readonly webhooksService: WebhooksService) {}

  @Post()
  @HttpCode(200)
  @ApiOperation({
    summary: 'Stripe webhook receiver. Signature-verified; auth comes from Stripe.',
  })
  public async handle(
    @Req() request: Request,
    @Res() response: Response,
    @Headers('stripe-signature') signature: string
  ): Promise<void> {
    let event;
    try {
      const body = request.body as Buffer;
      event = this.webhooksService.verifyAndParse(body, signature);
    } catch (err) {
      this.logger.warn(`Webhook signature verification failed: ${(err as Error).message}`);
      response.status(HttpStatus.BAD_REQUEST).json({
        error: true,
        message: 'Invalid Stripe signature',
        code: 'INVALID_SIGNATURE',
        statusCode: HttpStatus.BAD_REQUEST,
      });
      return;
    }

    await this.webhooksService.handleEvent(event);
    response.status(HttpStatus.OK).json({ received: true });
  }
}
