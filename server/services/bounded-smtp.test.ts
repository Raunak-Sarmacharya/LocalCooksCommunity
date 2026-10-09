import { describe, expect, it } from 'vitest';
import net from 'node:net';
import nodemailer from 'nodemailer';
import { boundedSmtpSend, smtpFailureKind } from './bounded-smtp';
import { smtpAttemptMs } from './worker-context';
describe('actual SMTP connection cancellation', () => {
  it.each([false, true])('handles relay acceptance before a delayed acknowledgement (deadline expires: %s)', async expires => {
    const sockets = new Set<net.Socket>(), timers: ReturnType<typeof setTimeout>[] = [];
    let queued = 0;
    const server = net.createServer(socket => {
      sockets.add(socket); socket.on('close', () => sockets.delete(socket)); socket.write('220 fixture SMTP\r\n');
      let input = '', data = false;
      socket.on('data', chunk => {
        input += chunk.toString();
        for (;;) {
          if (data) {
            const end = input.indexOf('\r\n.\r\n'); if (end < 0) return;
            input = input.slice(end + 5); data = false; queued++;
            timers.push(setTimeout(() => { if (!socket.destroyed) socket.write('250 queued fixture\r\n'); }, expires ? 250 : 1800));
          } else {
            const end = input.indexOf('\r\n'); if (end < 0) return;
            const command = input.slice(0, end); input = input.slice(end + 2);
            if (/^DATA/i.test(command)) { data = true; socket.write('354 send message\r\n'); }
            else if (/^QUIT/i.test(command)) socket.end('221 bye\r\n');
            else socket.write('250 fixture\r\n');
          }
        }
      });
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const config = { host: '127.0.0.1', port: (server.address() as net.AddressInfo).port, secure: false };
    const transporter = nodemailer.createTransport({ ...config, ignoreTLS: true });
    try {
      const operation = boundedSmtpSend(transporter, { from: 'sender@example.test', to: 'recipient@example.test', text: 'Fixture' }, config, expires ? 100 : smtpAttemptMs);
      if (expires) {
        await expect(operation).rejects.toSatisfy(error => smtpFailureKind(error) === 'acceptance_unknown');
      } else expect((await operation).accepted).toEqual(['recipient@example.test']);
      expect(queued).toBe(1);
    } finally { timers.forEach(clearTimeout); sockets.forEach(socket => socket.destroy()); await new Promise<void>(resolve => server.close(() => resolve())); }
  });
  it('destroys a stalled local socket and awaits attempt settlement, even when the ordinary transport close is a no-op', async () => {
    const sockets = new Set<net.Socket>();
    const server = net.createServer(socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const config = { host: '127.0.0.1', port: (server.address() as net.AddressInfo).port, secure: false };
    const transporter = nodemailer.createTransport({ ...config, greetingTimeout: 10_000 });
    const started = performance.now();
    try {
      await expect(boundedSmtpSend(transporter, { from: 'sender@example.test', to: 'recipient@example.test', text: 'Local socket only' }, config, 100)).rejects.toThrow();
      expect(performance.now() - started).toBeLessThan(1_000);
      await new Promise(resolve => setTimeout(resolve, 25)); expect(sockets.size).toBe(0);
    } finally { sockets.forEach(socket => socket.destroy()); await new Promise<void>(resolve => server.close(() => resolve())); }
  });
});
