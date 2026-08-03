import { Hono } from "hono";
import type { AppBindings } from "@/types";
import health from "./health";
import events from "./events";
import workouts from "./workouts";
import exercises from "./exercises";
import habits from "./habits";
import reminders from "./reminders";
import planner from "./planner";
import analytics from "./analytics";
import push from "./push";
import auth from "./auth";
import { authMiddleware } from "@/middleware/auth";
import gmail from "./gmail";
import calendarCrm from "./calendar-crm";
import privacy from "./privacy";

/**
 * Aggregated API router. All sub-routes are mounted under /api.
 */
const routes = new Hono<AppBindings>();

// Public routes (no auth required)
routes.route("/health", health);
routes.route("/auth", auth);
routes.route("/events", events);
routes.route("/workouts", workouts);
routes.route("/exercises", exercises);
routes.route("/habits", habits);
routes.route("/reminders", reminders);
routes.route("/planner", planner);
routes.route("/analytics", analytics);
routes.route("/push", push);

// Protected CRM routes (require authenticated session)
routes.use("/gmail", authMiddleware);
routes.use("/gmail/*", authMiddleware);
routes.route("/gmail", gmail);
routes.use("/calendar-crm", authMiddleware);
routes.use("/calendar-crm/*", authMiddleware);
routes.route("/calendar-crm", calendarCrm);
routes.use("/privacy", authMiddleware);
routes.use("/privacy/*", authMiddleware);
routes.route("/privacy", privacy);

export default routes;
