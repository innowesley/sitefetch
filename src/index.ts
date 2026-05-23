import Queue from "p-queue"
import { Window } from "happy-dom"
import { Readability } from "@mozilla/readability"
import c from "picocolors"
import { toMarkdown } from "./to-markdown.ts"
import { logger } from "./logger.ts"
import { load } from "cheerio"
import { matchPath } from "./utils.ts"
import type { Options, FetchSiteResult } from "./types.ts"

export async function fetchSite(
  url: string,
  options: Options
): Promise<FetchSiteResult> {
  const fetcher = new Fetcher(options)

  return fetcher.fetchSite(url)
}

class Fetcher {
  #pages: FetchSiteResult = new Map()
  #fetched: Set<string> = new Set()
  #queue: Queue

  constructor(public options: Options) {
    const concurrency = options.concurrency || 3
    this.#queue = new Queue({ concurrency })
  }

  async #fetchWithRetry(
    url: string,
    init: RequestInit,
    maxRetries = 3
  ): Promise<Response | undefined> {
    const retryDelay = this.options.retryDelay ?? 30000

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const res = await (this.options.fetch || fetch)(url, init)

        if (res.status === 429) {
          const isLastAttempt = attempt === maxRetries - 1

          if (!isLastAttempt) {
            logger.warn(
              `Rate limited on ${url}, waiting ${retryDelay / 1000}s before retry (${
                attempt + 1
              }/${maxRetries})...`
            )
            await new Promise((r) => setTimeout(r, retryDelay))
          }
          continue
        }

        return res
      } catch (error) {
        const isLastAttempt = attempt === maxRetries - 1

        if (!isLastAttempt) {
          logger.warn(
            `Network error fetching ${url}, retrying in ${retryDelay / 1000}s (${
              attempt + 1
            }/${maxRetries})...`
          )
          await new Promise((r) => setTimeout(r, retryDelay))
        } else {
          logger.warn(`Failed to fetch ${url}: ${(error as Error).message}`)
        }
      }
    }
  }

  #limitReached() {
    return this.options.limit && this.#pages.size >= this.options.limit
  }

  #getContentSelector(pathname: string) {
    if (typeof this.options.contentSelector === "function")
      return this.options.contentSelector({ pathname })

    return this.options.contentSelector
  }

  async fetchSite(url: string) {
    logger.info(
      `Started fetching ${c.green(url)} with a concurrency of ${
        this.#queue.concurrency
      }`
    )

    await this.#fetchPage(url, {
      skipMatch: true,
    })

    await this.#queue.onIdle()

    return this.#pages
  }

  async #fetchPage(
    url: string,
    options: {
      skipMatch?: boolean
    }
  ) {
    const { host, pathname } = new URL(url)

    if (this.#fetched.has(pathname) || this.#limitReached()) {
      return
    }

    this.#fetched.add(pathname)

    // return if not matched
    // we don't need to extract content for this page
    if (
      !options.skipMatch &&
      this.options.match &&
      !matchPath(pathname, this.options.match)
    ) {
      return
    }

    // return if excluded
    if (
      this.options.exclude &&
      matchPath(pathname, this.options.exclude)
    ) {
      return
    }

    logger.info(`Fetching ${c.green(url)}`)

    const res = await this.#fetchWithRetry(url, {
      headers: {
        "user-agent": "Sitefetch (https://github.com/egoist/sitefetch)",
      },
    }).catch((error) => {
      logger.warn(`Failed to fetch ${url}: ${(error as Error).message}`)
      return undefined
    })

    if (!res) {
      return
    }

    if (!res.ok) {
      logger.warn(`Failed to fetch ${url}: ${res.statusText}`)
      return
    }

    if (this.#limitReached()) {
      return
    }

    const contentType = res.headers.get("content-type")

    if (!contentType?.includes("text/html")) {
      logger.warn(`Not a HTML page: ${url}`)
      return
    }

    const resUrl = new URL(res.url)

    // redirected to other site, ignore
    if (resUrl.host !== host) {
      logger.warn(`Redirected from ${host} to ${resUrl.host}`)
      return
    }
    const extraUrls: string[] = []

    const $ = load(await res.text())
    $("script,style,link,img,video").remove()

    $("a").each((_, el) => {
      const href = $(el).attr("href")

      if (!href) {
        return
      }

      try {
        const thisUrl = new URL(href, url)
        if (thisUrl.host !== host) {
          return
        }

        extraUrls.push(thisUrl.href)
      } catch {
        logger.warn(`Failed to parse URL: ${href}`)
      }
    })

    if (extraUrls.length > 0) {
      for (const url of extraUrls) {
        this.#queue.add(() =>
          this.#fetchPage(url, { ...options, skipMatch: false })
        )
      }
    }

    // In dry-run mode, just record the URL and return without fetching content
    if (this.options.dryRun) {
      this.#pages.set(pathname, {
        title: pathname,
        url,
        content: "",
      })
      return
    }

    const window = new Window({
      url,
      settings: {
        disableJavaScriptFileLoading: true,
        disableJavaScriptEvaluation: true,
        disableCSSFileLoading: true,
      },
    })

    const pageTitle = $("title").text()
    const contentSelector = this.#getContentSelector(pathname)
    const html = contentSelector
      ? $(contentSelector).prop("outerHTML")
      : $.html()

    if (!html) {
      logger.warn(`No readable content on ${pathname}`)
      return
    }

    window.document.write(html)

    await window.happyDOM.waitUntilComplete()

    const article = new Readability(window.document as any).parse()

    await window.happyDOM.close()

    if (!article) {
      return
    }

    const content = toMarkdown(article.content)

    this.#pages.set(pathname, {
      title: article.title || pageTitle,
      url,
      content,
    })
  }
}

export function serializePages(
  pages: FetchSiteResult,
  format: "json" | "text"
): string {
  if (format === "json") {
    return JSON.stringify([...pages.values()])
  }

  return [...pages.values()]
    .map((page) =>
      `<page>
  <title>${page.title}</title>
  <url>${page.url}</url>
  <content>${page.content}</content>
</page>`.trim()
    )
    .join("\n\n")
}
