import Fastify from 'fastify';
import cors from '@fastify/cors';
import staticPlugin from '@fastify/static';
import path from 'path';
import { fileURLToPath } from 'url';
import { db } from './db.js';
import servicesRoutes, { updateServiceStatus } from './routes/services.js';
import networkRoutes from './routes/network.js';
import { checkAllServices } from './checker.js';
import { probeAll } from './prober.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const fastify = Fastify({
  logger: {
    level: 'info',
  },
});

// Register CORS (allow all in dev)
await fastify.register(cors, {
  origin: true,
});

// Register route plugins
await fastify.register(servicesRoutes);
await fastify.register(networkRoutes);

// In production, serve the client build
if (process.env.NODE_ENV === 'production') {
  const clientDist = path.join(__dirname, '../../client/dist');
  await fastify.register(staticPlugin, {
    root: clientDist,
    prefix: '/',
  });

  // SPA fallback — serve index.html for non-API routes
  fastify.setNotFoundHandler((_request, reply) => {
    return reply.sendFile('index.html');
  });
}

// ---- Scheduler ----

async function runServiceChecks() {
  try {
    const statuses = await checkAllServices();
    updateServiceStatus(statuses);
    fastify.log.info(`Checked ${statuses.length} services`);
  } catch (err) {
    fastify.log.error(err, 'Service check failed');
  }
}

async function runNetworkProbes() {
  try {
    await probeAll();
    fastify.log.info('Network probes complete');
  } catch (err) {
    fastify.log.error(err, 'Network probe failed');
  }
}

// Run immediately on startup
runServiceChecks();
runNetworkProbes();

// Check services every 30 seconds
setInterval(runServiceChecks, 30_000);

// Background network probe: every 1 minute
// (foreground fast-probe is triggered by the client via POST /api/network/probe)
setInterval(runNetworkProbes, 60_000);

// Start server
try {
  const port = parseInt(process.env.PORT ?? '9000');
  await fastify.listen({ port, host: '0.0.0.0' });
  fastify.log.info(`Control Center server running on http://localhost:${port}`);
} catch (err) {
  fastify.log.error(err);
  db.close();
  process.exit(1);
}

// Graceful shutdown
process.on('SIGINT', () => {
  fastify.close(() => {
    db.close();
    process.exit(0);
  });
});

process.on('SIGTERM', () => {
  fastify.close(() => {
    db.close();
    process.exit(0);
  });
});
