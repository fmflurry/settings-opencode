# Cache invalidation

why-not-tooled: the diff hook sees a removed cache marker. It cannot see whether the task explicitly asked for that removal, a new write beside an untouched cache, a bypass that leaves the marker text in place, or a TTL edit that keeps every marker token.

Never remove, bypass, or shorten a cache on your own to fix staleness. That includes a decorator, a TTL, an HTTP cache, a memory cache, and an output cache. Removal or bypass is allowed only when the task, spec, or PR description explicitly says to remove it. When you remove it because it was instructed, name the knock-on effects: callers that still expect the cached value, and tests that only cover the hit. Otherwise the cache stays. Find the writes that change the cached data and invalidate or update the affected entries there, in the same change.

A write in another module does not reach into that cache. It emits an explicit change signal or event. The owner subscribes and invalidates.

Tests cover a refetch or a fresh value after the write, not only the cached hit.

On .NET, evict or tag-invalidate `IMemoryCache`, `HybridCache`, and output cache on the write. Do not delete the cache on your own to refresh it. An explicit instruction to remove it still requires the knock-on effects.

`.claude/hooks/cache-invalidation.sh` warns when the branch diff removes `@SkipIfCached`, `CACHE_NO_TIMEOUT`, or another cache marker and adds no `invalidateCacheFor` or `onCacheInvalidate`. The warning says the removal is fine when it was explicitly instructed. It does not block.

Claude loads this as the path-scoped rule `rules/common/cache-invalidation.md` (`**/*.ts`, `**/*.tsx`, `**/*.js`, `**/*.jsx`, `**/*.cs`). It is not a session-global instruction. Apply it when editing a cached read or a write that changes cached data.
