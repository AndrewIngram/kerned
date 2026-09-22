/** Adapter contracts use a typed contribution key; core never imports the adapter. */
type ContributionSession = { readonly isDestroyed: boolean };

type ContributionScope = {
  phase: 'setup' | 'installed' | 'disposed';
  onDestroy: (cleanup: () => void) => void;
};

const scopes = new WeakMap<ContributionSession, ContributionScope>();

const install = Symbol('installContribution');

const empty = Object.freeze([]);

export type ExtensionContribution<Value> = {
  readonly [install]: (scope: ContributionScope, value: Value) => void;
  read(editor: ContributionSession): readonly Value[];
};

export type ContributionContext = {
  provide<Value>(
    this: void,
    contribution: ExtensionContribution<Value>,
    value: NoInfer<Value>,
  ): void;
};

/** Define a package's contribution contract once. Values remain local to each session. */
export function defineContribution<Value>(): ExtensionContribution<Value> {
  const values = new WeakMap<ContributionScope, readonly Value[]>();

  return Object.freeze({
    [install](scope: ContributionScope, value: Value) {
      if (scope.phase !== 'setup')
        throw new Error('Contributions can only be provided during setup');
      const previous = values.get(scope);

      if (!previous) scope.onDestroy(() => values.delete(scope));
      values.set(scope, Object.freeze([...(previous ?? []), value]));
    },
    read(editor: ContributionSession) {
      const scope = scopes.get(editor);

      if (!scope || editor.isDestroyed || scope.phase !== 'installed')
        throw new Error('Contributions require a live composed editor session');

      return values.get(scope) ?? empty;
    },
  });
}

/** Private session assembly. Setup runs once and is sealed before adapters can read it. */
export function createContributions(onDestroy: ContributionScope['onDestroy']) {
  const scope: ContributionScope = { phase: 'setup', onDestroy };

  const context: ContributionContext = {
    provide(contribution, value) {
      contribution[install](scope, value);
    },
  };

  return {
    context,
    dispose() {
      scope.phase = 'disposed';
    },
    attach(editor: ContributionSession) {
      if (scope.phase !== 'setup') throw new Error('Contribution assembly is already closed');
      scope.phase = 'installed';
      scopes.set(editor, scope);
      onDestroy(() => scopes.delete(editor));
    },
  };
}
