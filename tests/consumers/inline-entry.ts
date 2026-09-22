import { mountInlineConsumer } from './inline.js';

const host = document.querySelector<HTMLElement>('#editor');

if (!host) throw new Error('Missing inline consumer host');

const { editor, view } = mountInlineConsumer(host);

await view.ready;

host.dataset.ready = 'ready';

window.addEventListener('pagehide', () => editor.destroy(), { once: true });
