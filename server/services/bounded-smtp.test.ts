import { describe, expect, it } from 'vitest';
import net from 'node:net';
import nodemailer from 'nodemailer';
import { boundedSmtpSend } from './bounded-smtp';
describe('actual SMTP connection cancellation', () => {
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
