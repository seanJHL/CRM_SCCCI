import { Hono } from "hono";
import type { AppBindings } from "@/types";
import health from "./health";
import companies from "./companies";
import contacts from "./contacts";
import deals from "./deals";

/**
 * Aggregated API router. All sub-routes are mounted under /api.
 */
const routes = new Hono<AppBindings>();

routes.route("/health", health);
routes.route("/companies", companies);
routes.route("/contacts", contacts);
routes.route("/deals", deals);

export default routes;
