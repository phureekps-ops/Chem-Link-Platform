import { HttpException, HttpStatus } from '@nestjs/common';

// Section 13.1 "Price Transparency": the frontend is expected to show a
// confirm dialog with the cost and remaining balance BEFORE calling the
// metered endpoint, so in the normal flow this should never actually
// fire. It exists as the backend's own guarantee that a debit never
// happens silently or below zero, regardless of what the client sent.
export class InsufficientCreditsException extends HttpException {
  constructor(shortfall: number, balance: number) {
    super(
      {
        statusCode: HttpStatus.PAYMENT_REQUIRED,
        error: 'Insufficient Credits',
        message: `This action needs ${shortfall} more credit(s) than your current balance of ${balance}.`,
      },
      HttpStatus.PAYMENT_REQUIRED,
    );
  }
}
