import { chromium, firefox, webkit } from "playwright";
import { writeFile, mkdir } from "node:fs/promises";
await mkdir("artifacts", { recursive: true });
const runs = [];
for (const [name, type] of Object.entries({ chromium, firefox, webkit })) {
  const browser = await type.launch();
  const page = await browser.newPage({
    viewport: { width: 2100, height: 1200 },
    deviceScaleFactor: 1,
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const start = Date.now();
  await page.goto("http://127.0.0.1:5173/glyph-spike.html");
  await page.waitForFunction(() => document.documentElement.dataset.ready, {
    timeout: 90000,
  });
  const state = await page.locator("html").getAttribute("data-ready");
  const run = {
    browser: name,
    version: browser.version(),
    navigationToReadyMs: Date.now() - start,
    state,
    errors,
  };
  if (state === "true") {
    run.initial = await page.evaluate(() => window.glyphSpike.inspect());
    await page.screenshot({
      path: `artifacts/${name}-glyph-prose.png`,
      fullPage: true,
    });
    try {
      run.report = await page.evaluate(() => window.glyphSpike.measure());
    } catch (e) {
      run.measureError = e.message;
      run.partial = await page.evaluate(() => window.glyphSpike.partial());
    }
    await page.locator("#sample").selectOption("bidi");
    await page.locator("#input").evaluate((el) => {
      el.setSelectionRange(8, 30);
      el.dispatchEvent(new Event("select"));
    });
    await page.screenshot({
      path: `artifacts/${name}-glyph-bidi.png`,
      fullPage: true,
    });
    await page.locator("#sample").selectOption("ligatures");
    run.ligature = await page.evaluate(() => window.glyphSpike.inspect());
    await page.locator("#input").fill("office");
    run.office = await page.evaluate(() => window.glyphSpike.inspect());
    await page.locator("#input").fill("Typed text");
    run.typing = await page.evaluate(() => window.glyphSpike.inspect());
    for (const ratio of [2]) {
      const context = await browser.newContext({
        viewport: { width: 2100, height: 1200 },
        deviceScaleFactor: ratio,
      });
      const high = await context.newPage();
      await high.goto("http://127.0.0.1:5173/glyph-spike.html");
      await high.waitForFunction(() => document.documentElement.dataset.ready, {
        timeout: 90000,
      });
      await high.screenshot({
        path: `artifacts/${name}-glyph-dpr${ratio}.png`,
        fullPage: true,
      });
      await context.close();
    }
  } else run.failure = await page.locator("#status").textContent();
  if (state === "true")
    run.lifecycle = await page.evaluate(() =>
      window.glyphSpike.lifecycleProbe(),
    );
  runs.push(run);
  await writeFile("artifacts/glyph-spike.json", JSON.stringify(runs, null, 2));
  console.log(
    JSON.stringify({
      browser: name,
      state,
      error: run.failure ?? run.measureError,
      timings: run.report?.timings.map((t) => ({
        scenario: t.scenario,
        operation: t.operation,
        medians: t.values.map((v) => [v.engine, v.medianMs]),
      })),
    }),
  );
  await browser.close();
}
