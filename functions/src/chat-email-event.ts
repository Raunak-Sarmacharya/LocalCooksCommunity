/** Event key routes to the matching Inngest environment. No email content or
 * recipient supplied by a client is carried across this boundary. */
export async function wakeStartingChatEmail(conversationId: string, messageId: string, senderId: number, eventKey?: string) {
  if (!eventKey) throw Error('Chat email Inngest event key is not configured');
  const response = await fetch(`https://inn.gs/e/${encodeURIComponent(eventKey)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(5000),
    body: JSON.stringify({ id: `chat-start:${conversationId}:${messageId}`, name: 'localcooks/chat.message.start',
      data: { conversationId, messageId, senderId } }),
  });
  if (!response.ok) throw Error('Starting chat email event was not accepted');
  const result = await response.json() as { status?: number; ids?: unknown };
  if (result.status !== 200 || !Array.isArray(result.ids) || !result.ids.length) throw Error('Starting chat email event was not accepted');
}
