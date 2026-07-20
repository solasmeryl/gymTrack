import { readFile, writeFile } from "node:fs/promises";

const aliases = {
  "Arnold Press (Dumbbell)": "dumbbell arnold press",
  "Back Extension": "lever back extension",
  "Bench Press (Barbell)": "barbell bench press",
  "Bench Press (Dumbbell)": "dumbbell bench press",
  "Bench Press - Close Grip (Barbell)": "barbell close-grip bench press",
  "Bent Over Row (Barbell)": "barbell bent over row",
  "Bicep Curl (Barbell)": "barbell biceps curl (with arm blaster)",
  "Bicep Curl (Cable)": "cable curl",
  "Bicep Curl (Dumbbell)": "dumbbell biceps curl",
  "Bicep Curl (Machine)": "lever bicep curl",
  "Bulgarian Split Squat": "dumbbell single leg split squat",
  "Cable Crossover": "cable cross-over variation",
  "Chest Fly (Dumbell)": "dumbbell fly",
  "Chest Fly": "lever seated fly",
  "Chest Press (Machine)": "lever chest press",
  "Crunch": "crunch floor",
  "Crunch (Machine)": "lever seated crunch (chest pad)",
  "Cycling (Indoor)": "stationary bike run v. 3",
  "Deadlift (Barbell)": "barbell deadlift",
  "Deadlift (Smith Machine)": "smith deadlift",
  "Decline Crunch": "decline crunch",
  "Front Raise (Cable)": "cable front raise",
  "Face Pull (Cable)": "cable rear delt row (with rope)",
  "Front Raise (Dumbbell)": "dumbbell front raise",
  "Gobbelin Squat": "dumbbell goblet squat",
  "Hack Squat": "sled hack squat",
  "Hammer Curl (Cable)": "cable hammer curl (with rope)",
  "Hammer Curl (Dumbbell)": "dumbbell hammer curl",
  "Hanging Leg Raise": "hanging leg raise",
  "Hip Abductor (Machine)": "lever seated hip abduction",
  "Hip Adductor (Machine)": "lever seated hip adduction",
  "Incline Bench Press (Barbell)": "barbell incline bench press",
  "Incline Bench Press (Dumbbell)": "dumbbell incline bench press",
  "Incline Chest Press (Machine)": "lever incline chest press",
  "Incline chest press (weight loaded)": "lever incline chest press v. 2",
  "Iso-Lateral Row (Machine)": "lever unilateral row",
  "Iso-lateral seated row": "lever seated row",
  "Isolateral Overhead Triceps Extension": "lever triceps extension",
  "KettleBell Swing": "kettlebell swing",
  "Knee Raise (Captain's Chair)": "captains chair straight leg raise",
  "Kneeling Pulldown (Band)": "band kneeling one arm pulldown",
  "Lat Pulldown (Cable)": "cable lat pulldown full range of motion",
  "Lat Pulldown (Machine)": "lever front pulldown",
  "Lat Pulldown (Single Arm)": "cable one arm pulldown",
  "Lateral Raise (Cable)": "cable lateral raise",
  "Lateral Raise (Dumbbell)": "dumbbell lateral raise",
  "Leg Extension (Machine)": "lever leg extension",
  "Leg Press": "sled 45в° leg press",
  "Lunge (Dumbbell)": "dumbbell lunge",
  "Lying Leg Curl (Machine)": "lever lying leg curl",
  "Overhead Press (Barbell)": "barbell standing close grip military press",
  "Overhead Press (Dumbbell)": "dumbbell standing overhead press",
  "Pec Deck (Machine)": "lever seated fly",
  "Preacher Curl (Barbell)": "barbell preacher curl",
  "Preacher Curl (Machine)": "lever preacher curl",
  "Pull Up": "pull-up",
  "Pullover (Dumbbell)": "dumbbell pullover",
  "Pullover (Machine)": "lever pullover",
  "Push Up": "push-up",
  "Reverse Fly (Cable)": "cable standing cross-over high reverse fly",
  "Reverse Fly (Dumbbell)": "dumbbell reverse fly",
  "Reverse Fly (Machine)": "lever seated reverse fly",
  "Romanian Deadlift (Barbell)": "barbell romanian deadlift",
  "Seated Leg Press (Machine)": "sled 45° leg press (side pov)",
  "Seated Overhead Press (Barbell)": "barbell seated overhead press",
  "Seated Overhead Press (Dumbbell)": "dumbbell seated shoulder press",
  "Seated Row (Cable)": "cable seated row",
  "Seated Row (Machine)": "lever seated row",
  "Seated Wide-Grip Row (Cable)": "cable seated wide-grip row",
  "Shoulder Press (Machine)": "lever shoulder press",
  "Shoulder Press (Plate Loaded)": "lever shoulder press v. 3",
  "Shrug (Dumbbell)": "dumbbell shrug",
  "Sit Up": "sit-up v. 2",
  "Squat (Barbell)": "barbell full squat",
  "Squat (Smith Machine)": "smith squat",
  "Standing Calf Raise (Machine)": "lever standing calf raise",
  "T Bar Row": "lever t bar row",
  "Triceps Dip": "triceps dip",
  "Triceps Extension": "cable pushdown (with rope attachment)",
  "Triceps Extension (Cable)": "cable overhead triceps extension (rope attachment)",
  "Triceps Extension (Dumbbell)": "dumbbell standing triceps extension",
  "Triceps Extension (Machine)": "lever triceps extension",
};

const inputPath = process.argv[2];
const outputPath = process.argv[3] || inputPath;
if (!inputPath) throw new Error("Usage: node scripts/migrate-export-exercises.mjs <input.json> [output.json]");

const data = JSON.parse(await readFile(inputPath, "utf8"));
const builtIns = JSON.parse(
  (await readFile(new URL("../exercise-dataset.js", import.meta.url), "utf8")).match(/BUILT_IN_EXERCISES = (.*);\n$/m)[1],
);
const builtInNames = new Set(builtIns.map((exercise) => exercise.name));
for (const [oldName, newName] of Object.entries(aliases)) {
  if (!builtInNames.has(newName)) throw new Error(`Alias target not found: ${oldName} -> ${newName}`);
}

const migrateName = (name) => aliases[name] || (builtInNames.has(name) ? name : name);
(data.workouts || []).forEach((workout) => {
  (workout.exercises || []).forEach((exercise) => { exercise.name = migrateName(exercise.name); });
});
(data.exercises || []).forEach((exercise) => { exercise.name = migrateName(exercise.name); });

const usedNames = new Set((data.workouts || []).flatMap((workout) => workout.exercises || []).map((exercise) => exercise.name));
data.customExercises = [...usedNames].filter((name) => !builtInNames.has(name)).sort((a, b) => a.localeCompare(b));
data.exerciseDataset = {
  repository: "hasaneyldrm/exercises-dataset",
  commit: "7455efae41b330c265e7cd4b78dfa848e7ce5ebd",
};

await writeFile(outputPath, `${JSON.stringify(data, null, 2)}\n`);
console.log(`Migrated ${usedNames.size - data.customExercises.length} built-in names; kept ${data.customExercises.length} custom exercises.`);
if (data.customExercises.length) console.log(`Custom: ${data.customExercises.join(", ")}`);
