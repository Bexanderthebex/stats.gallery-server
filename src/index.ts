import cors from '@koa/cors';
import Router from '@koa/router';
import Koa from 'koa';
import { schedule } from 'node-cron';
import { createPool, DatabasePoolType, sql } from 'slonik';
import initCrons from './crons';
import poll from './poll';
import { Params } from './queries/Params';
import routes from './routes';
import retry from './utils/retry';

const app = new Koa();
const port = process.env['PORT'] || 3000;
console.log('Listening on port ' + port + '...');
app.listen(port);
app.use(cors());

const index = new Router();

// Environment variable
const endpoints = process.env['ENDPOINT']!.split(',').map((s) => s.trim());
const connections = process.env['DB_CONNECTION']!.split(',').map((s) =>
  s.trim(),
);
const pools: DatabasePoolType[] = [];
const cachePool = createPool(process.env['CACHE_DB_CONNECTION']!);
const indexerDatabaseString = connections[endpoints.indexOf('mainnet')];
const indexerPool = createPool(indexerDatabaseString);

// we want to ensure that we close the connection pool when we exit the app to avoid memory leaks
process.on('exit', async () => {
  try {
    await Promise.all([await cachePool.end(), await indexerPool.end()]);
  } catch (error) {
    console.log('Error closing cache connection pools', error);
  }
});

if (endpoints.length === 0 || endpoints.length !== connections.length) {
  console.error('Invalid endpoint/connection configuration provided');
  process.exit(1);
}

endpoints.forEach(async (endpoint, i) => {
  const connection = connections[i];
  const router = new Router();

  console.log('Connection', connection);

  const pool = createPool(connection, {
    maximumPoolSize: 31,
  });
  pools.push(pool);

  console.log('Pool test:', await pool.one(sql`select 1`));

  routes.forEach((route) => {
    const routePool = route.db === 'cache' ? cachePool : pool;

    if (route.poll !== undefined) {
      const fn = () => routePool.any(route.query());
      const { call } = poll(fn, {
        updateInterval: route.poll,
        defaultValue: [],
      });

      router.get('/' + route.path, async (ctx, next) => {
        console.log('Request', ctx.request.url);
        try {
          const result = await call();
          // console.log('Response', result);

          ctx.response.body = result;
        } catch (e) {
          console.log(e);
          ctx.response.status = 500;
        }
      });
    } else {
      router.get('/' + route.path, async (ctx, next) => {
        console.log('Request', ctx.request.url);
        try {
          // const result = await routePool.any(route.query(ctx.query));
          const result = await retry(() =>
            routePool.any(route.query(ctx.query as unknown as Params)),
          );
          // console.log('Response', result);

          ctx.response.body = result;
        } catch (e) {
          console.log(e);
          ctx.response.status = 500;
        }
      });
    }
  });

  process.on('exit', async () => {
    console.log('Ending pool ' + endpoint + '...');
    await pool.end();
    console.log('Ended pool ' + endpoint);
  });

  index.use('/' + endpoints[i], router.routes(), router.allowedMethods());
});

index.get('/status', async (ctx, next) => {
  try {
    const queries = await Promise.all(
      pools.map((pool) => pool.one(sql`select 1 as result`)),
    );
    const ok = queries.every((query) => query.result === 1);
    if (ok) {
      ctx.status = 200;
      ctx.response.body = 'ok';
      await next();
      return;
    }
  } catch (e) {}

  ctx.status = 500;
  ctx.response.body = 'not ok';
  await next();
  return;
});

const draw = require('./image');

index.get('/card/:accountId/card.png', async (ctx, next) => {
  ctx.set('content-type', 'image/png');
  try {
    ctx.body = (
      await draw(ctx.params.accountId, pools[0], cachePool)
    ).toBuffer();
  } catch (e) {
    console.log(e);
    ctx.status = 500;
  }
  await next();
});

const cronsList = initCrons({
  environment: process.env as Record<string, string>,
  cachePool,
  indexerPool,
});

cronsList.forEach((cron) => {
  if (cron.isEnabled) {
    schedule(cron.schedule, async () => {
      try {
        await cron.run();
      } catch (error) {
        console.log(`error in running cron ${cron.cronName}`, error);
      }
    });
  }
});

app.use(index.routes()).use(index.allowedMethods());

console.log('Waiting for requests...');