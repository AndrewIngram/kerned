import { test, expect } from "@playwright/test";

test("both engines lay out and paint a real document", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-ready", "true");
  const snapshot = await page.evaluate(() => window.gprose.snapshot());
  expect(snapshot.panes).toHaveLength(2);
  for (const pane of snapshot.panes) {
    expect(pane.lines.length).toBeGreaterThan(5);
    expect(pane.missing).toBe(0);
  }
  expect(errors).toEqual([]);
});

async function ready(page) {
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-ready", "true");
}
async function clickCaret(page, engine, index, upstream = false) {
  const geometry = await page.evaluate(
    ({ engine, index, upstream }) =>
      window.gprose.caret(engine, index, upstream),
    { engine, index, upstream },
  );
  const canvas = page.locator(`[data-engine="${engine}"] canvas`);
  const box = await canvas.boundingBox();
  await page.mouse.click(
    box.x + 32 + geometry.rect[0] + 0.2,
    box.y + geometry.top + (geometry.rect[1] + geometry.rect[3]) / 2,
  );
}

for (const engine of ["CanvasKit", "Parley"]) {
  test(`${engine}: canvas hit testing, typing, formatting, undo and redo`, async ({
    page,
  }) => {
    await ready(page);
    await page.locator("#sample").selectOption("empty");
    const canvas = page.locator(`[data-engine="${engine}"] canvas`);
    await canvas.click({ position: { x: 34, y: 42 } });
    await page.keyboard.type("Hello canvas");
    await expect(
      page.getByRole("textbox", { name: "CanvasKit editor" }),
    ).toHaveValue("Hello canvas");
    await expect(
      page.getByRole("textbox", { name: "Parley editor" }),
    ).toHaveValue("Hello canvas");
    await clickCaret(page, engine, 5, true);
    expect(
      await page.evaluate(() => window.gprose.snapshot().selection.focus),
    ).toBe(5);
    await page.keyboard.type("!");
    expect(await page.evaluate(() => window.gprose.snapshot().text)).toBe(
      "Hello! canvas",
    );
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.press("ControlOrMeta+b");
    const bold = await page.evaluate(() => window.gprose.snapshot());
    expect(
      bold.spans.some((s) => s.bold && s.start === 0 && s.end === 13),
    ).toBe(true);
    await page.keyboard.press("ControlOrMeta+z");
    expect(await page.evaluate(() => window.gprose.snapshot().spans)).toEqual(
      [],
    );
    await page.keyboard.press("ControlOrMeta+Shift+z");
    expect(
      await page.evaluate(() =>
        window.gprose.snapshot().spans.some((s) => s.bold),
      ),
    ).toBe(true);
    await page.keyboard.type("Replacement");
    await expect(
      page.getByRole("textbox", { name: "Parley editor" }),
    ).toHaveValue("Replacement");
  });

  test(`${engine}: grapheme deletion and paragraph navigation`, async ({
    page,
  }) => {
    await ready(page);
    await page.locator("#sample").selectOption("empty");
    await page
      .locator(`[data-engine="${engine}"] canvas`)
      .click({ position: { x: 34, y: 42 } });
    await page.keyboard.insertText("A👨‍👩‍👧‍👦B");
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("Backspace");
    expect(await page.evaluate(() => window.gprose.snapshot().text)).toBe("AB");
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.insertText("first\nsecond");
    await page.keyboard.press("Home");
    expect(
      await page.evaluate(() => window.gprose.snapshot().selection.focus),
    ).toBe(6);
    await page.keyboard.press("ArrowLeft");
    const focus = await page.evaluate(
      () => window.gprose.snapshot().selection.focus,
    );
    expect(focus).toBe(5);
  });

  test(`${engine}: arrows visit successive positions in Latin text`, async ({
    page,
  }) => {
    await ready(page);
    await page.locator("#sample").selectOption("empty");
    await page
      .locator(`[data-engine="${engine}"] canvas`)
      .click({ position: { x: 34, y: 42 } });
    await page.keyboard.insertText("office");
    await page.keyboard.press("Home");
    const positions = [];
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press("ArrowRight");
      positions.push(
        await page.evaluate(() => window.gprose.snapshot().selection.focus),
      );
    }
    expect(positions).toEqual([1, 2, 3, 4, 5, 6]);
  });

  test(`${engine}: selection geometry stays on grapheme boundaries in mixed scripts`, async ({
    page,
  }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await ready(page);
    await page.locator("#sample").selectOption("scripts");
    const data = await page.evaluate(() => ({
      snapshot: window.gprose.snapshot(),
      boundaries: window.gprose.boundaries(),
    }));
    expect(data.snapshot.panes.every((p) => p.missing === 0)).toBe(true);
    const canvas = page.locator(`[data-engine="${engine}"] canvas`);
    const box = await canvas.boundingBox();
    for (const y of [70, 95, 130, 160, 200, 245]) {
      await page.mouse.click(box.x + 170, box.y + y);
      const focus = await page.evaluate(
        () => window.gprose.snapshot().selection.focus,
      );
      expect(data.boundaries).toContain(focus);
    }
    await page.mouse.move(box.x + 40, box.y + 80);
    await page.mouse.down();
    await page.mouse.move(box.x + 400, box.y + 180, { steps: 8 });
    await page.mouse.up();
    const selected = await page.evaluate(
      () => window.gprose.snapshot().selection,
    );
    expect(selected.anchor).not.toBe(selected.focus);
    expect(data.boundaries).toContain(selected.anchor);
    expect(data.boundaries).toContain(selected.focus);
    expect(errors).toEqual([]);
  });
}

test("resizing reflows both engines and a long document scrolls to its end", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await ready(page);
  const before = await page.evaluate(() =>
    window.gprose.snapshot().panes.map((p) => p.lines.length),
  );
  await page.setViewportSize({ width: 850, height: 1000 });
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.gprose.snapshot().panes.map((p) => p.lines.length),
      ),
    )
    .not.toEqual(before);
  await page.locator("#sample").selectOption("long");
  for (const engine of ["CanvasKit", "Parley"]) {
    const scroller = page.locator(`[data-engine="${engine}"] .scroller`);
    await scroller.evaluate((el) => (el.scrollTop = el.scrollHeight));
    expect(await scroller.evaluate((el) => el.scrollTop)).toBeGreaterThan(
      10000,
    );
    const canvas = page.locator(`[data-engine="${engine}"] canvas`);
    await canvas.click({ position: { x: 80, y: 300 } });
    expect(
      await page.evaluate(() => window.gprose.snapshot().selection.focus),
    ).toBeGreaterThan(50000);
  }
  expect(errors).toEqual([]);
});

test("composition updates share text without committing intermediate undo states", async ({
  page,
}) => {
  await ready(page);
  await page.locator("#sample").selectOption("empty");
  await page
    .locator('[data-engine="Parley"] canvas')
    .click({ position: { x: 34, y: 42 } });
  const input = page.getByRole("textbox", { name: "Parley editor" });
  await input.dispatchEvent("compositionstart", { data: "" });
  await input.evaluate((el) => {
    el.value = "に";
    el.setSelectionRange(1, 1);
    el.dispatchEvent(
      new InputEvent("input", {
        data: "に",
        inputType: "insertCompositionText",
        isComposing: true,
        bubbles: true,
      }),
    );
  });
  await input.evaluate((el) => {
    el.value = "日本";
    el.setSelectionRange(2, 2);
    el.dispatchEvent(
      new InputEvent("input", {
        data: "日本",
        inputType: "insertCompositionText",
        isComposing: true,
        bubbles: true,
      }),
    );
  });
  await input.dispatchEvent("compositionend", { data: "日本" });
  await expect(
    page.getByRole("textbox", { name: "CanvasKit editor" }),
  ).toHaveValue("日本");
  await page.keyboard.press("ControlOrMeta+z");
  expect(await page.evaluate(() => window.gprose.snapshot().text)).toBe("");
});

async function selectRange(page, engine, start, end = start) {
  const input = page.getByRole("textbox", { name: `${engine} editor` });
  await input.focus();
  await input.evaluate(
    (el, [start, end]) => {
      el.setSelectionRange(start, end);
      el.dispatchEvent(new Event("select"));
    },
    [start, end],
  );
}
for (const engine of ["CanvasKit", "Parley"]) {
  test(`${engine}: lists split, nest, change style, outdent and exit`, async ({
    page,
  }) => {
    await ready(page);
    await page.locator("#sample").selectOption("empty");
    await selectRange(page, engine, 0);
    await page.locator("#number").click();
    await page.keyboard.type("First");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Second");
    await page.keyboard.press("Tab");
    let snap = await page.evaluate(() => window.gprose.snapshot());
    expect(snap.text).toBe("First\nSecond");
    expect(snap.leaves.map((l) => l.depth)).toEqual([1, 2]);
    await page.locator("#bullet").click();
    expect(
      await page.evaluate(() =>
        window.gprose.snapshot().leaves.map((l) => l.marker),
      ),
    ).toEqual(["1.", "•"]);
    await page.keyboard.press("Shift+Tab");
    expect(
      await page.evaluate(() =>
        window.gprose.snapshot().leaves.map((l) => l.depth),
      ),
    ).toEqual([1, 1]);
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    snap = await page.evaluate(() => window.gprose.snapshot());
    expect(snap.leaves.map((l) => l.depth)).toEqual([1, 1, 0]);
    await page.keyboard.type("After the list");
    expect(await page.evaluate(() => window.gprose.snapshot().text)).toBe(
      "First\nSecond\nAfter the list",
    );
    await page.keyboard.press("ControlOrMeta+z");
    await page.keyboard.press("ControlOrMeta+Shift+z");
    expect(
      await page.evaluate(() => window.gprose.snapshot().leaves.at(-1).depth),
    ).toBe(0);
  });

  test(`${engine}: multi-paragraph quotes retain formatting and exit on empty paragraph`, async ({
    page,
  }) => {
    await ready(page);
    await page.locator("#sample").selectOption("empty");
    await selectRange(page, engine, 0);
    await page.keyboard.insertText("First quote\nSecond quote");
    await page.keyboard.press("ControlOrMeta+a");
    await page.locator("#quote").click();
    await page.locator("#bold").click();
    let snap = await page.evaluate(() => window.gprose.snapshot());
    expect(snap.blocks[0].kind).toBe("quote");
    expect(snap.blocks[0].children).toHaveLength(2);
    expect(
      snap.blocks[0].children.every((p) => p.spans.some((s) => s.bold)),
    ).toBe(true);
    await selectRange(page, engine, snap.text.length);
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Outside");
    snap = await page.evaluate(() => window.gprose.snapshot());
    expect(snap.blocks.map((b) => b.kind)).toEqual(["quote", "paragraph"]);
    expect(snap.blocks[0].children).toHaveLength(2);
    expect(snap.leaves.at(-1).quotes).toEqual([]);
    await selectRange(page, engine, 6, 17);
    await page.keyboard.insertText("joined");
    expect(
      await page.evaluate(() => window.gprose.snapshot().blocks[0].children),
    ).toHaveLength(1);
  });

  test(`${engine}: insert, select, navigate and delete an embed with undo`, async ({
    page,
  }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await ready(page);
    await page.locator("#sample").selectOption("empty");
    await selectRange(page, engine, 0);
    await page.keyboard.type("BeforeAfter");
    await selectRange(page, engine, 6);
    await page.locator("#embed").click();
    await page.locator('#embed-form [name="title"]').fill("A reference");
    await page
      .locator('#embed-form [name="url"]')
      .fill("https://example.com/reference");
    await page
      .getByRole("button", { name: "Insert embed", exact: true })
      .click();
    let snap = await page.evaluate(() => window.gprose.snapshot());
    expect(snap.text).toBe("Before\n\uFFFC\nAfter");
    expect(snap.blocks.map((b) => b.kind)).toEqual([
      "paragraph",
      "embed",
      "paragraph",
    ]);
    await expect(page.locator("#open-embed")).toHaveAttribute(
      "href",
      "https://example.com/reference",
    );
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    expect(
      await page.evaluate(() => window.gprose.snapshot().selection.focus),
    ).toBe(9);
    await page.keyboard.press("Backspace");
    expect(
      await page.evaluate(() => window.gprose.snapshot().selection),
    ).toMatchObject({ anchor: 7, focus: 8 });
    expect(
      await page.evaluate(() => window.gprose.snapshot().blocks[1].kind),
    ).toBe("embed");
    const geometry = snap.panes.find((p) => p.name === engine).paragraphs[1];
    const canvas = page.locator(`[data-engine="${engine}"] canvas`),
      box = await canvas.boundingBox();
    await page.mouse.click(
      box.x + geometry.left + 30,
      box.y + geometry.top + 30,
    );
    expect(
      await page.evaluate(() => window.gprose.snapshot().selection),
    ).toMatchObject({ anchor: 7, focus: 8 });
    await page.keyboard.press("Backspace");
    expect(
      await page.evaluate(() =>
        window.gprose.snapshot().blocks.map((b) => b.kind),
      ),
    ).toEqual(["paragraph", "paragraph"]);
    await page.keyboard.press("ControlOrMeta+z");
    expect(
      await page.evaluate(() => window.gprose.snapshot().blocks[1].kind),
    ).toBe("embed");
    expect(errors).toEqual([]);
  });

  test(`${engine}: uploaded image is drawn, selected and removable`, async ({
    page,
  }) => {
    await ready(page);
    await page.locator("#sample").selectOption("empty");
    await selectRange(page, engine, 0);
    await page.locator("#image").click();
    await page
      .locator('#image-form [name="file"]')
      .setInputFiles({
        name: "pixel.png",
        mimeType: "image/png",
        buffer: Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==",
          "base64",
        ),
      });
    await page.locator('#image-form [name="title"]').fill("A red square");
    await page
      .getByRole("button", { name: "Insert image", exact: true })
      .click();
    await expect(page.locator("#image-dialog")).not.toBeVisible();
    let snap = await page.evaluate(() => window.gprose.snapshot());
    expect(snap.blocks[0]).toMatchObject({
      kind: "image",
      title: "A red square",
      width: 1,
      height: 1,
    });
    expect(snap.panes.every((p) => p.paragraphs[0].height > 300)).toBe(true);
    await page.locator("#remove-atom").click();
    expect(
      await page.evaluate(() =>
        window.gprose.snapshot().blocks.map((b) => b.kind),
      ),
    ).toEqual(["paragraph"]);
    await page.locator("#undo").click();
    expect(
      await page.evaluate(() => window.gprose.snapshot().blocks[0].kind),
    ).toBe("image");
  });
}
