import assert from 'node:assert/strict';

const baseURL = process.env.BASE_URL ?? 'http://127.0.0.1:5173';

import { chromium, firefox, webkit } from 'playwright';

for (const name of (process.env.BROWSERS ?? 'chromium,firefox,webkit').split(',')) {
  const browser = await { chromium, firefox, webkit }[name].launch();

  try {
    const page = await browser.newPage();
    await page.routeWebSocket(
      (url) => url.pathname === '/',
      () => {},
    );
    await page.goto(`${baseURL}/editor.html`);

    const result = await page.evaluate(async () => {
      const { createSchema, defineNode, createEditor, textSelection } = Object.assign(
        {},
        await import('/@id/@kerned/model'),
        await import('/@id/@kerned/state'),
      );

      let reads = 0,
        checks = 0;

      const check = (ok, message) => {
        if (!ok) throw new Error(message);
        checks++;
      };

      const { z } = await import('/node_modules/zod/index.js');

      const compiled = createSchema({
        extensions: [
          defineNode({
            name: 'text',
            version: 1,
            options: {},
            schema: () => ({
              attributes: z.strictObject({ text: z.string(), bold: z.boolean().optional() }),
              content: { kind: 'text', field: 'text' },
            }),
          }),
          defineNode({
            name: 'group',
            version: 1,
            options: {},
            schema: () => ({
              attributes: z.strictObject({}),
              content: { kind: 'container', field: 'children' },
            }),
          }),
        ],
      });

      const schema = {
        ...compiled,
        text(node) {
          reads++;

          return compiled.text(node);
        },
      };

      const leaf = (id, text) => ({ id, key: `text-${id}`, kind: 'text', text });
      const group = (id, children) => ({ id, key: `group-${id}`, kind: 'group', children });

      const editor = createEditor(
        schema,
        [
          leaf(1, 'Idea ideas IDEA'),
          group(20, [leaf(2, 'ideas [.*]'), group(21, [leaf(3, 'Last idea')])]),
        ],
        textSelection(1, 2),
      );

      const original = editor.state;
      const state = editor.find.setQuery('idea');
      check(
        state.matches.length === 5 && state.activeIndex === 0,
        'Nested document order and default case folding',
      );
      check(state.matches.map((m) => m.id).join(',') === '1,1,1,2,3', 'Tree-order navigation');
      check(editor.find.previous().active.id === 3, 'Previous wraps to the final match');
      check(editor.find.next().active.from === 0, 'Next wraps to the first match');
      check(
        editor.state === original && editor.history.undo === 0,
        'Find leaves selection, revision and history unchanged',
      );
      const beforeReads = reads;
      void editor.find.state;
      void editor.find.state;
      editor.find.next();
      check(reads === beforeReads, 'Repeated reads and navigation do not scan text');
      check(
        editor.find.setQuery('[.*]').matches.length === 1,
        'Regular expression metacharacters are literal',
      );
      check(editor.find.setQuery('idea', { matchCase: true }).matches.length === 3, 'Match case');
      editor.find.setQuery('idea', { matchCase: false });
      editor.find.next();

      const before = editor.find.state,
        first = editor.state.nodes[0];

      const dispatch = (steps) =>
        editor.dispatch({
          baseRevision: editor.state.revision,
          origin: 'local',
          history: 'separate',
          time: 0,
          steps,
        });

      dispatch([{ kind: 'updateBlock', node: { ...first, bold: true } }]);
      check(
        editor.find.state === before,
        'Formatting reuses match objects and the complete snapshot',
      );
      editor.select(textSelection(1, 1));
      const afterSelect = reads;
      void editor.find.state;
      check(reads === afterSelect, 'Selection-only changes do not rescan');
      dispatch([{ kind: 'replaceText', id: 2, from: 0, to: 5, text: 'nothing' }]);
      check(
        editor.find.state.matches.length === 4 && editor.find.state.active === before.active,
        'Editing updates results and preserves unaffected current match',
      );
      editor.undo();
      check(editor.find.state.matches.length === 5, 'Undo refreshes results');
      editor.redo();
      check(editor.find.state.matches.length === 4, 'Redo refreshes results');
      editor.dispatch({
        baseRevision: editor.state.revision,
        origin: 'stream',
        history: 'exclude',
        steps: [{ kind: 'append', nodes: [leaf(4, 'idea')] }],
      });
      check(editor.find.state.matches.length === 5, 'Stream append refreshes results');
      editor.find.previous();
      editor.find.previous();
      dispatch([{ kind: 'removeChildren', parent: null, index: 2, count: 1 }]);
      check(
        editor.find.state.active !== null && editor.find.state.active.id !== 4,
        'Removing current result chooses a surviving result',
      );
      check(
        editor.find.setQuery('missing').active === null && editor.find.next().activeIndex === -1,
        'No results have no active match',
      );
      editor.find.clear();
      const cleared = reads;
      void editor.find.state;
      check(
        reads === cleared && editor.find.state.matches.length === 0,
        'Empty query performs no text scan',
      );

      const unicode = createEditor(
        schema,
        [leaf(1, 'İx 𐐀x e\u0301 👩‍👩‍👧‍👦 Σ σ ς')],
        textSelection(1, 0),
      );

      check(
        unicode.find
          .setQuery('x')
          .matches.map((m) => m.from)
          .join(',') === '1,5',
        'Original UTF-16 offsets survive case-insensitive search',
      );
      check(
        unicode.find.setQuery('𐐨').active.to - unicode.find.state.active.from === 2,
        'Astral case folding',
      );
      check(
        unicode.find.setQuery('e').matches.length === 0,
        'Matches cannot end inside a grapheme',
      );
      check(
        unicode.find.setQuery('\u0301').matches.length === 0,
        'Matches cannot start inside a grapheme',
      );
      check(
        unicode.find.setQuery('e\u0301').matches.length === 1,
        'Complete combining sequence matches',
      );
      check(unicode.find.setQuery('👩').matches.length === 0, 'Joined emoji stay intact');
      check(unicode.find.setQuery('👩‍👩‍👧‍👦').matches.length === 1, 'Complete emoji sequence matches');
      check(unicode.find.setQuery('σ').matches.length === 3, 'Unicode simple case folding');
      check(
        unicode.find.setQuery('σ', { matchCase: true }).matches.length === 1,
        'Unicode exact case',
      );
      check(
        [...unicode.find.state.byNode.values()]
          .flat()
          .every((m) => unicode.find.state.matches.includes(m)),
        'Block-local results share the navigation ranges',
      );

      const asyncEditor = createEditor(
        schema,
        Array.from({ length: 2000 }, (_, i) =>
          leaf(i + 1, 'e\u0301 café 👩‍👩‍👧‍👦 test, Pierre. '.repeat(20)),
        ),
        textSelection(1, 0),
      );

      const idle = asyncEditor.state,
        readsBefore = reads;

      let ticks = 0;
      const heartbeat = setInterval(() => ticks++, 1);
      const cold = asyncEditor.find.setQueryAsync('e');
      check(reads === readsBefore, 'Async search does no scanning in the input task');
      const complete = (await cold).state;
      clearInterval(heartbeat);
      check(ticks > 2 && complete.query === 'e', 'A cold search yields to other event-loop tasks');
      check(
        asyncEditor.state === idle && asyncEditor.history.undo === 0,
        'Async search preserves editor state and history',
      );
      check(
        complete.matches.every(
          (m) =>
            idle.nodes[0].text.slice(m.from, m.to) === 'e' && idle.nodes[0].text[m.to] !== '\u0301',
        ),
        'Async results respect grapheme boundaries',
      );
      const old = asyncEditor.find.setQueryAsync(' ');
      await new Promise((resolve) => setTimeout(resolve, 0));
      const latest = asyncEditor.find.setQueryAsync('Pierre');
      check((await old) === null, 'A newer query cancels in-flight work');
      const newest = (await latest).state;
      check(
        newest.query === 'Pierre' &&
          asyncEditor.find.state === newest &&
          newest.matches.length === 40000,
        'Only the latest query publishes',
      );

      const controller = new AbortController(),
        cancelled = asyncEditor.find.setQueryAsync('test', {}, controller.signal);

      controller.abort();
      check(
        (await cancelled) === null && asyncEditor.find.state === newest,
        'Aborted work cannot publish',
      );
      const clearing = asyncEditor.find.setQueryAsync('e');
      asyncEditor.find.clear();
      check(
        (await clearing) === null && asyncEditor.find.state.query === '',
        'Clear cancels pending work',
      );
      const edited = asyncEditor.find.setQueryAsync('Pierre');
      await new Promise((resolve) => setTimeout(resolve, 8));
      asyncEditor.dispatch({
        baseRevision: asyncEditor.state.revision,
        origin: 'local',
        history: 'separate',
        time: 0,
        steps: [{ kind: 'replaceText', id: 1, from: 0, to: 0, text: 'Pierre ' }],
      });
      check((await edited) === null, 'Document changes invalidate an unfinished result');
      const refreshed = (await asyncEditor.find.setQueryAsync('Pierre')).state;
      check(
        refreshed.matches.length === 40001 && refreshed.active.from === 0,
        'Retry searches the current document',
      );
      const superseded = asyncEditor.find.setQueryAsync('caf');
      asyncEditor.find.setQuery('test');
      check(
        (await superseded) === null && asyncEditor.find.state.query === 'test',
        'Synchronous commands supersede asynchronous work',
      );
      asyncEditor.find.clear();
      const extending = asyncEditor.find.setQueryAsync('Pierre');
      await new Promise((resolve) => setTimeout(resolve, 0));
      asyncEditor.dispatch({
        baseRevision: asyncEditor.state.revision,
        origin: 'stream',
        history: 'exclude',
        steps: [{ kind: 'append', nodes: [leaf(2001, 'Pierre')] }],
      });
      const extended = await extending;
      check(
        extended.state.matches.length === 40002 && extended.nodes === asyncEditor.state.nodes,
        'In-flight searches extend to include streamed roots',
      );

      const large = createEditor(
        schema,
        Array.from({ length: 7280 }, (_, i) =>
          leaf(
            i + 1,
            'Warbreaker. This is a paragraph with ideas, ideas, and punctuation. '.repeat(3),
          ),
        ),
        textSelection(1, 0),
      );

      const started = performance.now();
      const found = large.find.setQuery('ideas');
      const searchMs = performance.now() - started;
      check(found.matches.length === 43680, 'Book-size result set is complete');
      const navStarted = performance.now();

      for (let i = 0; i < 1000; i++) large.find.next();

      return {
        checks,
        searchMs,
        navigate1000Ms: performance.now() - navStarted,
        matches: found.matches.length,
      };
    });

    assert.ok(result.searchMs < 500, `${name} find should stay interactive: ${result.searchMs}ms`);
    console.log(name, JSON.stringify(result));
  } finally {
    await browser.close();
  }
}
