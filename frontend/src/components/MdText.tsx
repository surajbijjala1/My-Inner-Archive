import type { JSX } from "react";

/**
 * The small amount of Markdown the models actually emit: paragraphs, bold,
 * italic, and the occasional heading. It carries no sizing of its own — the
 * surrounding page decides how its prose is set, so the same reply reads
 * correctly in the chat, a summary or a modal.
 */
export default function MdText({ text }: { text: string }) {
  return (
    <div className="md">
      {text.split(/\n\n+/).map((block, i) => {
        // A heading is one line. Models often run the body straight on after
        // it with a single newline, so the remainder stays a paragraph rather
        // than being swallowed into the heading.
        const heading = block.match(/^#{1,6}\s+([^\n]*)\n?([\s\S]*)$/);
        if (heading) {
          const body = heading[2].trim();
          return (
            <div key={i}>
              <p className="md-heading">{inline(heading[1].trim())}</p>
              {body && <p className="md-para">{inline(body)}</p>}
            </div>
          );
        }
        return (
          <p className="md-para" key={i}>
            {inline(block)}
          </p>
        );
      })}
    </div>
  );
}

/** Bold, italic, and hard line breaks within a block. */
function inline(text: string): (string | JSX.Element)[] {
  return text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/).map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("*") && part.endsWith("*")) {
      return <em key={i}>{part.slice(1, -1)}</em>;
    }
    return (
      <span key={i}>
        {part.split("\n").map((line, li, all) => (
          <span key={li}>
            {line}
            {li < all.length - 1 && <br />}
          </span>
        ))}
      </span>
    );
  });
}
