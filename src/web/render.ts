// A SKILL.md body as HTML. The body is someone else's: raw HTML stays text, and only links that
// cannot run anything survive. spec/web.md.
import { Marked, type Tokens } from 'marked';

/** Where a relative link or image in the body points: the SKILL.md at the scanned commit. */
export type Base = { page: string; raw: string };

const SAFE = new Set(['http:', 'https:', 'mailto:']);

export function renderBody(markdown: string, base: Base): string {
  const marked = new Marked({
    gfm: true,
    renderer: {
      html: ({ text }: Tokens.HTML | Tokens.Tag) => escape(text),
      link(token: Tokens.Link) {
        const text = this.parser.parseInline(token.tokens);
        const href = resolve(token.href, base.page);
        if (!href) return text;
        const title = token.title ? ` title="${escape(token.title)}"` : '';
        return `<a href="${escape(href)}"${title} target="_blank" rel="noopener noreferrer">${text}</a>`;
      },
      image(token: Tokens.Image) {
        const src = resolve(token.href, base.raw);
        if (!src || src.startsWith('mailto:')) return escape(token.text);
        return `<img src="${escape(src)}" alt="${escape(token.text)}" loading="lazy">`;
      },
    },
  });
  return marked.parse(markdown, { async: false });
}

/** An absolute URL with a safe scheme, or undefined. */
function resolve(href: string, base: string): string | undefined {
  try {
    const url = new URL(href, base);
    return SAFE.has(url.protocol) ? url.href : undefined;
  } catch {
    return undefined;
  }
}

export function escape(text: string): string {
  return text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}
