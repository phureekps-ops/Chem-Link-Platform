import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { CreditsService } from './credits.service';
import { ListTransactionsDto } from './dto/list-transactions.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';

// Section 13 — Credit & Billing System. Any authenticated user of a
// company can read that company's own wallet/ledger (Section 14.5: the
// wallet is shared across both roles, so no @Roles() restriction here).
// Writes (charging, granting) are not exposed here directly — charges
// happen as a side effect of the action they pay for (see RfqService.submit
// for the reference integration), and grants are service-only for now
// (see CreditsService.grantCredits).
@Controller('credits')
@UseGuards(JwtAuthGuard)
export class CreditsController {
  constructor(private readonly creditsService: CreditsService) {}

  @Get('wallet')
  getWallet(@CurrentUser() user: AuthenticatedUser) {
    return this.creditsService.getWalletSummary(user.companyId);
  }

  @Get('wallet/transactions')
  listTransactions(@Query() query: ListTransactionsDto, @CurrentUser() user: AuthenticatedUser) {
    return this.creditsService.listTransactions(
      user.companyId,
      query.page ?? 1,
      query.limit ?? 20,
      query.roleContext,
    );
  }

  // Section 13.1 Price Transparency — the frontend confirm-before-charge
  // dialog reads its "this costs N credits" figure from here.
  @Get('rate-card')
  getRateCard() {
    return this.creditsService.listRateCard();
  }
}
