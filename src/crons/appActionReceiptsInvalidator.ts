import { DatabasePool, sql } from 'slonik';
import { CronJob } from './CronJob';
import { DAY } from '../utils/constants';

type TransactionInvalidatorCacheSpec = {
  localCachePool: DatabasePool;
  environment: Record<string, string>;
};

export default (spec: TransactionInvalidatorCacheSpec): CronJob => {
  const cronName = 'APP_ACTION_RECEIPTS_INVALIDATOR';
  const { localCachePool } = spec;

  const run = async () => {
    // Add a 1 day allowance before invalidating transactions
    const lastSevenDays = Date.now() - DAY * 8;
    const lastSevenDaysEpoch = lastSevenDays * 1_000_000;

    const res = await localCachePool.query(sql`
      delete from action_receipt_action where receipt_included_in_block_timestamp < ${lastSevenDaysEpoch}
    `);

    console.log('successfully deleted action_receipt_action', res);
  };

  return Object.freeze({
    isEnabled: !spec.environment['NO_UPDATE_CACHE'],
    cronName,
    schedule: '0 0 * * *', // every day
    run,
  });
};
