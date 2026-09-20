import { chromium, firefox, webkit } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
await mkdir("artifacts", { recursive: true });
const results = [];
for (const [name, type] of Object.entries({ chromium, firefox, webkit })) {
  const browser = await type.launch();
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1100 },
    deviceScaleFactor: 2,
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://127.0.0.1:5173");
  await page.waitForFunction(
    () => document.documentElement.dataset.ready === "true",
  );
  await page.screenshot({
    path: `artifacts/${name}-prose.png`,
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Measure layout", exact: true })
    .click();
  await page.locator("#measurements:not([hidden])").waitFor();
  const benchmark = await page.locator("#benchmark-result").innerText();
  await page.locator("#sample").selectOption("scripts");
  const snapshot = await page.evaluate(() => window.gprose.snapshot());
  await page.screenshot({
    path: `artifacts/${name}-scripts.png`,
    fullPage: true,
  });
  await page.locator("#sample").selectOption("long");
  await page
    .locator(".scroller")
    .evaluateAll((elements) =>
      elements.forEach((el) => (el.scrollTop = el.scrollHeight)),
    );
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const scrollPositions = await page.locator('.scroller').evaluateAll(elements => elements.map(el => ({top:el.scrollTop,height:el.scrollHeight,viewport:el.clientHeight})));
  if (scrollPositions.some(s => s.top < s.height - s.viewport - 1)) throw new Error(`${name}: failed to scroll to the final paragraph`);
  await page.screenshot({ path: `artifacts/${name}-long.png`, fullPage: true });
  results.push({
    browser: name,
    version: browser.version(),
    benchmark,
    scrollPositions,
    panes: snapshot.panes.map(({ name, missing, lines }) => ({
      name,
      missing,
      lines: lines.length,
      firstLine: lines[0],
    })),
    errors,
  });
  await browser.close();
}
await writeFile("artifacts/inspection.json", JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
