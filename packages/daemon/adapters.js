import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

function threadText(comment) {
  if (!comment.thread?.length) return `Reviewer: ${comment.body}`;
  return comment.thread
    .map((t) => `${t.role === 'agent' ? 'You' : 'Reviewer'}: ${t.text}`)
    .join('\n');
}

function buildEditPrompt(file, comments) {
  const items = comments
    .map(
      (c, i) =>
        `Comment ${i + 1} targets this passage in ${file}:\n"""\n${c.selectedText || c.quotedText}\n"""\n` +
        `Instruction: ${c.body}` +
        (c.thread?.length ? `\nPrior discussion:\n${threadText(c)}` : '')
    )
    .join('\n\n');
  return (
    `You are copy-editing a markdown blog. Apply the review comments below by editing ` +
    `ONLY the referenced passages in ${file}. Preserve markdown structure. Change nothing else. ` +
    `Do not add explanations to the file.\n\n${items}`
  );
}

function buildAskPrompt(file, comment) {
  return (
    `You are reviewing a markdown blog. A reviewer is asking about a passage in ${file}. ` +
    `Answer concisely in plain prose. Do NOT edit any files.\n\n` +
    `Passage:\n"""\n${comment.selectedText || comment.quotedText}\n"""\n\n` +
    `Conversation so far:\n${threadText(comment)}`
  );
}

// Spawn the agent CLI and stream its output line by line. `parse` turns each raw
// line into { activity?, text?, final? }; activity + text are forwarded live via
// onEvent, and the resolved value is the agent's final answer text.
function runStream(cmd, args, cwd, onEvent, parse) {
  return new Promise((resolvePromise, reject) => {
    const proc = spawn(cmd, args, { cwd });
    let buf = '';
    let raw = '';
    let streamed = '';
    let final = null;
    let err = '';

    proc.stdout.on('data', (chunk) => {
      buf += chunk;
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (!line.trim()) continue;
        raw += `${line}\n`;
        const evt = parse(line);
        if (!evt) continue;
        if (evt.activity) onEvent({ kind: 'activity', text: evt.activity });
        if (evt.text) {
          streamed += evt.text;
          onEvent({ kind: 'text', text: evt.text });
        }
        if (evt.final != null) final = evt.final;
      }
    });
    proc.stderr.on('data', (d) => (err += d));
    proc.on('error', reject);
    proc.on('close', (code) =>
      code === 0
        ? resolvePromise((final ?? streamed ?? raw).trim())
        : reject(new Error(err.trim() || `${cmd} exited ${code}`))
    );
  });
}

const toolActivity = (b) => {
  const target = b.input?.file_path ? basename(b.input.file_path) : '';
  const verb = { Read: 'reading', Edit: 'editing', Write: 'writing', Grep: 'searching' }[b.name];
  return verb ? `${verb} ${target}`.trim() : `${b.name}`;
};

// claude -p --output-format stream-json emits one JSON event per line.
function parseClaude(line) {
  let o;
  try {
    o = JSON.parse(line);
  } catch {
    return null;
  }
  if (o.type === 'stream_event' && o.event?.type === 'content_block_delta') {
    if (o.event.delta?.type === 'text_delta') return { text: o.event.delta.text };
    return null;
  }
  if (o.type === 'assistant' && Array.isArray(o.message?.content)) {
    const tool = o.message.content.find((b) => b.type === 'tool_use');
    return tool ? { activity: toolActivity(tool) } : null;
  }
  if (o.type === 'result' && typeof o.result === 'string') return { final: o.result };
  return null;
}

// codex prints human logs; surface each line as raw activity (codex = raw view).
const parseCodexRaw = (line) => ({ activity: line.slice(0, 200) });

/** Deterministic, no-LLM adapter for tests; emits a couple of fake events. */
function mockAdapter() {
  return {
    async resolve(projectRoot, file, comments, onEvent = () => {}) {
      onEvent({ kind: 'activity', text: `editing ${file}` });
      const path = join(projectRoot, file);
      let src = await readFile(path, 'utf8');
      for (const c of [...comments].sort((a, b) => b.startOffset - a.startOffset)) {
        src = src.slice(0, c.startOffset) + src.slice(c.startOffset, c.endOffset).toUpperCase() + src.slice(c.endOffset);
      }
      await writeFile(path, src);
    },
    async ask(projectRoot, file, comment, onEvent = () => {}) {
      onEvent({ kind: 'activity', text: `reading ${file}` });
      const last = comment.thread?.at(-1)?.text ?? comment.body;
      const answer = `Re "${(comment.selectedText || comment.quotedText).slice(0, 40)}": ${last} (mock answer)`;
      onEvent({ kind: 'text', text: answer });
      return answer;
    },
  };
}

function cliAdapter(cmd, editArgs, askArgs, parse) {
  return {
    resolve(projectRoot, file, comments, onEvent = () => {}) {
      return runStream(cmd, editArgs(buildEditPrompt(file, comments)), projectRoot, onEvent, parse);
    },
    ask(projectRoot, file, comment, onEvent = () => {}) {
      return runStream(cmd, askArgs(buildAskPrompt(file, comment)), projectRoot, onEvent, parse);
    },
  };
}

// Ask/Reply default to a small fast model since they only answer; Resolve keeps
// the agent's default strong model for edits. Both are overridable via config.
export function makeAdapter(name, { askModel, resolveModel } = {}) {
  switch (name) {
    case 'mock':
      return mockAdapter();
    case 'claude': {
      const model = (flag) => (flag ? ['--model', flag] : []);
      const stream = ['--output-format', 'stream-json', '--verbose', '--include-partial-messages'];
      return cliAdapter(
        'claude',
        (p) => ['-p', p, '--permission-mode', 'acceptEdits', ...model(resolveModel), ...stream],
        (p) => ['-p', p, ...model(askModel || 'haiku'), ...stream],
        parseClaude
      );
    }
    case 'codex': {
      const model = (flag) => (flag ? ['-m', flag] : []);
      return cliAdapter(
        'codex',
        (p) => ['exec', '--sandbox', 'workspace-write', '--skip-git-repo-check', ...model(resolveModel), p],
        (p) => ['exec', '--sandbox', 'read-only', '--skip-git-repo-check', ...model(askModel), p],
        parseCodexRaw
      );
    }
    default:
      throw new Error(`unknown agent: ${name}`);
  }
}
