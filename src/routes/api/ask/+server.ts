import { error, json, text } from '@sveltejs/kit';
import { app } from '$lib/server/app';
import { toCard } from '$lib/server/cards';
import type { AskTurn } from '$lib/server/librarian';
import type { RequestHandler } from './$types';

/**
 * Ask the librarian: { question, history? } as JSON, or the question as plain text (the iPhone Shortcut).
 * `?format=text` answers with the sentence alone, ready for Speak Text; item numbers are dropped from it.
 */
export const POST: RequestHandler = async ({ request, url, locals }) => {
  const type = request.headers.get('content-type') ?? '';
  let question = '';
  let history: AskTurn[] = [];
  if (type.includes('application/json')) {
    const body = (await request.json().catch(() => ({}))) as { question?: unknown; history?: unknown };
    question = typeof body.question === 'string' ? body.question : '';
    if (Array.isArray(body.history)) {
      history = body.history
        .filter((t): t is AskTurn => !!t && (t.role === 'user' || t.role === 'assistant') && typeof t.text === 'string')
        .slice(-6);
    }
  } else {
    question = await request.text();
  }
  if (!question.trim()) error(400, 'Ask a question.');

  const { drawer, librarian } = app();
  let result;
  try {
    result = await librarian.ask(question, history, locals.device);
  } catch (cause) {
    console.error('[drawer] ask', cause);
    error(502, 'The librarian could not answer just now. Search still works.');
  }
  if (url.searchParams.get('format') === 'text') {
    return text(result.answer.replace(/\s*\[#\d+\]/g, '').replace(/\s*#\d+\b/g, ''));
  }
  const cards = result.ids.map((id) => drawer.get(id)).filter((i) => i !== null).map(toCard);
  return json({ answer: result.answer, mode: result.mode, cards, sent: result.sent });
};
