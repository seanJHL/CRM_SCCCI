import DOMPurify from "dompurify";
import { useEffect, useRef, useState } from "react";

/** No visible text and nothing worth keeping (image/table/link/etc). */
function isEmptySpacer(el: Element): boolean {
  const text = (el.textContent ?? "").replace(/\s/g, "");
  if (text.length > 0) return false;
  return !el.querySelector("img, table, a, video, iframe");
}

function sanitizeEmailHtml(html: string): string {
  const clean = DOMPurify.sanitize(html, { WHOLE_DOCUMENT: false });
  const doc = new DOMParser().parseFromString(clean, "text/html");

  doc.querySelectorAll("a[href]").forEach((anchor) => {
    anchor.setAttribute("target", "_blank");
    anchor.setAttribute("rel", "noopener noreferrer");
  });

  // Newsletter/statement templates often pad vertical rhythm with empty
  // spacer paragraphs (`<p>&nbsp;</p>`) meant for email clients that ignore
  // CSS margins — collapse them so spacing matches the rest of the app
  // instead of stacking on top of the paragraph-margin rule below.
  doc.querySelectorAll("p, div").forEach((el) => {
    if (isEmptySpacer(el)) el.remove();
  });

  return doc.body.innerHTML;
}

function buildSrcDoc(sanitizedHtml: string): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<base target="_blank" />
<style>
  :root { color-scheme: light; }
  html, body { margin: 0; padding: 0; max-width: 100%; overflow-x: hidden; }
  body {
    padding: 14px;
    /* Gmail renders message HTML with its web-safe default (Arial) at the
       browser's base size, not the app's own UI typeface — matching that
       here (instead of the app's Inter/14px) is what makes an unstyled
       message look the same size as it does in Gmail itself. Senders that
       set their own font-family/font-size on elements still override this,
       same as in Gmail. */
    font-family: Arial, Helvetica, "Helvetica Neue", sans-serif;
    font-size: 16px;
    line-height: 1.5;
    color: #1c1c1e;
    background: #ffffff;
    word-wrap: break-word;
    overflow-wrap: break-word;
  }
  /* Email templates hard-code desktop-width pixel layouts (fixed-width
     "container" tables/divs, wide statement tables, unbreakable tracking
     links, nowrap cells) that assume a full-size mail client. Force every
     element to respect the iframe's own width so the message can never
     grow a horizontal scrollbar of its own — the outer app's overflow-x
     handling stops at the iframe boundary, since srcDoc content is a
     separate browsing context. */
  * {
    max-width: 100% !important;
    box-sizing: border-box !important;
    overflow-wrap: break-word;
    word-break: break-word;
    white-space: normal !important;
  }
  pre, code { white-space: pre-wrap !important; }
  /* Normalize vertical rhythm regardless of the sender's own inline
     margins/padding — !important beats inline styles that lack it, which
     is what lets this stay consistent across wildly different templates. */
  p, ul, ol, blockquote { margin: 0 0 12px !important; }
  p:last-child, ul:last-child, ol:last-child { margin-bottom: 0 !important; }
  img, table, video, iframe { max-width: 100% !important; height: auto; }
  /* table-layout:auto lets some engines size a table (and its columns) to
     content's preferred width before applying max-width, so a wide
     newsletter/statement table can still render past the container even
     with max-width:100% set. Forcing fixed layout at 100% makes the table
     itself the hard constraint columns wrap within, instead of a
     suggestion columns can exceed. */
  table { table-layout: fixed !important; width: 100% !important; }
  a { color: #2563eb; }
</style>
</head>
<body>${sanitizedHtml}</body>
</html>`;
}

/**
 * Renders a Gmail message body the way Gmail itself does: sanitized HTML in
 * an isolated, script-free iframe (no allow-scripts, so DOMPurify's <script>
 * stripping is backed by a real sandbox rather than trusted alone). Falls
 * back to plain text when the message has no text/html part.
 */
export function EmailBody({
  html,
  fallbackText,
}: {
  html: string | null;
  fallbackText: string;
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [srcDoc, setSrcDoc] = useState<string | null>(null);
  const [height, setHeight] = useState(120);

  useEffect(() => {
    if (!html) {
      setSrcDoc(null);
      return;
    }
    setSrcDoc(buildSrcDoc(sanitizeEmailHtml(html)));
  }, [html]);

  useEffect(() => {
    if (!srcDoc) return;
    const iframe = iframeRef.current;
    if (!iframe) return;

    let observer: ResizeObserver | undefined;
    const resize = () => {
      const contentDoc = iframe.contentDocument;
      if (contentDoc?.documentElement) {
        setHeight(contentDoc.documentElement.scrollHeight + 4);
      }
    };
    const handleLoad = () => {
      resize();
      const body = iframe.contentDocument?.body;
      if (body) {
        observer = new ResizeObserver(resize);
        observer.observe(body);
      }
    };

    iframe.addEventListener("load", handleLoad);
    return () => {
      iframe.removeEventListener("load", handleLoad);
      observer?.disconnect();
    };
  }, [srcDoc]);

  if (!srcDoc) {
    return (
      <p className="whitespace-pre-wrap break-words px-3.5 py-3 text-[14px] leading-6 text-[var(--m-text-2)]">
        {fallbackText}
      </p>
    );
  }

  return (
    <iframe
      ref={iframeRef}
      title="Email content"
      srcDoc={srcDoc}
      sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      className="block w-full border-0 bg-white"
      style={{ height }}
    />
  );
}
