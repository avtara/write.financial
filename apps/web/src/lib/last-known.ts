// SPDX-License-Identifier: AGPL-3.0-only
/**
 * FR-D4 offline: the root route asks the server who is signed in on every client navigation. Without a connection the
 * request fails before reaching the server (`TypeError` from `fetch`); the last answer of this tab is used instead, so
 * the page itself can say it is offline ("Lihat data terakhir"). Only the browser remembers: a server render never
 * shares an answer between requests. A server-rendered answer is handed over with {@link remember}.
 */
const answers = new Map<string, unknown>();

/** Keeps `answer` as the last one for `key` (in the browser). */
export function remember(key: string, answer: unknown): void {
  if (typeof window !== 'undefined') answers.set(key, answer);
}

export async function lastKnown<T>(key: string, load: () => Promise<T>): Promise<T> {
  if (typeof window === 'undefined') return load();
  try {
    const answer = await load();
    answers.set(key, answer);
    return answer;
  } catch (error) {
    if (error instanceof TypeError && answers.has(key)) return answers.get(key) as T;
    throw error;
  }
}
