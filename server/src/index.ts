import { app } from './app';
import { env } from './config/env';
import { ensureAccrualsUpToDate } from './lib/accrual';

app.listen(env.port, () => {
  console.log(`HRMS API listening on http://localhost:${env.port}`);
  // Non-blocking leave-accrual catch-up so balances are current on startup (design §4).
  ensureAccrualsUpToDate()
    .then((created) => console.log(`[accrual] catch-up complete; ${created} row(s) created`))
    .catch((err) => console.error('[accrual] catch-up failed:', err));
});
