import { linkifyText } from "@/lib/ui/linkify";

/**
 * Guidance text with its https URLs tappable. Setup advice from the script
 * can name the exact Google console page that fixes a problem; the link
 * opens in a new tab and the rest of the text renders exactly as written.
 * `break-all` keeps a long console address inside the bubble instead of
 * widening it off-screen.
 */
export function LinkifiedText({ text }: { text: string }) {
  return (
    <>
      {linkifyText(text).map((segment, index) =>
        segment.href ? (
          <a
            key={index}
            href={segment.href}
            target="_blank"
            rel="noreferrer"
            className="break-all text-accent underline underline-offset-2"
          >
            {segment.text}
          </a>
        ) : (
          <span key={index}>{segment.text}</span>
        ),
      )}
    </>
  );
}
