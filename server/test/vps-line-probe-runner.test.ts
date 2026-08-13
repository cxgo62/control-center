import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import {
  createProbeSample,
  parsePingOutput,
  runIcmpProbe,
  runProbeRound,
  runTcpProbe,
  type PingProcess,
  type TcpProbeSocket,
} from '../src/vps-line/probe-runner.js';

class FakePingProcess extends EventEmitter implements PingProcess {
  stdout = new EventEmitter();
  killed = false;

  kill(): boolean {
    this.killed = true;
    return true;
  }
}

class FakeSocket extends EventEmitter implements TcpProbeSocket {
  destroyed = false;
  configuredTimeout: number | undefined;

  setTimeout(timeoutMs: number): this {
    this.configuredTimeout = timeoutMs;
    return this;
  }

  destroy(): this {
    this.destroyed = true;
    return this;
  }
}

test('parses current macOS ping replies and packet summary', () => {
  const result = parsePingOutput(`
PING example.com (192.0.2.1): 56 data bytes
64 bytes from 192.0.2.1: icmp_seq=0 ttl=51 time=12.500 ms
64 bytes from 192.0.2.1: icmp_seq=1 ttl=51 time=10.250 ms

--- example.com ping statistics ---
10 packets transmitted, 2 packets received, 80.0% packet loss
round-trip min/avg/max/stddev = 10.250/11.375/12.500/1.125 ms
`);

  assert.deepEqual(result, { sent: 10, received: 2, rtts: [12.5, 10.25], usable: true });
});

test('parses reasonable Linux and Windows-style packet summaries', () => {
  assert.deepEqual(parsePingOutput('10 packets transmitted, 7 received, 30% packet loss\n'), {
    sent: 10, received: 7, rtts: [], usable: false,
  });
  assert.deepEqual(parsePingOutput('Packets: Sent = 10, Received = 8, Lost = 2 (20% loss),\n'), {
    sent: 10, received: 8, rtts: [], usable: false,
  });
});

test('falls back safely for no summary and all-loss output', () => {
  assert.deepEqual(parsePingOutput('reply icmp_seq=0 time=20 ms\nreply icmp_seq=1 time<1 ms\n'), {
    sent: 10, received: 2, rtts: [20, 1], usable: true,
  });
  assert.deepEqual(parsePingOutput('10 packets transmitted, 0 packets received, 100.0% packet loss\n'), {
    sent: 10, received: 0, rtts: [], usable: false,
  });
  assert.deepEqual(parsePingOutput('unrecognized output'), {
    sent: 10, received: 0, rtts: [], usable: false,
  });
});

test('spawns a fixed ping command without a shell and keeps a hostile host in one argument', async () => {
  const child = new FakePingProcess();
  const calls: Array<{ command: string; args: string[]; options: { shell: false } }> = [];
  const host = 'host.example.com; $(touch /tmp/must-not-run)';
  const resultPromise = runIcmpProbe(host, {
    timeoutMs: 100,
    spawn: (command, args, options) => {
      calls.push({ command, args, options });
      queueMicrotask(() => {
        child.stdout.emit('data', Buffer.from('64 bytes from host: icmp_seq=0 ttl=50 time=9.5 ms\n'));
        child.emit('close', 0, null);
      });
      return child;
    },
  });

  assert.deepEqual(await resultPromise, {
    sent: 10, received: 1, rtts: [9.5], usable: true, timedOut: false,
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, '/sbin/ping');
  assert.deepEqual(calls[0].args, ['-c', '10', '-W', '2000', host]);
  assert.equal(calls[0].args.filter(argument => argument === host).length, 1);
  assert.equal(calls[0].options.shell, false);
});

test('terminates an overdue ping and resolves a sanitized timeout result', async () => {
  const child = new FakePingProcess();
  const result = await runIcmpProbe('private.example.com', {
    timeoutMs: 5,
    spawn: () => child,
  });

  assert.deepEqual(result, {
    sent: 10, received: 0, rtts: [], usable: false, timedOut: true,
  });
  assert.equal(child.killed, true);
  assert.equal(child.listenerCount('close'), 0);
  assert.equal(child.listenerCount('error'), 0);
  assert.equal(child.stdout.listenerCount('data'), 0);
  assert.equal(JSON.stringify(result).includes('private.example.com'), false);
});

test('maps ping spawn failures to a safe result rather than throwing endpoint details', async () => {
  const result = await runIcmpProbe('secret-endpoint.example.com', {
    spawn: () => { throw new Error('cannot spawn for secret-endpoint.example.com'); },
  });
  assert.deepEqual(result, {
    sent: 10, received: 0, rtts: [], usable: false, timedOut: false,
  });
  assert.equal(JSON.stringify(result).includes('secret-endpoint'), false);
});

test('TCP probe reports a connection and completely cleans up the socket', async () => {
  const socket = new FakeSocket();
  let receivedOptions: { host: string; port: number } | undefined;
  const connected = await runTcpProbe('private.example.com', 8443, {
    timeoutMs: 100,
    connect: options => {
      receivedOptions = options;
      queueMicrotask(() => socket.emit('connect'));
      return socket;
    },
  });

  assert.equal(connected, true);
  assert.deepEqual(receivedOptions, { host: 'private.example.com', port: 8443 });
  assert.equal(socket.configuredTimeout, 100);
  assert.equal(socket.destroyed, true);
  assert.equal(socket.eventNames().length, 0);
});

test('TCP probe has a finite timeout and cleans up a silent socket', async () => {
  const socket = new FakeSocket();
  const connected = await runTcpProbe('private.example.com', 8443, {
    timeoutMs: 5,
    connect: () => socket,
  });

  assert.equal(connected, false);
  assert.equal(socket.destroyed, true);
  assert.equal(socket.eventNames().length, 0);
});

test('TCP probe maps socket errors and adapter throws to false', async () => {
  const socket = new FakeSocket();
  const failed = runTcpProbe('private.example.com', 8443, {
    timeoutMs: 100,
    connect: () => {
      queueMicrotask(() => socket.emit('error', new Error('raw private endpoint detail')));
      return socket;
    },
  });
  assert.equal(await failed, false);
  assert.equal(socket.destroyed, true);
  assert.equal(await runTcpProbe('private.example.com', 8443, {
    connect: () => { throw new Error('raw private endpoint detail'); },
  }), false);
});

test('pure sample creation computes identity, timestamp, latency percentiles, jitter, and states', () => {
  assert.deepEqual(createProbeSample({
    probedAt: 1_725_000_000_000,
    nodeName: 'stable-private-node',
    icmp: { sent: 10, received: 4, rtts: [10, 20, 30, 100], usable: true, timedOut: false },
    tcpConnected: false,
  }), {
    probedAt: 1_725_000_000_000,
    nodeName: 'stable-private-node',
    sent: 10,
    received: 4,
    medianLatencyMs: 25,
    p95LatencyMs: 100,
    jitterMs: 30,
    tcpState: 'down',
    icmpUsable: true,
  });

  assert.deepEqual(createProbeSample({
    probedAt: 2,
    nodeName: 'stable-private-node',
    icmp: { sent: 10, received: 0, rtts: [], usable: false, timedOut: true },
    tcpConnected: true,
  }), {
    probedAt: 2,
    nodeName: 'stable-private-node',
    sent: 10,
    received: 0,
    medianLatencyMs: null,
    p95LatencyMs: null,
    jitterMs: null,
    tcpState: 'up',
    icmpUsable: false,
  });
});

test('a full probe round uses only injected adapters and does not retain the endpoint', async () => {
  const child = new FakePingProcess();
  const socket = new FakeSocket();
  const samplePromise = runProbeRound(
    { name: 'stable-private-node', host: 'secret.example.com', port: 9443 },
    {
      now: () => 1234,
      icmpTimeoutMs: 100,
      tcpTimeoutMs: 100,
      spawn: () => {
        queueMicrotask(() => {
          child.stdout.emit('data', '64 bytes from host: icmp_seq=0 time=50 ms\n');
          child.emit('close', 0, null);
        });
        return child;
      },
      connect: () => {
        queueMicrotask(() => socket.emit('connect'));
        return socket;
      },
    },
  );

  const sample = await samplePromise;
  assert.deepEqual(sample, {
    probedAt: 1234,
    nodeName: 'stable-private-node',
    sent: 10,
    received: 1,
    medianLatencyMs: 50,
    p95LatencyMs: 50,
    jitterMs: null,
    tcpState: 'up',
    icmpUsable: true,
  });
  assert.equal(JSON.stringify(sample).includes('secret.example.com'), false);
  assert.equal(JSON.stringify(sample).includes('9443'), false);
});
