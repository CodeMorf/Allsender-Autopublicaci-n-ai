import { db } from '@/lib/db/drizzle';
import { messages, chats } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { pusherServer } from '@/lib/pusher-server';

/**
 * Mensaje de sistema INTERNO.
 * - No actualiza lastMessage del chat (no contamina el preview del inbox).
 * - No dispara chat-list-update al equipo (evita flash de 10-50s en agentes no asignados).
 * - Solo guarda en DB; el chat abierto puede recargar mensajes por su propio canal.
 */
export async function createSystemMessage(
  teamId: number,
  chatId: number,
  text: string,
  options?: { broadcastList?: boolean; updateLastMessage?: boolean }
) {
  const messageId = `system_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  const timestamp = new Date();
  const broadcastList = options?.broadcastList === true;
  const updateLastMessage = options?.updateLastMessage === true;

  const [newMessage] = await db.insert(messages).values({
    id: messageId,
    chatId,
    fromMe: true,
    messageType: 'system',
    text,
    timestamp,
    status: 'read',
    isInternal: true,
  }).returning();

  const chat = await db.query.chats.findFirst({
    where: eq(chats.id, chatId),
    columns: { remoteJid: true, instanceId: true }
  });

  if (chat) {
    if (updateLastMessage) {
      await db.update(chats).set({
        lastMessageText: text,
        lastMessageTimestamp: timestamp,
      }).where(eq(chats.id, chatId));
    }

    const channelName = `team-${teamId}`;

    // Solo mensaje en hilo (si alguien tiene el chat abierto y escucha new-message)
    try {
      await pusherServer.trigger(channelName, 'new-message', {
        ...newMessage,
        timestamp: timestamp.toISOString(),
        remoteJid: chat.remoteJid,
        isInternal: true,
        messageType: 'system',
      });
    } catch {
      // ignore
    }

    // Nunca notificar lista a todo el equipo salvo force explícito
    if (broadcastList) {
      try {
        await pusherServer.trigger(channelName, 'chat-list-update', {
          id: chatId,
          lastMessageText: text,
          lastMessageTimestamp: timestamp.toISOString(),
          remoteJid: chat.remoteJid,
          unreadCount: 0,
          lastMessageFromMe: true,
          isInternal: true,
        });
      } catch {
        // ignore
      }
    }
  }

  return newMessage;
}
