import { app } from './app';
import { env } from './config/env';
import { ensureAccrualsUpToDate } from './lib/accrual';
import { ensureContractRemindersUpToDate } from './lib/contractReminders';

app.listen(env.port, () => {
  console.log(`HRMS API listening on http://localhost:${env.port}`);
  // Non-blocking leave-accrual catch-up so balances are current on startup (design §4).
  ensureAccrualsUpToDate()
    .then((created) => console.log(`[accrual] catch-up complete; ${created} row(s) created`))
    .catch((err) => console.error('[accrual] catch-up failed:', err));
  // Same pattern for contract-end reminders — there is no scheduler in this system.
  ensureContractRemindersUpToDate()
    .then((sent) => console.log(`[contracts] reminder catch-up complete; ${sent} sent`))
    .catch((err) => console.error('[contracts] reminder catch-up failed:', err));
});
