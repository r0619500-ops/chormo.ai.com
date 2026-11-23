import React, { useState } from 'react';
import { Check, Copy } from 'lucide-react';

interface CodeBlockProps {
  language: string;
  code: string;
}

function CodeBlock({ language, code }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard may be unavailable in restricted contexts
    }
  };

  return (
    <div className="my-3 overflow-hidden rounded-xl border border-cyan-400/20 bg-[#040916]/95">
      <div className="flex items-center justify-between px-3.5 py-2 border-b border-cyan-400/15 bg-[#071124]/90 text-xs text-cyan-300/80">
        <span className="font-mono">{language || 'code'}</span>
        <button
          type="button"
          onClick={handleCopy}
          className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium text-slate-300 hover:text-cyan-200 hover:bg-cyan-400/10 transition-colors cursor-pointer"
        >
          {copied ? <Check className="w-3.5 h-3.5 text-cyan-300" /> : <Copy className="w-3.5 h-3.5" />}
          <span>{copied ? 'Copied' : 'Copy'}</span>
        </button>
      </div>
      <pre className="p-3.5 overflow-x-auto text-[13px] leading-relaxed font-mono text-sky-100">
        <code>{code}</code>
      </pre>
    </div>
  );
}

function isSafeUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const tokenRegex = /(`[^`\n]+`|\*\*[^*]+\*\*|\*[^*\n]+\*|\[[^\]]+\]\([^)\s]+\))/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let idx = 0;

  while ((match = tokenRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }

    const token = match[0];
    const key = `${keyPrefix}-${idx++}`;

    if (token.startsWith('`') && token.endsWith('`')) {
      nodes.push(
        <code
          key={key}
          className="font-mono text-[0.84em] px-1.5 py-0.5 rounded-md bg-cyan-400/10 border border-cyan-400/20 text-cyan-200"
        >
          {token.slice(1, -1)}
        </code>
      );
    } else if (token.startsWith('**') && token.endsWith('**')) {
      nodes.push(
        <strong key={key} className="font-semibold text-white">
          {renderInline(token.slice(2, -2), `${key}-b`)}
        </strong>
      );
    } else if (token.startsWith('*') && token.endsWith('*')) {
      nodes.push(
        <em key={key} className="italic text-sky-100">
          {renderInline(token.slice(1, -1), `${key}-i`)}
        </em>
      );
    } else if (token.startsWith('[')) {
      const linkMatch = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(token);
      if (linkMatch && isSafeUrl(linkMatch[2])) {
        nodes.push(
          <a
            key={key}
            href={linkMatch[2]}
            target="_blank"
            rel="noopener noreferrer"
            className="text-cyan-300 underline underline-offset-2 hover:text-cyan-200"
          >
            {linkMatch[1]}
          </a>
        );
      } else {
        nodes.push(token);
      }
    } else {
      nodes.push(token);
    }

    lastIndex = match.index + token.length;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes;
}

interface MarkdownRendererProps {
  content: string;
}

export function MarkdownRenderer({ content }: MarkdownRendererProps) {
  if (!content) return null;

  const segments: Array<{ type: 'text'; value: string } | { type: 'code'; lang: string; value: string }> = [];
  const fenceRegex = /```([a-zA-Z0-9_-]*)\n?([\s\S]*?)```/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = fenceRegex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: 'text', value: content.slice(lastIndex, match.index) });
    }
    segments.push({
      type: 'code',
      lang: match[1] || 'code',
      value: match[2].replace(/\n$/, ''),
    });
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < content.length) {
    segments.push({ type: 'text', value: content.slice(lastIndex) });
  }

  const elements: React.ReactNode[] = [];

  segments.forEach((segment, segIdx) => {
    if (segment.type === 'code') {
      elements.push(
        <CodeBlock key={`code-${segIdx}`} language={segment.lang} code={segment.value} />
      );
      return;
    }

    const lines = segment.value.split('\n');
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];
      const trimmed = line.trim();

      if (!trimmed) {
        i++;
        continue;
      }

      if (trimmed.startsWith('### ')) {
        elements.push(
          <h3 key={`h3-${segIdx}-${i}`} className="text-[15px] font-semibold mt-4 mb-1.5 text-sky-50">
            {renderInline(trimmed.slice(4), `h3-${segIdx}-${i}`)}
          </h3>
        );
        i++;
      } else if (trimmed.startsWith('## ')) {
        elements.push(
          <h2 key={`h2-${segIdx}-${i}`} className="text-base font-semibold mt-5 mb-2 text-white">
            {renderInline(trimmed.slice(3), `h2-${segIdx}-${i}`)}
          </h2>
        );
        i++;
      } else if (trimmed.startsWith('# ')) {
        elements.push(
          <h1 key={`h1-${segIdx}-${i}`} className="text-lg font-semibold mt-5 mb-2 text-white">
            {renderInline(trimmed.slice(2), `h1-${segIdx}-${i}`)}
          </h1>
        );
        i++;
      } else if (trimmed.startsWith('> ')) {
        const quoteLines: string[] = [];
        while (i < lines.length && lines[i].trim().startsWith('> ')) {
          quoteLines.push(lines[i].trim().slice(2));
          i++;
        }
        elements.push(
          <blockquote
            key={`bq-${segIdx}-${i}`}
            className="my-3 px-4 py-2.5 rounded-xl border border-cyan-400/20 bg-[#08152e]/55 text-sky-100/90 text-[14.5px]"
          >
            {quoteLines.map((qLine, qIdx) => (
              <p key={qIdx} className={qIdx > 0 ? 'mt-1.5' : ''}>
                {renderInline(qLine, `bq-${segIdx}-${i}-${qIdx}`)}
              </p>
            ))}
          </blockquote>
        );
      } else if (/^[-*]\s+/.test(trimmed)) {
        const items: string[] = [];
        while (i < lines.length && /^[-*]\s+/.test(lines[i].trim())) {
          items.push(lines[i].trim().replace(/^[-*]\s+/, ''));
          i++;
        }
        elements.push(
          <ul key={`ul-${segIdx}-${i}`} className="my-2.5 pl-5 list-disc space-y-1.5 text-slate-200 marker:text-cyan-400">
            {items.map((item, itemIdx) => (
              <li key={itemIdx} className="leading-relaxed">
                {renderInline(item, `ul-${segIdx}-${i}-${itemIdx}`)}
              </li>
            ))}
          </ul>
        );
      } else if (/^\d+\.\s+/.test(trimmed)) {
        const items: string[] = [];
        while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
          items.push(lines[i].trim().replace(/^\d+\.\s+/, ''));
          i++;
        }
        elements.push(
          <ol key={`ol-${segIdx}-${i}`} className="my-2.5 pl-5 list-decimal space-y-1.5 text-slate-200 marker:text-cyan-300">
            {items.map((item, itemIdx) => (
              <li key={itemIdx} className="leading-relaxed">
                {renderInline(item, `ol-${segIdx}-${i}-${itemIdx}`)}
              </li>
            ))}
          </ol>
        );
      } else {
        const paraLines: string[] = [];
        while (
          i < lines.length &&
          lines[i].trim() !== '' &&
          !lines[i].trim().startsWith('#') &&
          !lines[i].trim().startsWith('> ') &&
          !/^[-*]\s+/.test(lines[i].trim()) &&
          !/^\d+\.\s+/.test(lines[i].trim())
        ) {
          paraLines.push(lines[i]);
          i++;
        }
        elements.push(
          <p key={`p-${segIdx}-${i}`} className="mb-3 last:mb-0 leading-[1.68] text-slate-200">
            {paraLines.map((pLine, pIdx) => (
              <React.Fragment key={pIdx}>
                {pIdx > 0 && <br />}
                {renderInline(pLine, `p-${segIdx}-${i}-${pIdx}`)}
              </React.Fragment>
            ))}
          </p>
        );
      }
    }
  });

  return <div className="text-[15px]">{elements}</div>;
}
