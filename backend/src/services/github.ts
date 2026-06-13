import { Octokit } from '@octokit/rest';
import { graphql } from '@octokit/graphql';
import { getEnv } from '../config/env.js';

export interface RepoMetrics {
  github_id: number;
  owner: string;
  repo: string;
  description: string | null;
  language: string | null;
  homepage: string | null;
  is_archived: boolean;
  is_fork: boolean;
  stars: number;
  forks: number;
  watchers: number;
  open_issues: number;
  project_created_at: string;
  last_pushed_at: string;
  topics: string[];
  license: string | null;
}

export interface RepoSearchResult {
  full_name: string; // "owner/repo"
  owner: string;
  repo: string;
  description: string | null;
  language: string | null;
  stars: number;
  topics: string[];
}

export interface RateLimitInfo {
  remaining: number;
  limit: number;
  resetAt: Date;
}

/**
 * One authenticated client bound to a single token, tracking its rate-limit
 * budget from the `x-ratelimit-*` response headers.
 */
interface TokenClient {
  token: string | undefined;
  octokit: Octokit;
  gql: typeof graphql;
  remaining: number; // last known remaining REST calls (Infinity until first call)
  resetAt: number; // epoch ms when the window resets (0 until first call)
}

/**
 * Resolve the list of server tokens to use, in priority order:
 *   1. GITHUB_TOKENS (comma-separated pool) — blank/whitespace entries dropped
 *   2. GITHUB_PERSONAL_TOKEN (single token — legacy behavior)
 *   3. [undefined] → unauthenticated (very low quota; preserves prior fallback)
 * Never returns an empty-string token.
 */
function resolveTokens(): (string | undefined)[] {
  const env = getEnv();
  const pool = (env.GITHUB_TOKENS ?? '')
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  if (pool.length > 0) return pool;
  const single = env.GITHUB_PERSONAL_TOKEN?.trim();
  if (single) return [single];
  return [undefined];
}

/** True if the error is an HTTP 401 (invalid/expired credentials). */
function isUnauthorized(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { status?: number }).status === 401
  );
}

/** Last 4 chars of a token, for safe logging. */
function mask(token: string): string {
  return `…${token.slice(-4)}`;
}

/**
 * GitHub service - wraps a POOL of Octokit clients (one per server token) and
 * rotates between them based on remaining rate-limit budget. With a single token
 * (or just GITHUB_PERSONAL_TOKEN), behavior is identical to the previous MVP.
 *
 * Hardening:
 *  - blank tokens are filtered out at parse time;
 *  - each token is validated at startup (invalid ones are dropped);
 *  - a token returning 401 during collection is removed from the pool;
 *  - if no valid token remains, the pool falls back to an unauthenticated client
 *    so public repositories stay readable.
 */
export class GitHubService {
  private clients: TokenClient[];
  private validationPromise: Promise<void> | null = null;

  constructor(tokens?: (string | undefined)[]) {
    const list = tokens && tokens.length > 0 ? tokens : resolveTokens();
    this.clients = list.map((token) => this.makeClient(token));
    // Kick off validation at startup; validateTokens never throws.
    this.validationPromise = this.validateTokens();
  }

  /** Build a TokenClient (Octokit + GraphQL) bound to a single token. */
  private makeClient(token: string | undefined): TokenClient {
    const octokit = new Octokit({ auth: token, userAgent: 'oss-pulse/0.1.0' });
    const client: TokenClient = {
      token,
      octokit,
      gql: graphql.defaults({
        headers: token ? { authorization: `token ${token}` } : {},
      }),
      remaining: Number.POSITIVE_INFINITY,
      resetAt: 0,
    };
    // Update this client's budget from every REST response's headers.
    octokit.hook.after('request', (response) => {
      const rem = response.headers['x-ratelimit-remaining'];
      const reset = response.headers['x-ratelimit-reset'];
      if (rem !== undefined) client.remaining = Number(rem);
      if (reset !== undefined) client.resetAt = Number(reset) * 1000;
    });
    return client;
  }

  /**
   * Validate every tokened client at startup via /rate_limit: log which are
   * valid, drop the 401s. Transient errors (network, 403 rate-limit) keep the
   * token. If nothing valid remains, fall back to an unauthenticated client.
   */
  private async validateTokens(): Promise<void> {
    const tokened = this.clients.filter((c) => c.token !== undefined);
    if (tokened.length === 0) {
      console.info('[github] Mode NON authentifié (aucun token fourni).');
      return;
    }

    await Promise.all(
      tokened.map(async (c) => {
        try {
          await c.octokit.rateLimit.get();
          console.info(`[github] Token valide (${mask(c.token!)}).`);
        } catch (err) {
          if (isUnauthorized(err)) {
            const idx = this.clients.indexOf(c);
            if (idx !== -1) this.clients.splice(idx, 1);
            console.warn(`[github] Token invalide écarté (${mask(c.token!)}, 401).`);
          } else {
            const status = (err as { status?: number })?.status ?? 'err';
            console.warn(
              `[github] Validation du token ${mask(c.token!)} non concluante (${status}) — conservé.`
            );
          }
        }
      })
    );

    if (this.clients.length === 0) {
      console.warn('[github] Aucun token valide — bascule en mode NON authentifié.');
      this.clients = [this.makeClient(undefined)];
    } else {
      console.info(`[github] Pool prêt : ${this.clients.length} client(s).`);
    }
  }

  /** Await the one-shot startup validation before any API call. */
  private async ensureValidated(): Promise<void> {
    if (this.validationPromise) await this.validationPromise;
  }

  /** Remove a tokened client after a 401; ensure an unauthenticated fallback. */
  private removeClient(client: TokenClient): void {
    if (client.token === undefined) return; // never drop the unauth fallback
    const idx = this.clients.indexOf(client);
    if (idx !== -1) {
      this.clients.splice(idx, 1);
      console.warn(
        `[github] Token écarté du pool suite à un 401 (${mask(client.token)}). Restants : ${this.clients.length}.`
      );
    }
    if (this.clients.length === 0) {
      console.warn('[github] Aucun token valide restant — bascule en mode NON authentifié.');
      this.clients = [this.makeClient(undefined)];
    }
  }

  /**
   * Run an API call on the best client; on 401, drop that token and retry with
   * another. Terminates: each 401 removes a tokened client (finite) or, once
   * only the unauthenticated client remains, the 401 is rethrown.
   */
  private async run<T>(fn: (client: TokenClient) => Promise<T>): Promise<T> {
    await this.ensureValidated();
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const client = this.pick();
      try {
        return await fn(client);
      } catch (err) {
        if (isUnauthorized(err) && client.token !== undefined) {
          this.removeClient(client);
          continue;
        }
        throw err;
      }
    }
  }

  /**
   * Effective remaining budget for a client: a client whose reset window has
   * already passed is assumed replenished.
   */
  private effectiveRemaining(c: TokenClient, now: number): number {
    if (c.resetAt && c.resetAt <= now) return Number.POSITIVE_INFINITY;
    return c.remaining;
  }

  /** Pick the client with the most remaining quota. */
  private pick(): TokenClient {
    const now = Date.now();
    let best = this.clients[0];
    let bestRem = this.effectiveRemaining(best, now);
    for (let i = 1; i < this.clients.length; i++) {
      const rem = this.effectiveRemaining(this.clients[i], now);
      if (rem > bestRem) {
        best = this.clients[i];
        bestRem = rem;
      }
    }
    return best;
  }

  /** Number of tokens in the pool (for diagnostics). */
  get poolSize(): number {
    return this.clients.length;
  }

  /**
   * Fetch core repository metrics (stars, forks, issues...).
   */
  async getRepoMetrics(owner: string, repo: string): Promise<RepoMetrics> {
    const { data } = await this.run((c) => c.octokit.repos.get({ owner, repo }));
    return {
      github_id: data.id,
      owner: data.owner.login,
      repo: data.name,
      description: data.description,
      language: data.language,
      homepage: data.homepage,
      is_archived: data.archived,
      is_fork: data.fork,
      stars: data.stargazers_count,
      forks: data.forks_count,
      watchers: data.subscribers_count,
      open_issues: data.open_issues_count,
      project_created_at: data.created_at,
      last_pushed_at: data.pushed_at ?? data.updated_at,
      topics: data.topics ?? [],
      license: data.license?.spdx_id ?? null,
    };
  }

  /**
   * Search public repositories by free text (top N by stars).
   * Quota note: the Search API has its own budget (10 req/min anonymous,
   * 30 req/min with a token) — callers should cache results.
   */
  async searchRepos(query: string, limit = 5): Promise<RepoSearchResult[]> {
    const { data } = await this.run((c) =>
      c.octokit.search.repos({
        q: query,
        sort: 'stars',
        order: 'desc',
        per_page: limit,
      })
    );
    return data.items.map((it) => ({
      full_name: it.full_name,
      owner: it.owner?.login ?? it.full_name.split('/')[0],
      repo: it.name,
      description: it.description,
      language: it.language,
      stars: it.stargazers_count,
      topics: it.topics ?? [],
    }));
  }

  /**
   * Fetch open PR count via GraphQL (more efficient than listing all PRs).
   */
  async getOpenPRCount(owner: string, repo: string): Promise<number> {
    const result = await this.run((c) =>
      c.gql<{ repository: { pullRequests: { totalCount: number } } }>(
        `query($owner:String!,$repo:String!){
          repository(owner:$owner,name:$repo){
            pullRequests(states:OPEN){ totalCount }
          }
        }`,
        { owner, repo }
      )
    );
    return result.repository.pullRequests.totalCount;
  }

  /**
   * Fetch contributors (top N by contribution count).
   */
  async getContributors(owner: string, repo: string, perPage = 30) {
    const { data } = await this.run((c) =>
      c.octokit.repos.listContributors({
        owner,
        repo,
        per_page: perPage,
      })
    );
    return data.map((c) => ({
      login: c.login ?? 'unknown',
      github_id: c.id,
      avatar_url: c.avatar_url,
      contributions: c.contributions,
    }));
  }

  /**
   * Total contributor count (including anonymous) via the Link header trick:
   * with per_page=1, the last page number equals the total count. One API
   * call, regardless of repository size.
   */
  async getContributorCount(owner: string, repo: string): Promise<number> {
    return this.run(async (c) => {
      const res = await c.octokit.repos.listContributors({
        owner,
        repo,
        per_page: 1,
        anon: 'true',
      });
      const link = res.headers.link;
      if (link) {
        const m = link.match(/[?&]page=(\d+)>;\s*rel="last"/);
        if (m) return Number(m[1]);
      }
      return Array.isArray(res.data) ? res.data.length : 0;
    });
  }

  /**
   * Fetch commits for the last 30 days (for heatmap).
   * Returns aggregated count per day.
   */
  async getCommitsByDay(
    owner: string,
    repo: string,
    sinceDays = 30
  ): Promise<Map<string, number>> {
    const since = new Date();
    since.setDate(since.getDate() - sinceDays);

    return this.run(async (client) => {
      const counts = new Map<string, number>();
      const iterator = client.octokit.paginate.iterator(
        client.octokit.repos.listCommits,
        {
          owner,
          repo,
          since: since.toISOString(),
          per_page: 100,
        }
      );

      for await (const { data } of iterator) {
        for (const commit of data) {
          const date = commit.commit.author?.date ?? commit.commit.committer?.date;
          if (!date) continue;
          const day = date.substring(0, 10);
          counts.set(day, (counts.get(day) ?? 0) + 1);
        }
      }
      return counts;
    });
  }

  /** Number of releases published in the last 365 days (first 100 considered). */
  async getReleasesLastYear(owner: string, repo: string): Promise<number> {
    const { data } = await this.run((c) =>
      c.octokit.repos.listReleases({ owner, repo, per_page: 100 })
    );
    const cutoff = Date.now() - 365 * 86_400_000;
    return data.filter((r) => r.published_at && new Date(r.published_at).getTime() >= cutoff).length;
  }

  /** Declared profile location of a user (free text, often empty). */
  async getUserLocation(login: string): Promise<string | null> {
    const { data } = await this.run((c) => c.octokit.users.getByUsername({ username: login }));
    return data.location ?? null;
  }

  /**
   * Get current rate limit info (for monitoring).
   */
  async getRateLimit(): Promise<RateLimitInfo> {
    const { data } = await this.run((c) => c.octokit.rateLimit.get());
    return {
      remaining: data.rate.remaining,
      limit: data.rate.limit,
      resetAt: new Date(data.rate.reset * 1000),
    };
  }
}

// Singleton instance using the server token pool (GITHUB_TOKENS) with a single
// GITHUB_PERSONAL_TOKEN as fallback.
let defaultInstance: GitHubService | null = null;
export function getDefaultGitHubService(): GitHubService {
  if (!defaultInstance) defaultInstance = new GitHubService();
  return defaultInstance;
}
