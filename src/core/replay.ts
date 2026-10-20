import type { Fetch } from './github.ts';

/** One recorded GitHub answer: the status and the body, JSON or text. */
export type Recorded = { status: number; body: unknown };

/** Recorded answers by request URL. */
export type Recording = Record<string, Recorded>;

/**
 * A fetch that answers from a recording. Any other URL goes to `fallback`,
 * or fails, so a replay never reaches the network by accident.
 */
export function replay(recording: Recording, fallback?: Fetch): Fetch {
  return async (url, init) => {
    if (Object.hasOwn(recording, url)) {
      const { status, body } = recording[url];
      return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
    }
    if (fallback) return fallback(url, init);
    throw new Error(`not recorded: ${url}`);
  };
}
