import { chromium, firefox, webkit } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
await mkdir("artifacts", { recursive: true });
const records = [];
for (const [name, browserType] of Object.entries({
  chromium,
  firefox,
  webkit,
})) {
  const browser = await browserType.launch();
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1100 },
    deviceScaleFactor: 2,
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://127.0.0.1:5173/");
  await page.waitForFunction(
    () => document.documentElement.dataset.ready === "true",
  );
  const painted = () =>
    page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
  await painted();
  await page.screenshot({
    path: `artifacts/${name}-structured.png`,
    fullPage: true,
  });
  const initial = await page.evaluate(() => window.gprose.snapshot());
  await page.setViewportSize({ width: 850, height: 1100 });
  await painted();
  await page.screenshot({
    path: `artifacts/${name}-structured-narrow.png`,
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.locator("#sample").selectOption("empty");
  // A diagram fixture generated locally, then inserted through the real file form.
  const png = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 800;
    canvas.height = 320;
    const c = canvas.getContext("2d");
    c.fillStyle = "#eef2e5";
    c.fillRect(0, 0, 800, 320);
    c.strokeStyle = "#829665";
    c.lineWidth = 4;
    c.beginPath();
    c.moveTo(210, 160);
    c.lineTo(590, 160);
    c.stroke();
    for (const [x, label] of [
      [130, "Document"],
      [400, "Layout"],
      [670, "Canvas"],
    ]) {
      c.fillStyle = "#d8e3c4";
      c.beginPath();
      c.arc(x, 160, 85, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = "#344429";
      c.font = "24px sans-serif";
      c.textAlign = "center";
      c.fillText(label, x, 168);
    }
    return canvas.toDataURL("image/png").split(",")[1];
  });
  await page.locator("#image").click();
  await page.locator('#image-form [name="file"]').setInputFiles({
    name: "document-flow.png",
    mimeType: "image/png",
    buffer: Buffer.from(png, "base64"),
  });
  await page
    .locator('#image-form [name="title"]')
    .fill("The document passes through layout to the canvas renderer.");
  await page.getByRole("button", { name: "Insert image", exact: true }).click();
  await page.waitForFunction(
    () => !document.querySelector("#image-dialog").open,
  );
  if (
    !(await page.evaluate(
      () => document.activeElement instanceof HTMLTextAreaElement,
    ))
  )
    throw new Error(
      `${name}: image insertion did not return focus to the editor`,
    );
  await painted();
  await page.screenshot({
    path: `artifacts/${name}-image.png`,
    fullPage: true,
  });
  records.push({
    browser: name,
    version: browser.version(),
    errors,
    structured: initial.panes,
    image: (await page.evaluate(() => window.gprose.snapshot())).panes,
  });
  await browser.close();
}
await writeFile(
  "artifacts/structure-inspection.json",
  JSON.stringify(records, null, 2) + "\n",
);
