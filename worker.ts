interface AssetFetcher {
  fetch(input: Request | string | URL, init?: RequestInit): Promise<Response>;
}

export interface KernedEnv {
  ASSETS: AssetFetcher;
}

export default {
  async fetch(request: Request, env: KernedEnv): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/editor' || url.pathname === '/editor/') {
      url.pathname = '/editor.html';

      return Response.redirect(url, 302);
    }

    return env.ASSETS.fetch(request);
  },
};
