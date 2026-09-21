import { expect, test } from 'vitest';

import { createEditorViewport, type EditorViewport } from '../viewport';

function embedded() {
  const scrollport = document.createElement('div');
  scrollport.style.cssText = 'width: 320px; height: 160px; overflow: auto;';
  const element = document.createElement('div');
  element.style.cssText = 'height: 1000px; width: 100%;';
  const toolbar = document.createElement('div');
  toolbar.style.height = '24px';
  scrollport.append(element);
  document.body.append(toolbar, scrollport);

  return {
    element,
    scrollport,
    toolbar,
    remove() {
      toolbar.remove();
      scrollport.remove();
    },
  };
}

test('owns real embedded geometry, immediate clamped scrolling and zoom without duplicate publications', async ({
  onTestFinished,
}) => {
  const host = embedded();
  const controller = createEditorViewport();
  const changes: EditorViewport[] = [];
  controller.subscribe(() => changes.push(controller.getSnapshot()));
  const dispose = controller.attach(host);
  onTestFinished(() => {
    controller.destroy();
    host.remove();
  });
  expect(controller.getSnapshot()).toEqual({
    width: host.element.clientWidth,
    height: 160,
    inset: 24,
    scrollTop: 0,
    zoom: 1,
  });
  const initial = controller.getSnapshot();
  host.scrollport.dispatchEvent(new Event('scroll'));
  expect(controller.getSnapshot()).toBe(initial);
  host.scrollport.scrollTop = 70;
  await expect.poll(() => controller.getSnapshot().scrollTop).toBe(70);
  controller.scrollTo(1_000_000);
  expect(controller.getSnapshot().scrollTop).toBe(
    host.scrollport.scrollHeight - host.scrollport.clientHeight,
  );
  expect(controller.readScroll()).toBe(controller.getSnapshot().scrollTop);
  const scrolled = controller.getSnapshot();
  host.scrollport.dispatchEvent(new Event('scroll'));
  expect(controller.getSnapshot()).toBe(scrolled);
  controller.scrollTo(-20);
  expect(controller.getSnapshot().scrollTop).toBe(0);
  controller.setZoom(1.25);
  expect(controller.getSnapshot()).toMatchObject({
    width: host.element.clientWidth,
    height: 160,
    zoom: 1.25,
  });
  const zoomed = controller.getSnapshot();
  controller.setZoom(1.25);
  expect(controller.getSnapshot()).toBe(zoomed);
  expect(() => controller.setZoom(0)).toThrow(/positive/);
  expect(() => controller.setZoom(Infinity)).toThrow(/finite/);
  expect(() => controller.scrollTo(Number.NaN)).toThrow(/finite/);
  host.toolbar.style.height = '40px';
  await expect.poll(() => controller.getSnapshot().inset).toBe(40);
  host.scrollport.style.height = '200px';
  await expect.poll(() => controller.getSnapshot().height).toBe(200);
  dispose();
  dispose();
  const count = changes.length;
  host.scrollport.scrollTop = 20;
  host.scrollport.dispatchEvent(new Event('scroll'));
  expect(changes).toHaveLength(count);
});

test('supports a page in another window and preserves zoom when switching attachments', async ({
  onTestFinished,
}) => {
  const frame = document.createElement('iframe');
  frame.style.cssText = 'width: 400px; height: 240px; border: 0;';
  document.body.append(frame);
  const page = frame.contentWindow;
  const doc = frame.contentDocument;

  if (!page || !doc) throw new Error('Expected same-origin frame');
  doc.body.style.margin = '0';
  const toolbar = doc.createElement('div');
  toolbar.style.height = '30px';
  const element = doc.createElement('div');
  element.style.cssText = 'width: 100%; height: 1200px;';
  doc.body.append(toolbar, element);
  const controller = createEditorViewport();
  const host = embedded();
  onTestFinished(() => {
    controller.destroy();
    frame.remove();
    host.remove();
  });
  const detach = controller.attach({ element, toolbar, scrollport: page });
  expect(controller.getSnapshot()).toMatchObject({
    height: page.innerHeight - 30,
    inset: 30,
    scrollTop: 0,
  });
  controller.scrollTo(120);
  expect(page.scrollY).toBe(120);
  expect(controller.getSnapshot().scrollTop).toBe(120);
  toolbar.style.height = '50px';
  await expect.poll(() => controller.getSnapshot().height).toBe(page.innerHeight - 50);
  frame.style.height = '300px';
  await expect.poll(() => controller.getSnapshot().height).toBe(250);
  controller.setZoom(1.5);
  detach();
  controller.attach(host);
  const current = controller.getSnapshot();
  detach();
  page.dispatchEvent(new Event('scroll'));
  expect(controller.getSnapshot()).toBe(current);
  expect(current).toMatchObject({ height: 160, inset: 24, zoom: 1.5, scrollTop: 0 });
  controller.scrollTo(90);
  expect(host.scrollport.scrollTop).toBe(90);
  expect(controller.getSnapshot().scrollTop).toBe(90);
});

test('destruction during publication releases observation and prevents revival', async ({
  onTestFinished,
}) => {
  const host = embedded();
  onTestFinished(() => host.remove());
  const controller = createEditorViewport();
  let publications = 0;
  controller.subscribe(() => {
    publications++;
    controller.destroy();
  });
  const detach = controller.attach(host);
  expect(publications).toBe(1);
  host.scrollport.style.height = '200px';
  host.scrollport.dispatchEvent(new Event('scroll'));
  await new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
  expect(publications).toBe(1);
  detach();
  controller.destroy();
  expect(() => controller.attach(host)).toThrow(/destroyed/);
  expect(() => controller.setZoom(2)).toThrow(/destroyed/);
  expect(() => controller.scrollTo(100)).toThrow(/destroyed/);
  expect(() => controller.subscribe(() => {})).toThrow(/destroyed/);
});
