import net from 'node:net';
import tls from 'node:tls';

/** Nodemailer's SMTPTransport.close() does not destroy its active socket.
 * Own that socket and await sendMail settlement after destroying it. No race
 * leaves a background SMTP attempt alive after this operation returns. */
export async function boundedSmtpSend(transporter: any, content: any,
  config: { host: string; port: number; secure: boolean }, timeoutMs: number) {
  let socket: net.Socket | undefined, expired = false;
  const failure = new Error('SMTP attempt deadline reached; acceptance may be ambiguous');
  transporter.getSocket = (_options: unknown, callback: (error: Error | null, result?: unknown) => void) => {
    if (expired) { callback(failure); return; }
    let settled = false;
    const finish = (error: Error | null) => {
      if (settled) return;
      settled = true;
      callback(error, error ? undefined : { connection: socket });
    };
    socket = config.secure
      ? tls.connect({ host: config.host, port: config.port, servername: config.host, minVersion: 'TLSv1.2', rejectUnauthorized: false }, () => finish(null))
      : net.connect({ host: config.host, port: config.port }, () => finish(null));
    socket.once('error', error => finish(error));
  };
  const timer = setTimeout(() => { expired = true; socket?.destroy(failure); }, timeoutMs);
  try { return await transporter.sendMail(content); }
  finally { clearTimeout(timer); socket?.destroy(); }
}
