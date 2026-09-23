interface AssetFetcher {
  fetch(input: Request | string | URL, init?: RequestInit): Promise<Response>;
}

export interface KernedEnv {
  ASSETS: AssetFetcher;
}

export default {
  async fetch(request: Request, env: KernedEnv): Promise<Response> {
    return env.ASSETS.fetch(request);
  },
};
