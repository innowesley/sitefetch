export type Options = {
  /** How many requests can be made at the same time */
  concurrency?: number

  /**
   * Match pathname by specific patterns, powered by micromatch
   * Only pages matched by this will be fetched
   */
  match?: string[]

  /**
   * The CSS selector to find content
   */
  contentSelector?:
    | string
    | ((ctx: { pathname: string }) => string | void | undefined)

  /**
   * Limit the result to this amount of pages
   */
  limit?: number

  /**
   * Delay in ms before retrying on rate limit (429). Default: 30000
   */
  retryDelay?: number

  /**
   * Exclude paths matching these patterns (micromatch)
   */
  exclude?: string[]

  /**
   * A custom function to fetch URL
   */
  fetch?: (url: string, init: RequestInit) => Promise<Response>

  /**
   * Dry run: collect URLs without fetching content
   */
  dryRun?: boolean
}

export type Page = {
  title: string
  url: string
  content: string
}

export type FetchSiteResult = Map<string, Page>
