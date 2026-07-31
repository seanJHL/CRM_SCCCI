import { getApiUrl } from "@/lib/api";

/**
 * Static exercise library embedded in the frontend.
 * Renders instantly without a network call. The API is fetched
 * in the background to pick up any newly added exercises.
 */
export interface StaticExercise {
  id: string;
  name: string;
  category: string;
  equipmentType: string;
  trackingType?: "strength" | "run";
}

/** Category display metadata */
export const EXERCISE_CATEGORIES: Record<string, { label: string; order: number }> = {
  chest: { label: "Chest", order: 0 },
  back: { label: "Back", order: 1 },
  legs: { label: "Legs", order: 2 },
  shoulders_arms: { label: "Shoulders & Arms", order: 3 },
  core: { label: "Core", order: 4 },
  cardio: { label: "Cardio", order: 5 },
  functional: { label: "Functional", order: 6 },
  mobility: { label: "Mobility", order: 7 },
};

/** Popular picks shown at the top of the picker for quick selection */
export const POPULAR_EXERCISE_IDS = [
  "ex-bench-press",
  "ex-back-squat",
  "ex-deadlift",
  "ex-lat-pulldown",
  "ex-overhead-press",
  "ex-leg-press",
  "ex-barbell-row",
  "ex-bicep-curl",
];

export const POPULAR_EXERCISE_NAMES = [
  "Bench Press",
  "Back Squat",
  "Deadlift",
  "Lat Pulldown",
  "Overhead Press",
  "Leg Press",
  "Barbell Row",
  "Barbell Bicep Curl",
];

const EXERCISE_IMAGE_BASES = [
  "https://yuhonas.github.io/free-exercise-db/exercises",
  "https://cdn.jsdelivr.net/gh/yuhonas/free-exercise-db@main/exercises",
  "https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises",
];

/**
 * Public-domain exercise demonstrations from Free Exercise DB.
 * Each directory contains a start frame (0.jpg) and finish frame (1.jpg).
 */
const EXERCISE_IMAGE_DIRECTORIES: Record<string, string> = {
  "Bench Press": "Barbell_Bench_Press_-_Medium_Grip",
  "Incline Bench Press": "Barbell_Incline_Bench_Press_-_Medium_Grip",
  "Dumbbell Fly": "Dumbbell_Flyes",
  "Cable Crossover": "Cable_Crossover",
  "Chest Dip": "Parallel_Bar_Dip",
  "Push-Up": "Pushups",
  "Pec Deck": "Butterfly",
  "Decline Bench Press": "Decline_Barbell_Bench_Press",
  Deadlift: "Barbell_Deadlift",
  "Lat Pulldown": "Wide-Grip_Lat_Pulldown",
  "Barbell Row": "Bent_Over_Barbell_Row",
  "Seated Cable Row": "Seated_Cable_Rows",
  "T-Bar Row": "T-Bar_Row_with_Handle",
  "Pull-Up": "Pullups",
  "Face Pull": "Face_Pull",
  "Single-Arm Dumbbell Row": "One-Arm_Dumbbell_Row",
  "Back Squat": "Barbell_Squat",
  "Leg Press": "Leg_Press",
  "Romanian Deadlift": "Romanian_Deadlift",
  "Lying Leg Curl": "Lying_Leg_Curls",
  "Leg Extension": "Leg_Extensions",
  "Standing Calf Raise": "Standing_Calf_Raises",
  "Walking Lunges": "Barbell_Walking_Lunge",
  "Hip Thrust": "Barbell_Hip_Thrust",
  "Bulgarian Split Squat": "Split_Squat_with_Dumbbells",
  "Hack Squat": "Hack_Squat",
  "Overhead Press": "Barbell_Shoulder_Press",
  "Lateral Raise": "Side_Lateral_Raise",
  "Barbell Bicep Curl": "Barbell_Curl",
  "Tricep Rope Pushdown": "Triceps_Pushdown_-_Rope_Attachment",
  "Hammer Curl": "Alternate_Hammer_Curl",
  "Skull Crusher":
    "Lying_Close-Grip_Barbell_Triceps_Extension_Behind_The_Head",
  "Front Raise": "Front_Dumbbell_Raise",
  "Reverse Pec Deck": "Reverse_Flyes",
  "Preacher Curl": "Preacher_Curl",
  "Overhead Tricep Extension": "Standing_Dumbbell_Triceps_Extension",
  Plank: "Plank",
  "Hanging Leg Raise": "Hanging_Leg_Raise",
  "Cable Woodchop": "Standing_Cable_Wood_Chop",
  "Ab Rollout": "Ab_Roller",
  "Russian Twist": "Russian_Twist",
  "Decline Sit-Up": "Decline_Crunch",
  "Treadmill Run": "Running_Treadmill",
  "Outdoor Run": "Trail_Running_Walking",
  "Treadmill Walk": "Walking_Treadmill",
  "Stationary Bike": "Bicycling_Stationary",
  "Rowing Machine": "Rowing_Stationary",
  Elliptical: "Elliptical_Trainer",
  "Stair Climber": "Stairmaster",
  "Jump Rope": "Rope_Jumping",
  "Assault Bike": "Air_Bike",
  "Kettlebell Swing": "One-Arm_Kettlebell_Swings",
  "Box Jump": "Front_Box_Jump",
  "Battle Ropes": "Battling_Ropes",
  "Sled Push": "Sled_Push",
  "Farmer's Walk": "Farmers_Walk",
  "Medicine Ball Slam": "One-Arm_Medicine_Ball_Slam",
  "Foam Rolling": "Quadriceps-SMR",
  "Hip Flexor Stretch": "Kneeling_Hip_Flexor",
  "Shoulder Dislocates": "Shoulder_Circles",
  "90/90 Stretch": "90_90_Hamstring",
};

/**
 * The database also contains concise equipment-label variants of several
 * exercises. Point those names at the closest matching demonstration instead
 * of falling back to the missing-image placeholder.
 */
const EXERCISE_IMAGE_ALIASES: Record<string, string> = {
  "Assisted pull-up": "Band_Assisted_Pull-Up",
  "Seated row": "Seated_Cable_Rows",
  Bike: "Bicycling_Stationary",
  Rower: "Rowing_Stationary",
  Treadmill: "Running_Treadmill",
  "Cable fly": "Cable_Crossover",
  "Chest press": "Leverage_Chest_Press",
  "Incline press": "Leverage_Incline_Chest_Press",
  "Leg curl": "Seated_Leg_Curl",
  "Biceps curl": "Barbell_Curl",
  "Shoulder press": "Leverage_Shoulder_Press",
  "Triceps pushdown": "Triceps_Pushdown",
};

const NORMALIZED_EXERCISE_IMAGE_DIRECTORIES = Object.freeze(
  Object.fromEntries(
    [
      ...Object.entries(EXERCISE_IMAGE_DIRECTORIES),
      ...Object.entries(EXERCISE_IMAGE_ALIASES),
    ].map(([name, directory]) => [name.trim().toLowerCase(), directory]),
  ),
);

function getExerciseImageDirectory(exerciseName: string) {
  return NORMALIZED_EXERCISE_IMAGE_DIRECTORIES[
    exerciseName.trim().toLowerCase()
  ];
}

export function getExerciseImageUrls(exerciseName: string) {
  const directory = getExerciseImageDirectory(exerciseName);
  if (!directory) return [];
  return [
    `${EXERCISE_IMAGE_BASES[0]}/${directory}/0.jpg`,
    `${EXERCISE_IMAGE_BASES[0]}/${directory}/1.jpg`,
  ];
}

export function getExerciseImageCandidates(
  exerciseName: string,
  frame: 0 | 1,
) {
  const directory = getExerciseImageDirectory(exerciseName);
  if (!directory) return [];
  return [
    getApiUrl(
      `/api/exercises/images/${encodeURIComponent(directory)}/${frame}`,
    ),
    ...EXERCISE_IMAGE_BASES.map(
      (base) => `${base}/${directory}/${frame}.jpg`,
    ),
  ];
}

/** Full static exercise database – 61 exercises */
export const STATIC_EXERCISES: StaticExercise[] = [
  // ── Chest (8) ──────────────────────────────────────────────────────────────
  { id: "ex-bench-press", name: "Bench Press", category: "chest", equipmentType: "free_weight" },
  { id: "ex-incline-bench", name: "Incline Bench Press", category: "chest", equipmentType: "free_weight" },
  { id: "ex-dumbbell-fly", name: "Dumbbell Fly", category: "chest", equipmentType: "free_weight" },
  { id: "ex-cable-crossover", name: "Cable Crossover", category: "chest", equipmentType: "machine" },
  { id: "ex-chest-dip", name: "Chest Dip", category: "chest", equipmentType: "bodyweight" },
  { id: "ex-push-up", name: "Push-Up", category: "chest", equipmentType: "bodyweight" },
  { id: "ex-pec-deck", name: "Pec Deck", category: "chest", equipmentType: "machine" },
  { id: "ex-decline-bench", name: "Decline Bench Press", category: "chest", equipmentType: "free_weight" },

  // ── Back (8) ───────────────────────────────────────────────────────────────
  { id: "ex-deadlift", name: "Deadlift", category: "back", equipmentType: "free_weight" },
  { id: "ex-lat-pulldown", name: "Lat Pulldown", category: "back", equipmentType: "machine" },
  { id: "ex-barbell-row", name: "Barbell Row", category: "back", equipmentType: "free_weight" },
  { id: "ex-seated-cable-row", name: "Seated Cable Row", category: "back", equipmentType: "machine" },
  { id: "ex-tbar-row", name: "T-Bar Row", category: "back", equipmentType: "machine" },
  { id: "ex-pull-up", name: "Pull-Up", category: "back", equipmentType: "bodyweight" },
  { id: "ex-face-pull", name: "Face Pull", category: "back", equipmentType: "machine" },
  { id: "ex-single-arm-db-row", name: "Single-Arm Dumbbell Row", category: "back", equipmentType: "free_weight" },

  // ── Legs (10) ──────────────────────────────────────────────────────────────
  { id: "ex-back-squat", name: "Back Squat", category: "legs", equipmentType: "free_weight" },
  { id: "ex-leg-press", name: "Leg Press", category: "legs", equipmentType: "machine" },
  { id: "ex-romanian-deadlift", name: "Romanian Deadlift", category: "legs", equipmentType: "free_weight" },
  { id: "ex-lying-leg-curl", name: "Lying Leg Curl", category: "legs", equipmentType: "machine" },
  { id: "ex-leg-extension", name: "Leg Extension", category: "legs", equipmentType: "machine" },
  { id: "ex-standing-calf-raise", name: "Standing Calf Raise", category: "legs", equipmentType: "machine" },
  { id: "ex-walking-lunges", name: "Walking Lunges", category: "legs", equipmentType: "free_weight" },
  { id: "ex-hip-thrust", name: "Hip Thrust", category: "legs", equipmentType: "free_weight" },
  { id: "ex-bulgarian-split-squat", name: "Bulgarian Split Squat", category: "legs", equipmentType: "free_weight" },
  { id: "ex-hack-squat", name: "Hack Squat", category: "legs", equipmentType: "machine" },

  // ── Shoulders & Arms (10) ──────────────────────────────────────────────────
  { id: "ex-overhead-press", name: "Overhead Press", category: "shoulders_arms", equipmentType: "free_weight" },
  { id: "ex-lateral-raise", name: "Lateral Raise", category: "shoulders_arms", equipmentType: "free_weight" },
  { id: "ex-bicep-curl", name: "Barbell Bicep Curl", category: "shoulders_arms", equipmentType: "free_weight" },
  { id: "ex-tricep-rope-pushdown", name: "Tricep Rope Pushdown", category: "shoulders_arms", equipmentType: "machine" },
  { id: "ex-hammer-curl", name: "Hammer Curl", category: "shoulders_arms", equipmentType: "free_weight" },
  { id: "ex-skull-crusher", name: "Skull Crusher", category: "shoulders_arms", equipmentType: "free_weight" },
  { id: "ex-front-raise", name: "Front Raise", category: "shoulders_arms", equipmentType: "free_weight" },
  { id: "ex-reverse-pec-deck", name: "Reverse Pec Deck", category: "shoulders_arms", equipmentType: "machine" },
  { id: "ex-preacher-curl", name: "Preacher Curl", category: "shoulders_arms", equipmentType: "machine" },
  { id: "ex-overhead-tricep-ext", name: "Overhead Tricep Extension", category: "shoulders_arms", equipmentType: "free_weight" },

  // ── Core (6) ───────────────────────────────────────────────────────────────
  { id: "ex-plank", name: "Plank", category: "core", equipmentType: "bodyweight" },
  { id: "ex-hanging-leg-raise", name: "Hanging Leg Raise", category: "core", equipmentType: "bodyweight" },
  { id: "ex-cable-woodchop", name: "Cable Woodchop", category: "core", equipmentType: "machine" },
  { id: "ex-ab-rollout", name: "Ab Rollout", category: "core", equipmentType: "free_weight" },
  { id: "ex-russian-twist", name: "Russian Twist", category: "core", equipmentType: "bodyweight" },
  { id: "ex-decline-sit-up", name: "Decline Sit-Up", category: "core", equipmentType: "machine" },

  // ── Cardio (9) ─────────────────────────────────────────────────────────────
  { id: "ex-outdoor-run", name: "Outdoor Run", category: "cardio", equipmentType: "outdoor", trackingType: "run" },
  { id: "ex-treadmill-run", name: "Treadmill Run", category: "cardio", equipmentType: "cardio", trackingType: "run" },
  { id: "ex-treadmill-walk", name: "Treadmill Walk", category: "cardio", equipmentType: "cardio" },
  { id: "ex-stationary-bike", name: "Stationary Bike", category: "cardio", equipmentType: "cardio" },
  { id: "ex-rowing-machine", name: "Rowing Machine", category: "cardio", equipmentType: "cardio" },
  { id: "ex-elliptical", name: "Elliptical", category: "cardio", equipmentType: "cardio" },
  { id: "ex-stair-climber", name: "Stair Climber", category: "cardio", equipmentType: "cardio" },
  { id: "ex-jump-rope", name: "Jump Rope", category: "cardio", equipmentType: "bodyweight" },
  { id: "ex-assault-bike", name: "Assault Bike", category: "cardio", equipmentType: "cardio" },

  // ── Functional (6) ─────────────────────────────────────────────────────────
  { id: "ex-kettlebell-swing", name: "Kettlebell Swing", category: "functional", equipmentType: "free_weight" },
  { id: "ex-box-jump", name: "Box Jump", category: "functional", equipmentType: "bodyweight" },
  { id: "ex-battle-ropes", name: "Battle Ropes", category: "functional", equipmentType: "free_weight" },
  { id: "ex-sled-push", name: "Sled Push", category: "functional", equipmentType: "machine" },
  { id: "ex-farmers-walk", name: "Farmer's Walk", category: "functional", equipmentType: "free_weight" },
  { id: "ex-med-ball-slam", name: "Medicine Ball Slam", category: "functional", equipmentType: "free_weight" },

  // ── Mobility (4) ───────────────────────────────────────────────────────────
  { id: "ex-foam-rolling", name: "Foam Rolling", category: "mobility", equipmentType: "bodyweight" },
  { id: "ex-hip-flexor-stretch", name: "Hip Flexor Stretch", category: "mobility", equipmentType: "bodyweight" },
  { id: "ex-shoulder-dislocates", name: "Shoulder Dislocates", category: "mobility", equipmentType: "free_weight" },
  { id: "ex-9090-stretch", name: "90/90 Stretch", category: "mobility", equipmentType: "bodyweight" },
];
