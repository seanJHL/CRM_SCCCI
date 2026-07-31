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

/**
 * Aggregated API router. All sub-routes are mounted under /api.
 */
const routes = new Hono<AppBindings>();

routes.route("/health", health);
routes.route("/events", events);
routes.route("/workouts", workouts);
routes.route("/exercises", exercises);
routes.route("/habits", habits);
routes.route("/reminders", reminders);
routes.route("/planner", planner);
routes.route("/analytics", analytics);
routes.route("/push", push);

export default routes;
