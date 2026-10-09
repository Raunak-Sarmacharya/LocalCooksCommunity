import net from 'node:net';
import tls from 'node:tls';

export class SmtpDeliveryError extends Error {
  constructor(public kind: 'acceptance_unknown' | 'smtp_rejected' | 'connection_failed') {
    super(kind === 'acceptance_unknown' ? 'SMTP acceptance is uncertain; reconcile before resending' : `SMTP delivery failed: ${kind}`);
  }
}
export class SmtpAcceptanceUnknown extends SmtpDeliveryError {
  constructor() { super('acceptance_unknown'); }
}

export function smtpFailureKind(error: unknown): 'acceptance_unknown' | 'smtp_rejected' | 'connection_failed' {
  const failure = error as { code?: string; responseCode?: number };
  if (error instanceof SmtpDeliveryError) return error.kind;
  if (failure?.responseCode && failure.responseCode >= 400 || failure?.code === 'EAUTH') return 'smtp_rejected';
  if (['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ENETUNREACH'].includes(failure?.code || '')) return 'connection_failed';
  // A socket error/timeout after DATA can mean the relay queued the message.
  return 'acceptance_unknown';
}

/** Nodemailer's SMTPTransport.close() does not destroy its active socket.
 * Own that socket and await sendMail settlement after destroying it. No race
 * leaves a background SMTP attempt alive after this operation returns. */
export async function boundedSmtpSend(transporter: any, content: any,
  config: { host: string; port: number; secure: boolean }, timeoutMs: number) {
  let socket: net.Socket | undefined, expired = false;
  const failure = new SmtpAcceptanceUnknown();
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
