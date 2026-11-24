// Optional real-model agent for the hosted playground ("bring your own key").
// Bundled by build-playground.js into dist/real-agent.js and loaded only when a
// visitor turns it on. The key lives in this module's memory: it is never
// stored and is sent only to the Anthropic API (or, for tests, to a localhost
// server named in the page URL; see backend.js).
import Anthropic from '@anthropic-ai/sdk';

export const MODEL = 'claude-opus-5-5';

// The prompts mirror the daemon's (packages/daemon/adapters.js), adapted to
// return text instead of editing a file on disk.
const editPrompt = (file, passage, comment) =>
  `You are copy-editing a markdown blog post (${file}). Rewrite ONLY the passage ` +
  `below as the reviewer asks. Keep its markdown structure (a list item stays a list ` +
  `item, a heading stays a heading). Reply with the rewritten passage and nothing ` +
  `else: no explanation, no quotes, no code fence.\n\n` +
  `Passage:\n"""\n${passage}\n"""\n\n` +
  `Reviewer: ${comment.body}` +
  (comment.thread.length ? `\n\nPrior discussion:\n${threadText(comment)}` : '');

const askPrompt = (file, passage, comment, post) =>
  `You are reviewing a markdown blog post (${file}). A reviewer is asking about one ` +
  `passage. Answer in plain prose, in at most four sentences. Do not rewrite the post.\n\n` +
  `The whole post, for context:\n"""\n${post}\n"""\n\n` +
  `Passage:\n"""\n${passage}\n"""\n\n` +
  `Conversation so far:\n${threadText(comment, true)}`;

function threadText(comment, includeBody = false) {
  const turns = comment.thread.map((t) => `${t.role === 'agent' ? 'You' : 'Reviewer'}: ${t.text}`);
  return [...(includeBody ? [`Reviewer: ${comment.body}`] : []), ...turns].join('\n');
}

// A short message for the rail; never echoes the key.
function explain(err) {
  if (err instanceof Anthropic.AuthenticationError) return 'the API key was rejected (401). Check it and try again.';
  if (err instanceof Anthropic.PermissionDeniedError) return 'this key is not allowed to use the model (403).';
  if (err instanceof Anthropic.RateLimitError) return 'rate limited by the API (429). Wait a moment and retry.';
  if (err instanceof Anthropic.APIConnectionError) return 'could not reach the Anthropic API. Check your connection.';
  if (err instanceof Anthropic.APIError) return `the API returned an error (${err.status ?? 'unknown'}).`;
  return err?.message || 'the request failed.';
}

export function createRealAgent({ apiKey, baseURL }) {
  const client = new Anthropic({
    apiKey,
    ...(baseURL ? { baseURL } : {}),
    // The visitor's own key, used from their own browser, by their choice.
    dangerouslyAllowBrowser: true,
    maxRetries: 1,
  });

  async function call(prompt) {
    let response;
    try {
      response = await client.beta.messages.create({
        model: MODEL,
        max_tokens: 2000,
        output_config: { effort: 'low' },
        // On a policy decline, the API re-runs the request on a fallback model.
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        messages: [{ role: 'user', content: prompt }],
      });
    } catch (err) {
      throw new Error(explain(err));
    }
    if (response.stop_reason === 'refusal') throw new Error('the model declined this request.');
    // A reply cut off by max_tokens is incomplete: never offer it as a rewrite.
    if (response.stop_reason === 'max_tokens')
      throw new Error('the reply was cut off before it finished. Try a shorter passage.');
    const text = response.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('')
      .trim();
    if (!text) throw new Error('the model returned no text.');
    return text;
  }

  return {
    model: MODEL,
    async edit({ file, passage, comment }) {
      const text = await call(editPrompt(file, passage, comment));
      // Models sometimes wrap a rewrite in a fence or quotes despite the prompt.
      return text.replace(/^```[a-z]*\n([\s\S]*?)\n```$/i, '$1').replace(/^"""\n?([\s\S]*?)\n?"""$/, '$1').trim();
    },
    async ask({ file, passage, comment, post }) {
      return call(askPrompt(file, passage, comment, post));
    },
  };
}
