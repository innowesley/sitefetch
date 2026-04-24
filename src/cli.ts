import path from "node:path"
import fs from "node:fs"
import { cac } from "cac"
import { encode } from "gpt-tokenizer/model/gpt-4o"
import { fetchSite, serializePages } from "./index.ts"
import { logger } from "./logger.ts"
import { ensureArray, formatNumber } from "./utils.ts"
import { version } from "../package.json"

const cli = cac("sitefetch")

cli
  .command("<url>", "Fetch a site and save as text")
  .allowUnknownOptions(true)
  .option("-o, --outfile <path>", "Save output to a file instead of printing to stdout")
  .option("--concurrency <number>", "Number of concurrent requests", {
    default: 3,
  })
  .option(
    "--retry-delay <ms>",
    "Delay in ms before retrying on rate limit",
    {
      default: 30000,
    }
  )
  .option("-e, --exclude <pattern>", "Exclude matching paths", {
    array: true,
  })
  .option("-m, --match <pattern>", "Only fetch pages matching the pattern")
  .option("--content-selector <selector>", "CSS selector to extract main content (e.g. 'article', '.post', 'main')")
  .option("--limit <number>", "Maximum number of pages to fetch")
  .option("--silent", "Suppress logs and progress output")
  .example("sitefetch https://example.com")
  .example("sitefetch https://example.com -o output.txt")
  .example("sitefetch https://example.com --limit 10")
  .example("sitefetch https://example.com --match /blog/**")
  .example("sitefetch https://example.com --exclude **/api/**")
  .example("sitefetch https://example.com --content-selector article")
  .example("sitefetch https://example.com --concurrency 5")
  .example("sitefetch https://example.com --silent")
  .action(async (url, flags) => {
    if (!url) {
      cli.outputHelp()
      return
    }

    if (flags.silent) {
      logger.setLevel("silent")
    }

    const pages = await fetchSite(url, {
      concurrency: flags.concurrency,
      retryDelay: flags.retryDelay,
      match: flags.match && ensureArray(flags.match),
      exclude: flags.exclude && ensureArray(flags.exclude),
      contentSelector: flags.contentSelector,
      limit: flags.limit,
    })

    if (pages.size === 0) {
      logger.warn("No pages found")
      return
    }

    const pagesArr = [...pages.values()]

    const totalTokenCount = pagesArr.reduce(
      (acc, page) => acc + encode(page.content).length,
      0
    )

    logger.info(
      `Total token count for ${pages.size} pages: ${formatNumber(
        totalTokenCount
      )}`
    )

    if (flags.outfile) {
      const output = serializePages(
        pages,
        flags.outfile.endsWith(".json") ? "json" : "text"
      )
      fs.mkdirSync(path.dirname(flags.outfile), { recursive: true })
      fs.writeFileSync(flags.outfile, output, "utf8")
    } else {
      console.log(serializePages(pages, "text"))
    }
  })

cli.version(version)
cli.help()
cli.parse()
