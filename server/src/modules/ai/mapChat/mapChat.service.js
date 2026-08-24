import { ApiError } from '../../../core/utils/ApiError.js';
import { MapChat } from './mapChat.model.js';
import { askMap } from '../analysis/askMap.service.js';

/**
 * Ask-the-Map conversations: create, continue, list, read, delete.
 *
 * The continuation path is the point of the file. `askMap` is stateless; this
 * wraps it with the thread's own history so a follow-up is answered IN
 * CONTEXT — and the history handed over includes each earlier answer's
 * findings, so a fact this thread already researched (a competitor's name and
 * location, a rent figure) is reused from the record instead of being
 * searched for again. Same strategy the large assistants use: the saved
 * conversation IS the cheap memory; the provider is only asked for what is
 * genuinely new.
 */

/** A thread is a working context, not an archive — cap it before it bloats prompts. */
const MAX_MESSAGES = 40;
/** How much of the tail the provider sees. Older turns exist for the reader, not the prompt. */
const HISTORY_TURNS = 12;

const ownChat = async (id, userId) => {
  const chat = await MapChat.findOne({ _id: id, user: userId, deletedAt: null });
  if (!chat) throw ApiError.notFound('Conversation not found');
  return chat;
};

/** The prompt-facing view of the recent thread, findings folded in as facts. */
function historyFor(chat) {
  return chat.messages.slice(-HISTORY_TURNS).map((m) => ({
    role: m.role,
    text: m.text,
    ...(m.role === 'assistant' && m.findings?.length
      ? {
        established_facts: m.findings.map((f) => ({
          name: f.name, kind: f.kind, city: f.city, detail: f.detail,
          ...(Number.isFinite(f.lat) ? { lat: f.lat, lng: f.lng, approx: f.approx } : {}),
        })),
      }
      : {}),
  }));
}

/** Run one question inside a chat and append both sides of the exchange. */
async function exchange(chat, question, focus) {
  const out = await askMap({ question, focus, history: historyFor(chat) });
  chat.messages.push({ role: 'user', text: question });
  chat.messages.push({
    role: 'assistant',
    text: out.answer,
    confidence: out.confidence,
    caveat: out.caveat || undefined,
    findings: out.findings || [],
  });
  // Oldest turns fall off in pairs so the thread never truncates mid-exchange.
  while (chat.messages.length > MAX_MESSAGES) chat.messages.splice(0, 2);
  await chat.save();
  return chat;
}

export const mapChatService = {
  /** New conversation from its first question. */
  async create({ question, focus }, user) {
    const chat = new MapChat({
      user: user._id,
      title: question.length > 90 ? `${question.slice(0, 90)}…` : question,
      messages: [],
    });
    return exchange(chat, question, focus);
  },

  /** Follow-up inside an existing conversation. */
  async continue_({ id, question, focus }, user) {
    const chat = await ownChat(id, user._id);
    return exchange(chat, question, focus);
  },

  /** The person's own conversations, newest first — list rows only. */
  async list(user) {
    const rows = await MapChat.find({ user: user._id, deletedAt: null })
      .select('title updatedAt messages')
      .sort({ updatedAt: -1 })
      .limit(50)
      .lean();
    return rows.map((r) => ({
      _id: r._id,
      title: r.title,
      updatedAt: r.updatedAt,
      messageCount: r.messages?.length || 0,
    }));
  },

  /** One conversation, whole. */
  async get(id, user) {
    return (await ownChat(id, user._id)).toObject();
  },

  async remove(id, user) {
    const chat = await ownChat(id, user._id);
    chat.deletedAt = new Date();
    await chat.save();
    return { ok: true };
  },
};

export default mapChatService;
