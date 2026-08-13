import Fastify from 'fastify';
import cors from '@fastify/cors';
import staticPlugin from '@fastify/static';
import { homedir } from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { VPS_LINE_NODE_NAME } from './config.js';
import { db } from './db.js';
import servicesRoutes, { updateServiceStatus } from './routes/services.js';
import networkRoutes from './routes/network.js';
import { checkAllServices } from './checker.js';
import { probeAll } from './prober.js';
import { fastifyLoggerOptions } from './logger.js';
import { clashVergeConfigPath } from './routes/clash-status.js';
import { createVpsLineMonitor } from './vps-line/monitor.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const fastify = Fastify({
  logger: fastifyLoggerOptions,
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
    fastify.log.info({
      code: 'SERVICE_CHECKS_COMPLETED',
      serviceCount: statuses.length,
    }, 'Service checks completed');
  } catch (err) {
    fastify.log.error({ code: 'SERVICE_CHECKS_FAILED', err }, 'Service checks failed');
  }
}

async function runNetworkProbes() {
  try {
    await probeAll();
    fastify.log.info({ code: 'NETWORK_PROBES_COMPLETED' }, 'Network probes completed');
  } catch (err) {
    fastify.log.error({ code: 'NETWORK_PROBES_FAILED', err }, 'Network probes failed');
  }
}

// Run immediately on startup
void runServiceChecks();
void runNetworkProbes();

// Check services every 30 seconds
const serviceCheckInterval = setInterval(() => void runServiceChecks(), 30_000);

// Background network probe: every 1 minute
// (foreground fast-probe is triggered by the client via POST /api/network/probe)
const networkProbeInterval = setInterval(() => void runNetworkProbes(), 60_000);

const vpsLineMonitor = createVpsLineMonitor({
  configuredNodeName: VPS_LINE_NODE_NAME,
  configPath: clashVergeConfigPath(homedir()),
  logger: fastify.log,
});

// Start server
try {
  await vpsLineMonitor.start();
  const port = parseInt(process.env.PORT ?? '9000');
  await fastify.listen({ port, host: '0.0.0.0' });
  fastify.log.info({ code: 'CONTROL_CENTER_STARTED', port }, 'Control Center server started');
} catch (err) {
  fastify.log.error({ code: 'CONTROL_CENTER_START_FAILED', err }, 'Control Center server failed to start');
  vpsLineMonitor.stop();
  clearInterval(serviceCheckInterval);
  clearInterval(networkProbeInterval);
  try {
    db.close();
  } catch {
    // The process is already terminating after a startup failure.
  }
  process.exit(1);
}

// Graceful shutdown
let shuttingDown = false;

async function shutdown(signal: 'SIGINT' | 'SIGTERM'): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  fastify.log.info({ code: 'CONTROL_CENTER_SHUTDOWN_STARTED', signal }, 'Control Center shutdown started');
  vpsLineMonitor.stop();
  clearInterval(serviceCheckInterval);
  clearInterval(networkProbeInterval);
  try {
    await fastify.close();
    db.close();
    fastify.log.info({ code: 'CONTROL_CENTER_SHUTDOWN_COMPLETED', signal }, 'Control Center shutdown completed');
    process.exit(0);
  } catch (err) {
    fastify.log.error({ code: 'CONTROL_CENTER_SHUTDOWN_FAILED', signal, err }, 'Control Center shutdown failed');
    try {
      db.close();
    } catch {
      // Preserve the original structured shutdown failure.
    }
    process.exit(1);
  }
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
