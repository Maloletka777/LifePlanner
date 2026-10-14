export interface PlannerRevisionRequestCoalescer<T> {
  request(input: Readonly<{
    revision: number;
    key: string;
    load: () => Promise<T>;
  }>): Promise<T>;
  /** Narrow what the next revision drops. See the implementation for why it is one-shot. */
  dropOnly(match: (key: string) => boolean): void;
  /**
   * What is already known, **without promising anything**.
   *
   * A promise cannot be read during a render, and a value that only arrives on the next
   * microtask is a frame of empty page however warm the store is. This is what lets a day
   * that has already been read be shown in the first render that asks for it. It never
   * starts a load and it never waits: unknown is `undefined`.
   */
  peek(input: Readonly<{ revision: number; key: string }>): T | undefined;
}

/**
 * **Retention is opt-in, and the default is still «never reuse settled work».**
 *
 * That default is a freshness guarantee somebody wrote a test for, and it is not reversed
 * here: without `retain` this is exactly the coalescer it was. What `retain` adds is a
 * bounded, most-recently-used store of results **for the active revision only** — and the
 * revision is a complete invalidation boundary, because every tick of a checkbox bumps it
 * and the map is cleared whole (`planner-provider.tsx`, `refreshOccurrences`).
 *
 * Without it a prefetch is pointless: the entry was deleted the instant its promise
 * settled, so warming a day cost a query and kept nothing.
 *
 * `retainWhen` decides what is worth keeping, because these loaders **resolve** with a
 * failure rather than rejecting — a rejected promise is always dropped, but a `Result`
 * carrying an error would otherwise be cached as though it were an answer.
 */
export function createPlannerRevisionRequestCoalescer<T>(options?: Readonly<{
  readonly retain?: number;
  readonly retainWhen?: (value: T) => boolean;
}>): PlannerRevisionRequestCoalescer<T> {
  const retain = Math.max(0, options?.retain ?? 0);
  const retainWhen = options?.retainWhen ?? (() => true);
  let activeRevision = -1;
  /**
   * What the next revision is allowed to keep.
   *
   * A revision bump means «something changed», and until now it meant «everything might
   * have» — the whole store went. That is right for a habit being created, edited or
   * deleted, whose schedule can touch any day at all. It is badly wrong for ticking a
   * checkbox, which changes exactly one day and threw away the other fifteen: coming back
   * to a day looked at a moment ago read it from disk again.
   *
   * A caller that knows the blast radius says so before bumping; a caller that does not
   * says nothing and gets the old, safe behaviour.
   */
  let keepUnless: ((key: string) => boolean) | null = null;
  /** One entry per key: the request, and its answer once there is one. */
  const requests = new Map<string, { readonly pending: Promise<T>; settled?: T }>();
  return Object.freeze({
    request({ revision, key, load }: Readonly<{
      revision: number;
      key: string;
      load: () => Promise<T>;
    }>): Promise<T> {
      if (revision !== activeRevision) {
        activeRevision = revision;
        if (keepUnless === null) requests.clear();
        else {
          for (const held of [...requests.keys()]) if (keepUnless(held)) requests.delete(held);
          keepUnless = null;
        }
      }
      const existing = requests.get(key);
      if (existing !== undefined) {
        // Touched, so the day being looked at is never the one evicted.
        if (retain > 0) {
          requests.delete(key);
          requests.set(key, existing);
        }
        return existing.pending;
      }
      const pending = load();
      const entry: { readonly pending: Promise<T>; settled?: T } = { pending };
      requests.set(key, entry);
      const drop = () => {
        if (requests.get(key) === entry) requests.delete(key);
      };
      if (retain === 0) {
        void pending.then(drop, drop);
      } else {
        void pending.then((value) => {
          if (!retainWhen(value)) {
            drop();
            return;
          }
          entry.settled = value;
          // Insertion order is recency order, so the front of the map is the oldest.
          while (requests.size > retain) {
            const oldest = requests.keys().next().value;
            if (oldest === undefined || oldest === key) break;
            requests.delete(oldest);
          }
        }, drop);
      }
      return pending;
    },
    /**
     * Narrow what the next revision drops, to the keys this predicate matches.
     *
     * Declared **before** the bump and consumed by it, so a caller cannot narrow a
     * revision that has already been applied — which would keep answers about a day that
     * has since changed.
     */
    dropOnly(match: (key: string) => boolean): void {
      keepUnless = match;
    },
    peek({ revision, key }: Readonly<{ revision: number; key: string }>): T | undefined {
      if (revision !== activeRevision) return undefined;
      return requests.get(key)?.settled;
    },
  });
}

export function isLatestPlannerRequest(
  requestToken: number,
  latestRequestToken: number,
): boolean {
  return requestToken === latestRequestToken;
}

/**
 * The keys the day's decorations are cached under.
 *
 * Here rather than beside the hooks that use them because they are arithmetic over
 * strings and own the rule that matters: **a cached answer is keyed by everything that
 * changes it.** They are also the only part of that rule that can be asserted without
 * rendering anything, which is why they are not inside a module that imports React.
 */
export function plannerCatalogueCacheKey(searchText: string, lifecycle: string, asOfLocalDate: string): string {
  return `${searchText}|${lifecycle}|${asOfLocalDate}`;
}

/**
 * The day **and** its items: the same items on another day are a different answer, and
 * the order they arrive in is not part of the question.
 */
export function plannerChecklistCacheKey(habitIds: readonly string[], localDate: string): string {
  return `${localDate}|${[...habitIds].sort().join(',')}`;
}

/**
 * How a set of items closes, keyed by the set alone.
 *
 * **No date in it, and that is the whole reason this is a query of its own.** How an item
 * closes is a property of the item; the lines it closes by are a property of the day. Keyed
 * by the date as well, the same answer would be reloaded on every date change for no reason.
 */
export function plannerClosureCacheKey(habitIds: readonly string[]): string {
  return [...habitIds].sort().join(',');
}
