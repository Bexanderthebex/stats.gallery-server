import { QueryResultRow } from 'slonik';
import accessKeysSql from './queries/access-keys.sql';
import accountActivityDistributionSql from './queries/account-activity-distribution.sql';
import accountCreationSql from './queries/account-creation.sql';
import accountRelationStrengthSql from './queries/account-relation-strength.sql';
import actionsSql from './queries/actions.sql';
import allAccountsSql from './queries/all-accounts.sql';
import badgeDeploySql from './queries/badge-deploy.sql';
import badgeNftSql from './queries/badge-nft.sql';
import badgeStakeSql from './queries/badge-stake.sql';
import badgeTransferSql from './queries/badge-transfer.sql';
import leaderboardBalanceSql from './queries/cache/leaderboard-balance.sql';
import leaderboardScoreSql from './queries/cache/leaderboard-score.sql';
import distinctReceiversSql from './queries/distinct-receivers.sql';
import distinctSendersSql from './queries/distinct-senders.sql';
import gasSpentSql from './queries/gas-spent.sql';
import gasTokensSpentSql from './queries/gas-tokens-spent.sql';
import mostActiveWalletSql from './queries/most-active-wallet-within-range.sql';
import mostActiveNftSql from './queries/most-active-nft-within-range.sql';
import newAccountsCountSql from './queries/new-accounts-count.sql';
import newAccountsListSql from './queries/new-accounts-list.sql';
import receivedTransactionCountSql from './queries/received-transaction-count.sql';
import recentTransactionActionsSql from './queries/recent-transaction-actions.sql';
import scoreCalculateSql from './queries/score-calculate.sql';
import scoreFromCacheSql from './queries/score-from-cache.sql';
import sentTransactionCountSql from './queries/sent-transaction-count.sql';
import topAccountsSql from './queries/top-accounts.sql';
import totalReceivedSql from './queries/total-received.sql';
import totalSentSql from './queries/total-sent.sql';
import { MINUTE, DAY, HOUR } from './utils/constants';
import axios from 'axios';
import { RedisClientType } from 'redis';

export default [
  {
    path: 'access-keys',
    query: accessKeysSql,
  },
  {
    path: 'account-activity-distribution',
    query: accountActivityDistributionSql,
    poll: 3 * DAY,
    db: 'cache',
  },
  {
    path: 'account-creation',
    query: accountCreationSql,
  },
  {
    path: 'account-relation-strength',
    query: accountRelationStrengthSql,
  },
  {
    path: 'actions',
    query: actionsSql,
  },
  {
    path: 'all-accounts',
    query: allAccountsSql,
    poll: HOUR,
  },
  {
    path: 'badge-deploy',
    query: badgeDeploySql,
  },
  {
    path: 'badge-nft',
    query: badgeNftSql,
  },
  {
    path: 'badge-stake',
    query: badgeStakeSql,
  },
  {
    path: 'badge-transfer',
    query: badgeTransferSql,
  },
  {
    path: 'distinct-receivers',
    query: distinctReceiversSql,
  },
  {
    path: 'distinct-senders',
    query: distinctSendersSql,
  },
  {
    path: 'gas-spent',
    query: gasSpentSql,
  },
  {
    path: 'gas-tokens-spent',
    query: gasTokensSpentSql,
  },
  {
    path: 'new-accounts-count',
    query: newAccountsCountSql,
    poll: HOUR,
    db: 'cache',
  },
  {
    path: 'new-accounts-list',
    query: newAccountsListSql,
    poll: 10 * MINUTE,
    db: 'cache',
  },
  {
    path: 'received-transaction-count',
    query: receivedTransactionCountSql,
  },
  {
    path: 'recent-transaction-actions',
    query: recentTransactionActionsSql,
  },
  {
    path: 'score',
    query: scoreFromCacheSql,
    db: 'cache',
  },
  {
    path: 'score-calculate',
    query: scoreCalculateSql,
  },
  {
    path: 'sent-transaction-count',
    query: sentTransactionCountSql,
  },
  {
    path: 'top-accounts',
    query: topAccountsSql,
    poll: 6 * HOUR,
  },
  {
    path: 'total-received',
    query: totalReceivedSql,
  },
  {
    path: 'total-sent',
    query: totalSentSql,
  },

  // Leaderboards
  {
    path: 'leaderboard-balance',
    query: leaderboardBalanceSql,
    db: 'cache',
    poll: 1 * HOUR,
  },
  {
    path: 'leaderboard-score',
    query: leaderboardScoreSql,
    db: 'cache',
    poll: 1 * HOUR,
  },
  {
    path: 'leaderboard-transactions-week',
    query: () => {
      const oneWeekAgo = Date.now() - DAY * 7;

      return mostActiveWalletSql(
        {
          after_block_timestamp: oneWeekAgo * 1_000_000,
        },
        15,
      );
    },
    db: 'cache',
    poll: 15 * MINUTE,
  },
  {
    path: 'leaderboard-dapps-week',
    query: () => {
      const oneWeekAgo = Date.now() - DAY * 7;

      return mostActiveWalletSql(
        {
          after_block_timestamp: oneWeekAgo * 1_000_000,
        },
        100,
      );
    },
    cacheReadThrough: async (cache: RedisClientType) => {
      return await cache.get('leaderboard-dapps-week');
    },
    preReturnProcessor: async (
      dbResult: QueryResultRow[] | undefined,
      cache: RedisClientType,
      rpcEndpoint: string,
    ) => {
      if (!dbResult) {
        return dbResult;
      }

      const top5: QueryResultRow[] = [];
      for await (const acc of dbResult || []) {
        const accID = acc.account_id as string;
        const res = await axios.post(
          rpcEndpoint,
          {
            jsonrpc: '2.0',
            id: 'stats.gallery',
            method: 'query',
            params: {
              request_type: 'view_account',
              account_id: accID,
              finality: 'final',
            },
          },
          {
            headers: { 'content-type': 'application/json' },
          },
        );
        if (
          res.data.result &&
          res.data.result.code_hash != undefined &&
          res.data.result.code_hash != '11111111111111111111111111111111'
        ) {
          top5.push(acc);
          if (top5.length >= 5) {
            break;
          }
        }
      }

      // expire in 10 minutes
      await cache.set('leaderboard-dapps-week', JSON.stringify(top5), {
        EX: 600,
      });

      return top5;
    },
    db: 'cache',
    poll: 15 * MINUTE,
  },
  {
    path: 'leaderboard-nfts-week',
    db: 'cache',
    poll: 15 * MINUTE,
    query: () => {
      const oneWeekAgo = Date.now() - DAY * 7;

      return mostActiveNftSql(
        {
          after_block_timestamp: oneWeekAgo * 1_000_000,
        },
        100,
      );
    },
    cacheReadThrough: async (cache: RedisClientType) => {
      return await cache.get('leaderboard-nfts-week');
    },
    preReturnProcessor: async (
      dbResult: QueryResultRow[] | undefined,
      cache: RedisClientType,
      rpcEndpoint: string,
    ) => {
      if (!dbResult) {
        return dbResult;
      }

      const top5: QueryResultRow[] = [];
      for (const acc of dbResult || []) {
        top5.push(acc);
        if (top5.length >= 5) {
          break;
        }
      }

      // expire in 10 minutes
      await cache.set('leaderboard-nfts-week', JSON.stringify(top5), {
        EX: 600,
      });

      return top5;
    },
  },
];
