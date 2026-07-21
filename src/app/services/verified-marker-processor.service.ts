import { Injectable } from '@angular/core';

export interface VerifiedMarker {
  placeholder: string; // e.g. [VERIFIED_0]
  tests: string[]; // <ShortClassName>.<MethodName> keys
}

/**
 * Turns inline `{verified: Class.Method, Class.Method2}` tokens into inert
 * `[VERIFIED_n]` placeholders. After the markdown renders, {@link MarkdownPage}
 * swaps each placeholder for a `wb-verified-badge` component. Because it emits a
 * plain-text placeholder (the same technique as `[CODE_BLOCK_n]`), the token
 * works **anywhere** markdown flows — paragraphs, table cells, list items, and
 * diagram caption lines — with a single mechanism.
 *
 * Convention: put a section/diagram marker on its own line (not inside a heading
 * line), so heading anchor slugs stay clean.
 */
@Injectable({ providedIn: 'root' })
export class VerifiedMarkerProcessor {
  private static readonly TOKEN = /\{verified:\s*([^}]+)\}/gi;

  process(content: string): { processedContent: string; markers: VerifiedMarker[] } {
    const markers: VerifiedMarker[] = [];
    let i = 0;
    const processedContent = content.replace(VerifiedMarkerProcessor.TOKEN, (_match, list: string) => {
      const tests = list
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (tests.length === 0) return _match; // leave malformed tokens untouched
      const placeholder = `[VERIFIED_${i++}]`;
      markers.push({ placeholder, tests });
      return placeholder;
    });
    return { processedContent, markers };
  }
}
