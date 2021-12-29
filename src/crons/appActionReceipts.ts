import { DatabasePool, sql, NotFoundError } from 'slonik';
import { CronJob } from './CronJob';
import { DAY, MINUTE } from '../utils/constants';

type AppActionReceiptsSpec = {
  localCachePool: DatabasePool;
  indexerCachepool: DatabasePool;
  environment: Record<string, string>;
};

interface actionReceiptActionProps {
  receipt_id: string;
  index_in_action_receipt: number;
  action_kind: string;
  args: Object;
  receipt_predecessor_account_id: string;
  receipt_receiver_account_id: string;
  receipt_included_in_block_timestamp: number;
}

export default (spec: AppActionReceiptsSpec): CronJob => {
  const { localCachePool, indexerCachepool } = spec;
  const cronName = 'APP_ACTIONS_RECEIPT';

  const run = async () => {
    const startEpoch = await (async (): Promise<number> => {
      let lastUpdate: number;
      try {
        lastUpdate = (await localCachePool.oneFirst(sql`
          select block_timestamp from last_update where cron_name = ${cronName}
        `)) as number;
      } catch (error) {
        if (error instanceof NotFoundError) {
          const lastSevenDays = Date.now() - DAY * 7;
          const lastSevenDaysEpoch = lastSevenDays * 1_000_000;

          await localCachePool.query(sql`
            insert into last_update (block_height, cron_name, block_timestamp) 
              values (${null}, ${cronName}, ${lastSevenDaysEpoch})
          `);
          return lastSevenDaysEpoch;
        }

        throw error;
      }

      return lastUpdate;
    })();

    console.log(`${cronName} startEpoch`, startEpoch);
    // exclude all the columns that were not part of the local cache schema
    const endEpoch: number = startEpoch + MINUTE * 30 * 1_000_000;
    console.log(`${cronName} endEpoch`, endEpoch);

    indexerCachepool.transaction(async txConnection => {
      const actionReceipts = await txConnection.many(sql`
        select
          receipt_id,
          index_in_action_receipt,
          action_kind,
          args,
          receipt_predecessor_account_id,
          receipt_receiver_account_id,
          receipt_included_in_block_timestamp
        from
          action_receipt_actions
        where
          receipt_included_in_block_timestamp > ${startEpoch} and receipt_included_in_block_timestamp <= ${endEpoch}
      `);

      if (!actionReceipts) {
        return;
      }

      const actionReceiptValues = actionReceipts.map(a =>
        Object.values(a),
      ) as readonly any[];

      localCachePool.transaction(async localTxConn => {
        await localTxConn.query(sql`
          insert into
            action_receipt_actions
          (
            ${sql`receipt_id,`}
            ${sql`index_in_action_receipt,`}
            ${sql`action_kind,`}
            ${sql`args,`}
            ${sql`receipt_predecessor_account_id,`}
            ${sql`receipt_receiver_account_id,`}
            ${sql`receipt_included_in_block_timestamp,`}
          )
          select * from
            ${sql.unnest(actionReceiptValues, [
              'text',
              'integer',
              'action_kind',
              'jsonb',
              'text',
              'text',
              'numeric',
            ])}
        `);

        const lastActionReceipt = actionReceipts[
          actionReceipts.length - 1
        ] as unknown as actionReceiptActionProps;
        const lastBlockTimeStamp =
          lastActionReceipt.receipt_included_in_block_timestamp;
        await localTxConn.query(
          sql`update last_update set block_timestamp = ${lastBlockTimeStamp} where cron_name = ${cronName}`,
        );
      });
    });

    console.log('');
  };

  return Object.freeze({
    isEnabled: true,
    cronName,
    schedule: '*/1 * * * *', // every 1 minute,
    run,
  });
};
