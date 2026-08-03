interface AssetBinding {
  fetch(request: Request): Promise<Response>;
}

interface SitesEnvironment {
  ASSETS: AssetBinding;
}

/**
 * Lightweight Cloudflare Worker entry point for the private Sites preview.
 * The product is built as a TanStack SPA, so unknown document routes receive
 * the generated shell while real assets keep their normal cache headers.
 */
const worker = {
  async fetch(request: Request, environment: SitesEnvironment) {
    const assetResponse = await environment.ASSETS.fetch(request);

    if (
      assetResponse.status !== 404 ||
      (request.method !== "GET" && request.method !== "HEAD") ||
      !request.headers.get("accept")?.includes("text/html")
    ) {
      return assetResponse;
    }

    const shellUrl = new URL("/_shell.html", request.url);
    const shellRequest = new Request(shellUrl, {
      headers: request.headers,
      method: "GET",
    });
    const shellResponse = await environment.ASSETS.fetch(shellRequest);
    const headers = new Headers(shellResponse.headers);
    headers.set("cache-control", "no-cache");

    return new Response(
      request.method === "HEAD" ? null : shellResponse.body,
      {
        headers,
        status: shellResponse.status,
        statusText: shellResponse.statusText,
      },
    );
  },
};

export default worker;
