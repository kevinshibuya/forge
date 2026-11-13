import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { chromium, type Browser } from 'playwright';

export const RENDERER = Symbol('RENDERER');

export interface Renderer {
  render(html: string, opts: { width: number; height: number }): Promise<Buffer>;
}

/** Lazy singleton Chromium; a fresh context/page per render so concurrent renders don't collide. */
@Injectable()
export class PlaywrightRenderer implements Renderer, OnModuleDestroy {
  private browserP?: Promise<Browser>;

  private ensure(): Promise<Browser> {
    // Memoize the PROMISE (not the resolved Browser) so two concurrent first renders share one launch.
    // Reset on launch failure so a transient/recoverable error (e.g. browser not yet installed) doesn't
    // permanently poison the cached rejected promise and brick every future render until a restart.
    // Also reset on LATER disconnect/crash: without this, a Chromium that dies after a successful launch
    // leaves browserP resolving to a dead browser and every subsequent render fails until a restart —
    // the 'disconnected' handler clears the cache so the next render relaunches.
    return (this.browserP ??= chromium.launch({ args: ['--no-sandbox'] })
      .then((browser) => {
        browser.on('disconnected', () => { this.browserP = undefined; });
        return browser;
      })
      .catch((err: unknown) => { this.browserP = undefined; throw err; }));
  }

  async render(html: string, opts: { width: number; height: number }): Promise<Buffer> {
    const browser = await this.ensure();
    const context = await browser.newContext({
      viewport: { width: opts.width, height: opts.height },
      deviceScaleFactor: 1,
    });
    try {
      const page = await context.newPage();
      await page.setContent(html, { waitUntil: 'networkidle', timeout: 30_000 });
      // Fonts must load before we screenshot, else brand type falls back silently. Fail the render
      // if any declared @font-face errored — turns a silent quality bug into a re-runnable failure
      // (spec: "fail the render if fonts don't load"). Residual: a <link> that 404s entirely leaves
      // no FontFace entries and can't be caught here; networkidle + a real font URL make that unlikely.
      const fontsOk = await page.evaluate(async () => {
        await document.fonts.ready;
        return !Array.from(document.fonts).some((f) => f.status === 'error');
      });
      if (!fontsOk) throw new Error('render aborted: a declared font failed to load');
      return await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: opts.width, height: opts.height } });
    } finally {
      await context.close();
    }
  }

  async onModuleDestroy(): Promise<void> {
    const p = this.browserP;
    this.browserP = undefined;
    if (p) { try { await (await p).close(); } catch { /* already gone */ } }
  }
}
