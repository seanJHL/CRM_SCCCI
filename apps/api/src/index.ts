import { createApp } from "./app";
import { handleCron } from "./cron";

// Cloudflare Workers entry point
const app = createApp();

export default {
  fetch: app.fetch,
  scheduled: handleCron,
};
