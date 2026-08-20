import type { UIMessage } from "ai";

// Why: extract plain text from the parts array. In v6 a UIMessage's content
// lives in typed parts (text, reasoning, tool-call, etc); we only render text.
function messageText(m: UIMessage): string {
  return m.parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("");
}

type Props = { message: UIMessage };

export function MessageBubble({ message }: Props) {
  const isUser = message.role === "user";
  const text = messageText(message);

  return (
    <div
      className={`flex ${
        isUser ? "justify-end" : "justify-start"
      }`}
    >
      <div
        className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-6 ${
          isUser
            ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900"
            : "border border-zinc-200 bg-white text-zinc-900 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100"
        }`}
      >
        {isUser ? (
          <p className="whitespace-pre-wrap">{text}</p>
        ) : (
          <AssistantText text={text} />
        )}
      </div>
    </div>
  );
}

// Why: the assistant's response is a stream of markdown-ish text. We parse it
// line-by-line so partial (streaming) text still renders correctly. We support
// two constructs:
//   - Blockquote citations: lines beginning with "> " become styled quote cards
//     with **bold** rendered inline (used for the document name in the citation)
//   - Bullet points: lines beginning with "- " become <li>
// Everything else is a plain paragraph. No external markdown lib — this keeps
// the streaming path simple and the bundle small.
function AssistantText({ text }: { text: string }) {
  const lines = text.split("\n");
  const nodes: React.ReactNode[] = [];
  let paragraph: string[] = [];
  let bullets: string[] = [];

  const flushParagraph = (key: string) => {
    if (paragraph.length === 0) return;
    nodes.push(
      <p key={key} className="whitespace-pre-wrap">
        {renderInline(paragraph.join("\n"))}
      </p>,
    );
    paragraph = [];
  };

  const flushBullets = (key: string) => {
    if (bullets.length === 0) return;
    nodes.push(
      <ul key={key} className="list-disc space-y-1 pl-5">
        {bullets.map((b, i) => (
          <li key={i}>{renderInline(b)}</li>
        ))}
      </ul>,
    );
    bullets = [];
  };

  lines.forEach((raw, i) => {
    const line = raw.trimEnd();
    if (line.startsWith("> ")) {
      flushParagraph(`p-${i}`);
      flushBullets(`u-${i}`);
      nodes.push(<Citation key={`q-${i}`} text={line.slice(2)} />);
    } else if (line.startsWith("- ")) {
      flushParagraph(`p-${i}`);
      bullets.push(line.slice(2));
    } else if (line === "") {
      flushParagraph(`p-${i}`);
      flushBullets(`u-${i}`);
    } else {
      flushBullets(`u-${i}`);
      paragraph.push(line);
    }
  });
  flushParagraph("p-end");
  flushBullets("u-end");

  return <div className="space-y-3">{nodes}</div>;
}

// Cited quote in the format: **Document Name** — the exact quoted text
function Citation({ text }: { text: string }) {
  return (
    <blockquote className="rounded-lg border-l-2 border-zinc-900 bg-zinc-50 px-3 py-2 text-xs italic leading-5 text-zinc-700 dark:border-white dark:bg-zinc-900 dark:text-zinc-300">
      {renderInline(text)}
    </blockquote>
  );
}

// Very small inline renderer for **bold** — sufficient for citation labels and
// occasional emphasis in the answer. Anything else renders as plain text.
function renderInline(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <strong key={i} className="font-semibold not-italic">
          {part.slice(2, -2)}
        </strong>
      );
    }
    return <span key={i}>{part}</span>;
  });
}
