import express, { Express } from 'express';
import cors from 'cors';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { WebSocketHub } from './ws/hub.js';
import { requestIdMiddleware } from './middleware/requestId.js';
import { errorHandler } from './middleware/errorHandler.js';
import { healthRouter } from './routes/health.js';
import { authRouter } from './routes/auth.js';
import { productsRouter } from './routes/products.js';
import { inventoryRouter } from './routes/inventory.js';
import { warehouseRouter } from './routes/warehouse.js';
import { receiptsRouter } from './routes/receipts.js';
import { placementRouter } from './routes/placement.js';
import { putawaysRouter } from './routes/putaways.js';
import { tasksRouter } from './routes/tasks.js';
import { ordersRouter } from './routes/orders.js';
import { missionsRouter } from './routes/missions.js';
import { pickStopsRouter } from './routes/picking.js';
import { exceptionsRouter } from './routes/exceptions.js';
import { packingRouter } from './routes/packing.js';
import { dashboardRouter } from './routes/dashboard.js';
import { usersRouter } from './routes/users.js';
import { configRouter } from './routes/config.js';

export function createApp(): Express {
  const app = express();

  app.use(requestIdMiddleware);
  app.use((req, res, next) => {
    const start = performance.now();
    const origSend = res.send;
    res.send = function (body?: any) {
      if (!res.headersSent) {
        const dur = (performance.now() - start).toFixed(1);
        res.setHeader('Server-Timing', `gw;dur=${dur}`);
      }
      return origSend.call(this, body);
    };
    next();
  });
  app.use(cors());
  app.use(express.json({ limit: '1mb' }));

  app.use(healthRouter);
  app.use(authRouter);
  app.use(productsRouter);
  app.use('/api/inventory', inventoryRouter);
  app.use('/api/warehouse', warehouseRouter);
  app.use('/api/receipts', receiptsRouter);
  app.use('/api/placement', placementRouter);
  app.use('/api/putaways', putawaysRouter);
  app.use('/api/tasks', tasksRouter);
  app.use('/api/orders', ordersRouter);
  app.use('/api/missions', missionsRouter);
  app.use('/api/pick-stops', pickStopsRouter);
  app.use('/api/exceptions', exceptionsRouter);
  app.use('/api/packing', packingRouter);
  app.use('/api', dashboardRouter);
  app.use('/api/users', usersRouter);
  app.use('/api/config', configRouter);


  // Unknown route handler
  app.use((req, res) => {
    res.status(404).json({
      error: {
        code: 'NOT_FOUND',
        message: `Route ${req.method} ${req.path} not found`,
        request_id: req.requestId
      }
    });
  });

  app.use(errorHandler);

  return app;
}

export function startGatewayServer(port: number = config.GATEWAY_PORT): {
  app: Express;
  server: http.Server;
  wsHub: WebSocketHub;
} {
  const app = createApp();
  const server = http.createServer(app);
  const wsHub = new WebSocketHub(server);

  return { app, server, wsHub };
}

const isMain = process.argv[1] && (
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) ||
  path.resolve(process.argv[1]).replace(/\\/g, '/').endsWith('services/gateway/src/server.ts') ||
  path.resolve(process.argv[1]).replace(/\\/g, '/').endsWith('src/server.ts')
);

if (isMain) {
  const { app, server, wsHub } = startGatewayServer(config.GATEWAY_PORT);
  server.listen(config.GATEWAY_PORT, () => {
    console.log(`Gateway listening on http://localhost:${config.GATEWAY_PORT}`);
  });

  const cleanup = () => {
    wsHub.stop().finally(() => {
      server.close(() => process.exit(0));
    });
  };

  process.on('SIGTERM', cleanup);
  process.on('SIGINT', cleanup);
}
