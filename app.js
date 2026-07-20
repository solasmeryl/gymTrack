import { BUILT_IN_EXERCISES, EXERCISE_DATASET } from "./exercise-dataset.js";

const STORAGE_KEY = "gymtrack:data:v1";
const EXERCISE_STORAGE_KEY = "gymtrack:exercises:v1";
const ACTIVE_STORAGE_KEY = "gymtrack:active:v1";
const LEGACY_STORAGE_KEY = "openstrong:data:v1";
const LEGACY_EXERCISE_STORAGE_KEY = "openstrong:exercises:v1";
const LEGACY_ACTIVE_STORAGE_KEY = "openstrong:active:v1";
const WORKOUT_NOTIFICATION_ID = 1001;
const EXERCISE_LIST_LIMIT = 100;

const state = {
  tab: "start",
  data: loadStoredData(),
  selectedWorkoutId: null,
  selectedExercise: "",
  search: "",
  workoutFilter: "all",
  exerciseSort: "name",
  exerciseDetailOpen: false,
  exercisePickerSearch: "",
  exerciseCategory: "all",
  exercisePickerCategory: "all",
  activeWorkout: loadActiveWorkout(),
  customExercises: loadCustomExercises(),
  toast: "",
};

const app = document.querySelector("#app");
let timerInterval = null;
let notificationTextCache = "";
let notificationUpdateInFlight = false;
let notificationPermissionBlocked = false;
let setIdCounter = Date.now();
const nativePersistTimers = new Map();
let prIndexSource = null;
let prIndex = new Map();

const navItems = [
  { id: "start", label: "Workout", icon: "W" },
  { id: "history", label: "History", icon: "H" },
  { id: "exercises", label: "Exercises", icon: "E" },
  { id: "progress", label: "Progress", icon: "P" },
  { id: "import", label: "Import", icon: "I" },
];

function loadStoredData() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY)) || null;
  } catch {
    return null;
  }
}

function loadActiveWorkout() {
  try {
    return JSON.parse(localStorage.getItem(ACTIVE_STORAGE_KEY) || localStorage.getItem(LEGACY_ACTIVE_STORAGE_KEY)) || null;
  } catch {
    return null;
  }
}

function loadCustomExercises() {
  try {
    return JSON.parse(localStorage.getItem(EXERCISE_STORAGE_KEY) || localStorage.getItem(LEGACY_EXERCISE_STORAGE_KEY)) || [];
  } catch {
    return [];
  }
}

function saveCustomExercises() {
  state.customExercises = [...new Set(state.customExercises.map((name) => name.trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));
  localStorage.setItem(EXERCISE_STORAGE_KEY, JSON.stringify(state.customExercises));
  persistNative(EXERCISE_STORAGE_KEY, state.customExercises);
}

const builtInExerciseByName = new Map(
  BUILT_IN_EXERCISES.map((exercise) => [exercise.name.toLocaleLowerCase(), exercise]),
);

function getBuiltInExercise(name) {
  return builtInExerciseByName.get(String(name || "").trim().toLocaleLowerCase()) || null;
}

function canonicalExerciseName(name) {
  const cleanName = String(name || "").trim() || "Unknown exercise";
  return getBuiltInExercise(cleanName)?.name || cleanName;
}

function registerCustomExercises(workouts, importedCustomExercises = []) {
  const customNames = new Map(state.customExercises.map((name) => [name.toLocaleLowerCase(), name]));
  const candidates = [
    ...importedCustomExercises,
    ...workouts.flatMap((workout) => (workout.exercises || []).map((exercise) => exercise.name)),
  ];
  candidates.forEach((name) => {
    const cleanName = String(name || "").trim();
    if (cleanName && !getBuiltInExercise(cleanName) && !customNames.has(cleanName.toLocaleLowerCase())) {
      customNames.set(cleanName.toLocaleLowerCase(), cleanName);
    }
  });
  state.customExercises = [...customNames.values()];
  saveCustomExercises();
}

function normalizeWorkoutExerciseNames(workouts) {
  workouts.forEach((workout) => {
    (workout.exercises || []).forEach((exercise) => {
      exercise.name = canonicalExerciseName(exercise.name);
    });
  });
  return workouts;
}

function migrateLoadedExerciseData() {
  const workouts = state.data?.workouts || [];
  const activeWorkouts = state.activeWorkout ? [state.activeWorkout] : [];
  if (workouts.length) {
    const importedAt = state.data.importedAt;
    normalizeWorkoutExerciseNames(workouts);
    registerCustomExercises(workouts);
    state.data = buildDataModel(workouts);
    state.data.importedAt = importedAt;
  }
  if (activeWorkouts.length) normalizeWorkoutExerciseNames(activeWorkouts);
}

migrateLoadedExerciseData();

function saveData(data) {
  state.data = data;
  prIndexSource = null;
  prIndex = new Map();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  persistNative(STORAGE_KEY, data);
}

function saveActiveWorkout() {
  if (state.activeWorkout) {
    localStorage.setItem(ACTIVE_STORAGE_KEY, JSON.stringify(state.activeWorkout));
    persistNative(ACTIVE_STORAGE_KEY, state.activeWorkout);
  } else {
    localStorage.removeItem(ACTIVE_STORAGE_KEY);
    removeNative(ACTIVE_STORAGE_KEY);
  }
}

function persistNative(key, value) {
  if (!window.Capacitor?.Plugins?.Preferences?.set) return;
  window.clearTimeout(nativePersistTimers.get(key));
  nativePersistTimers.set(key, window.setTimeout(() => {
    persistNativeNow(key, value);
    nativePersistTimers.delete(key);
  }, 1200));
}

function persistNativeNow(key, value) {
  window.Capacitor?.Plugins?.Preferences?.set?.({
    key,
    value: JSON.stringify(value),
  }).catch(() => {});
}

function removeNative(key) {
  window.Capacitor?.Plugins?.Preferences?.remove?.({ key }).catch(() => {});
}

function flushStorage() {
  nativePersistTimers.forEach((timer) => window.clearTimeout(timer));
  nativePersistTimers.clear();
  if (state.data) localStorage.setItem(STORAGE_KEY, JSON.stringify(state.data));
  localStorage.setItem(EXERCISE_STORAGE_KEY, JSON.stringify(state.customExercises));
  if (state.activeWorkout) {
    localStorage.setItem(ACTIVE_STORAGE_KEY, JSON.stringify(state.activeWorkout));
  }
  if (state.data) persistNativeNow(STORAGE_KEY, state.data);
  persistNativeNow(EXERCISE_STORAGE_KEY, state.customExercises);
  if (state.activeWorkout) persistNativeNow(ACTIVE_STORAGE_KEY, state.activeWorkout);
}

async function restoreNativeBackup() {
  const preferences = window.Capacitor?.Plugins?.Preferences;
  if (!preferences) return;
  const [data, exercises, active] = await Promise.all([
    state.data ? null : preferences.get({ key: STORAGE_KEY }),
    state.customExercises.length ? null : preferences.get({ key: EXERCISE_STORAGE_KEY }),
    state.activeWorkout ? null : preferences.get({ key: ACTIVE_STORAGE_KEY }),
  ]);

  let changed = false;
  if (!state.data && data?.value) {
    state.data = JSON.parse(data.value);
    localStorage.setItem(STORAGE_KEY, data.value);
    changed = true;
  }
  if (!state.customExercises.length && exercises?.value) {
    state.customExercises = JSON.parse(exercises.value);
    localStorage.setItem(EXERCISE_STORAGE_KEY, exercises.value);
    changed = true;
  }
  if (!state.activeWorkout && active?.value) {
    state.activeWorkout = normalizeActiveWorkout(JSON.parse(active.value));
    localStorage.setItem(ACTIVE_STORAGE_KEY, active.value);
    changed = true;
  }
  if (changed) {
    render();
    if (state.activeWorkout && !state.activeWorkout.editingWorkoutId) showWorkoutNotification();
  }
}

async function showWorkoutNotification() {
  await updateWorkoutNotification({ force: true });
}

async function ensureNotificationPermission() {
  if (notificationPermissionBlocked) return false;
  const notifications = window.Capacitor?.Plugins?.LocalNotifications;
  if (!notifications) return true;
  const permission = await notifications.checkPermissions();
  if (permission.display === "granted") return true;
  const requested = await notifications.requestPermissions();
  if (requested.display === "granted") return true;
  notificationPermissionBlocked = true;
  return false;
}

function getWorkoutNotificationPayload() {
  const workout = state.activeWorkout;
  if (!workout || workout.editingWorkoutId) return null;
  const workoutTime = formatClock(elapsedSince(workout.startedAt));
  const recoveryTime = workout.recoveryStartedAt ? formatClock(elapsedSince(workout.recoveryStartedAt)) : "0:00";
  const recoveryLabel = "Recovery";
  return {
    title: workout.name || "Workout running",
    body: `Workout ${workoutTime} | Recovery ${recoveryTime}`,
    largeBody: `Workout ${workoutTime}\nRecovery ${recoveryTime}\n${recoveryLabel}`,
    workoutStartedAt: new Date(workout.startedAt).getTime(),
    recoveryStartedAt: workout.recoveryStartedAt ? new Date(workout.recoveryStartedAt).getTime() : 0,
    recoveryLabel,
  };
}

function nextSetId() {
  setIdCounter += 1;
  return `set-${setIdCounter}`;
}

function activeSet(set = {}) {
  return {
    id: set.id || nextSetId(),
    weight: toNumber(set.weight),
    reps: toNumber(set.reps),
    rpe: toNumber(set.rpe),
    distance: toNumber(set.distance),
    seconds: toNumber(set.seconds),
    notes: set.notes || "",
    finishedAt: set.finishedAt || "",
  };
}

function clearRecoveryIfSet(set) {
  if (!state.activeWorkout || !set) return;
  if (state.activeWorkout.recoverySetId === set.id) {
    state.activeWorkout.recoveryStartedAt = "";
    state.activeWorkout.recoverySetId = "";
    state.activeWorkout.recoverySetLabel = "";
    showWorkoutNotification();
  }
}

function clearRecoveryIfExercise(exercise) {
  if (!state.activeWorkout || !exercise?.sets?.length) return;
  if (exercise.sets.some((set) => set.id === state.activeWorkout.recoverySetId)) {
    state.activeWorkout.recoveryStartedAt = "";
    state.activeWorkout.recoverySetId = "";
    state.activeWorkout.recoverySetLabel = "";
    showWorkoutNotification();
  }
}

async function updateWorkoutNotification(options = {}) {
  if (
    notificationPermissionBlocked ||
    !state.activeWorkout ||
    state.activeWorkout.editingWorkoutId
  ) {
    return;
  }
  const payload = getWorkoutNotificationPayload();
  if (!payload) return;
  const cacheKey = JSON.stringify({
    title: payload.title,
    workoutStartedAt: payload.workoutStartedAt,
    recoveryStartedAt: payload.recoveryStartedAt,
    recoveryLabel: payload.recoveryLabel,
  });
  if (!options.force && (notificationUpdateInFlight || cacheKey === notificationTextCache)) return;
  notificationUpdateInFlight = true;
  try {
    const hasPermission = await ensureNotificationPermission();
    if (!hasPermission) return;
    const nativeWorkoutNotification = window.Capacitor?.Plugins?.WorkoutNotification;
    if (nativeWorkoutNotification) {
      try {
        await nativeWorkoutNotification.show(payload);
      } catch (error) {
        console.error(error);
        await scheduleFallbackWorkoutNotification(payload);
      }
    } else {
      await scheduleFallbackWorkoutNotification(payload);
    }
    notificationTextCache = cacheKey;
  } catch (error) {
    console.error(error);
  } finally {
    notificationUpdateInFlight = false;
  }
}

async function scheduleFallbackWorkoutNotification(payload) {
  const notifications = window.Capacitor?.Plugins?.LocalNotifications;
  if (!notifications) return;
  await notifications.schedule({
    notifications: [
      {
        id: WORKOUT_NOTIFICATION_ID,
        title: payload.title,
        body: payload.body,
        largeBody: payload.largeBody,
        summaryText: "GymTrack",
        ongoing: true,
        autoCancel: false,
      },
    ],
  });
}

async function clearWorkoutNotification() {
  const notifications = window.Capacitor?.Plugins?.LocalNotifications;
  const nativeWorkoutNotification = window.Capacitor?.Plugins?.WorkoutNotification;
  notificationTextCache = "";
  notificationPermissionBlocked = false;
  try {
    await nativeWorkoutNotification?.clear?.();
    await notifications?.cancel?.({
      notifications: [{ id: WORKOUT_NOTIFICATION_ID }],
    });
  } catch (error) {
    console.error(error);
  }
}

function saveWorkouts(workouts) {
  const data = buildDataModel(workouts);
  if (state.data?.importedAt) data.importedAt = state.data.importedAt;
  saveData(data);
}

function getExerciseCatalog() {
  return [...new Set([...BUILT_IN_EXERCISES.map((exercise) => exercise.name), ...state.customExercises])]
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
}

function getExerciseCategories() {
  return [...new Set(BUILT_IN_EXERCISES.map((exercise) => exercise.bodyPart).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));
}

function getExerciseStats(name) {
  const definition = getBuiltInExercise(name);
  const stats = state.data?.exercises.find((exercise) => exercise.name === name) || {
    name,
    sessions: 0,
    sets: 0,
    volume: 0,
    bestWeight: 0,
    bestE1rm: 0,
    history: [],
  };
  return { ...stats, definition };
}

function getLastExerciseSet(name) {
  const workouts = state.data?.workouts || [];
  for (const workout of workouts) {
    const exercise = workout.exercises.find((item) => item.name === name);
    const lastSet = exercise?.sets?.slice().reverse().find((set) => set.weight || set.weight === 0 || set.reps);
    if (lastSet) {
      return {
        weight: toNumber(lastSet.weight),
        reps: toNumber(lastSet.reps),
      };
    }
  }
  return { weight: 0, reps: 0 };
}

function getExercisePickerResults(query = "") {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return getExerciseCatalog()
    .map((name) => ({ name, stats: getExerciseStats(name), definition: getBuiltInExercise(name) }))
    .filter(({ name, definition }) => {
      if (state.exercisePickerCategory === "custom" && definition) return false;
      if (state.exercisePickerCategory !== "all" && state.exercisePickerCategory !== "custom" && definition?.bodyPart !== state.exercisePickerCategory) return false;
      const searchable = `${name} ${definition?.target || ""} ${definition?.equipment || ""} ${definition?.bodyPart || ""}`.toLocaleLowerCase();
      return terms.every((term) => searchable.includes(term));
    })
    .sort((a, b) => b.stats.sessions - a.stats.sessions || a.name.localeCompare(b.name))
    .slice(0, 20);
}

function getFilteredExercises() {
  const query = state.search.trim().toLocaleLowerCase();
  return getExerciseCatalog()
    .map(getExerciseStats)
    .filter((exercise) => {
      if (state.exerciseCategory === "custom" && exercise.definition) return false;
      if (state.exerciseCategory !== "all" && state.exerciseCategory !== "custom" && exercise.definition?.bodyPart !== state.exerciseCategory) return false;
      return exercise.name.toLocaleLowerCase().includes(query);
    })
    .sort((a, b) => state.exerciseSort === "sessions"
      ? b.sessions - a.sessions || a.name.localeCompare(b.name)
      : a.name.localeCompare(b.name));
}

function renderExerciseRows(exercises = getFilteredExercises()) {
  const visible = exercises.slice(0, EXERCISE_LIST_LIMIT);
  const rows = visible.map((exercise) => `
    <button class="exercise-row" data-select-exercise="${escapeAttr(exercise.name)}">
      <span class="exercise-title">${escapeHtml(exercise.name)}</span>
      <span class="meta-line">
        <span>${exercise.sessions}x</span>
        ${exercise.bestE1rm ? `<span>Best ${exercise.bestE1rm.toFixed(1)} kg</span>` : ""}
        <span>${exercise.definition ? escapeHtml(exercise.definition.target) : "Custom"}</span>
      </span>
    </button>
  `).join("");
  if (!rows) return `<div class="empty">No matching exercises.</div>`;
  const remaining = exercises.length - visible.length;
  return `${rows}${remaining > 0 ? `<div class="exercise-list-note">${remaining.toLocaleString()} more — search or choose a category to narrow the list.</div>` : ""}`;
}

function renderExercisePickerResults(query = state.exercisePickerSearch) {
  const results = getExercisePickerResults(query);
  return results.length
    ? results.map(({ name, stats, definition }) => `
        <button class="exercise-picker-result" type="button" data-pick-exercise="${escapeAttr(name)}">
          <span>${escapeHtml(name)}</span>
          <small>${stats.sessions ? `${stats.sessions} sessions` : escapeHtml(definition?.target || "Custom")}</small>
        </button>
      `).join("")
    : `<div class="empty small">No matching exercise.</div>`;
}

function parseWorkoutCsv(text) {
  const rows = parseDelimited(text.trim());
  const header = rows.shift();
  const index = Object.fromEntries(header.map((name, i) => [name, i]));
  const byWorkout = new Map();

  rows.forEach((row) => {
    const workoutNo = row[index["Workout #"]];
    const date = row[index.Date];
    const id = `${workoutNo}-${date}`;
    const exerciseName = row[index["Exercise Name"]] || "Unknown exercise";
    const set = {
      order: toNumber(row[index["Set Order"]]),
      weight: toNumber(row[index["Weight (kg)"]]),
      reps: toNumber(row[index.Reps]),
      rpe: toNumber(row[index.RPE]),
      distance: toNumber(row[index["Distance (meters)"]]),
      seconds: toNumber(row[index.Seconds]),
      notes: row[index.Notes] || "",
    };

    if (!byWorkout.has(id)) {
      byWorkout.set(id, {
        id,
        sourceWorkoutNo: workoutNo,
        name: row[index["Workout Name"]] || "Workout",
        date,
        durationSec: toNumber(row[index["Duration (sec)"]]),
        notes: row[index["Workout Notes"]] || "",
        exercises: [],
      });
    }

    const workout = byWorkout.get(id);
    let exercise = workout.exercises.find((item) => item.name === exerciseName);
    if (!exercise) {
      exercise = { name: exerciseName, sets: [] };
      workout.exercises.push(exercise);
    }
    exercise.sets.push(set);
  });

  const workouts = [...byWorkout.values()]
    .map((workout) => ({
      ...workout,
      exercises: workout.exercises.map((exercise) => ({
        ...exercise,
        sets: exercise.sets.sort((a, b) => a.order - b.order),
      })),
    }))
    .sort((a, b) => new Date(b.date) - new Date(a.date));

  return buildDataModel(workouts);
}

function parseDelimited(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"' && inQuotes && next === '"') {
      cell += '"';
      i += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ";" && !inQuotes) {
      row.push(cell);
      cell = "";
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") i += 1;
      row.push(cell);
      if (row.some((value) => value !== "")) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }

  row.push(cell);
  if (row.some((value) => value !== "")) rows.push(row);
  return rows;
}

function buildDataModel(workouts) {
  normalizeWorkoutExerciseNames(workouts);
  const exercises = new Map();

  workouts.forEach((workout) => {
    workout.totalSets = 0;
    workout.volume = 0;
    workout.exercises.forEach((exercise) => {
      workout.totalSets += exercise.sets.length;
      exercise.sets.forEach((set, index) => {
        set.order = toNumber(set.order) || index + 1;
        set.weight = toNumber(set.weight);
        set.reps = toNumber(set.reps);
        set.rpe = toNumber(set.rpe);
        set.distance = toNumber(set.distance);
        set.seconds = toNumber(set.seconds);
        set.notes ||= "";
        workout.volume += set.weight * set.reps;
      });

      if (!exercises.has(exercise.name)) {
        exercises.set(exercise.name, {
          name: exercise.name,
          sessions: 0,
          sets: 0,
          volume: 0,
          bestWeight: 0,
          bestE1rm: 0,
          history: [],
        });
      }

      const item = exercises.get(exercise.name);
      const volume = exercise.sets.reduce((sum, set) => sum + set.weight * set.reps, 0);
      const bestSet = exercise.sets.reduce((best, set) => {
        const e1rm = estimateOneRepMax(set.weight, set.reps);
        return e1rm > best.e1rm ? { ...set, e1rm } : best;
      }, { e1rm: 0 });

      item.sessions += 1;
      item.sets += exercise.sets.length;
      item.volume += volume;
      item.bestWeight = Math.max(item.bestWeight, ...exercise.sets.map((set) => set.weight), 0);
      item.bestE1rm = Math.max(item.bestE1rm, bestSet.e1rm);
      item.history.push({
        workoutId: workout.id,
        date: workout.date,
        workoutName: workout.name,
        sets: exercise.sets.length,
        volume,
        bestWeight: bestSet.weight || 0,
        bestReps: bestSet.reps || 0,
        e1rm: bestSet.e1rm || 0,
      });
    });
  });

  const exerciseList = [...exercises.values()]
    .map((exercise) => ({
      ...exercise,
      history: exercise.history.sort((a, b) => new Date(a.date) - new Date(b.date)),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    importedAt: new Date().toISOString(),
    workouts,
    exercises: exerciseList,
  };
}

function toNumber(value) {
  const number = Number.parseFloat(value);
  return Number.isFinite(number) ? number : 0;
}

function estimateOneRepMax(weight, reps) {
  if (!weight || !reps) return 0;
  return weight * (1 + reps / 30);
}

function getWorkoutPrs(workout) {
  if (!state.data || !workout) return [];
  return getPrIndex().get(workout.id) || [];
}

function getPrIndex() {
  if (!state.data) return prIndex;
  if (prIndexSource === state.data) return prIndex;

  const nextIndex = new Map();
  const bestByExercise = new Map();
  const sorted = state.data.workouts
    .slice()
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  for (let i = 0; i < sorted.length;) {
    const workoutTime = new Date(sorted[i].date).getTime();
    const sameTime = [];
    while (i < sorted.length && new Date(sorted[i].date).getTime() === workoutTime) {
      sameTime.push(sorted[i]);
      i += 1;
    }

    sameTime.forEach((workout) => {
      const prs = [];
      workout.exercises.forEach((exercise) => {
        const previous = bestByExercise.get(exercise.name) || { e1rm: 0, weight: 0 };
        collectExercisePrs(exercise, previous).forEach((pr) => prs.push(pr));
      });
      nextIndex.set(workout.id, prs);
    });

    sameTime.forEach((workout) => {
      workout.exercises.forEach((exercise) => {
        const bestSet = getBestSet(exercise.sets);
        const bestWeight = Math.max(0, ...exercise.sets.map((set) => toNumber(set.weight)));
        const previous = bestByExercise.get(exercise.name) || { e1rm: 0, weight: 0 };
        bestByExercise.set(exercise.name, {
          e1rm: Math.max(previous.e1rm, bestSet.e1rm || 0),
          weight: Math.max(previous.weight, bestWeight),
        });
      });
    });
  }

  prIndexSource = state.data;
  prIndex = nextIndex;
  return prIndex;
}

function collectExercisePrs(exercise, previous) {
  const prs = [];
  const bestSet = exercise.sets.reduce((best, set) => {
    const e1rm = estimateOneRepMax(set.weight, set.reps);
    return e1rm > best.e1rm ? { ...set, e1rm } : best;
  }, { e1rm: 0, weight: 0, reps: 0 });
  const bestWeight = Math.max(0, ...exercise.sets.map((set) => set.weight || 0));

  if (bestSet.e1rm > previous.e1rm) {
    prs.push({
      exercise: exercise.name,
      type: "e1RM",
      value: `${bestSet.e1rm.toFixed(1)} kg`,
    });
  }
  if (bestWeight > previous.weight) {
    prs.push({
      exercise: exercise.name,
      type: "Weight",
      value: `${bestWeight.toFixed(1)} kg`,
    });
  }
  return prs;
}

function getBestSet(sets) {
  return sets.reduce((best, set) => {
    const e1rm = estimateOneRepMax(set.weight, set.reps);
    return e1rm > best.e1rm ? { ...set, e1rm } : best;
  }, { e1rm: 0, weight: 0, reps: 0 });
}

function getRecentPrs(limit = 8) {
  if (!state.data) return [];
  return state.data.workouts
    .flatMap((workout) =>
      getWorkoutPrs(workout).map((pr) => ({
        ...pr,
        workoutId: workout.id,
        workoutName: workout.name,
        date: workout.date,
      })),
    )
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, limit);
}

function getExerciseEntryPrs(exercise, entry) {
  const entryTime = new Date(entry.date).getTime();
  const previousEntries = exercise.history.filter(
    (item) => new Date(item.date).getTime() < entryTime,
  );
  const previousBestE1rm = Math.max(0, ...previousEntries.map((item) => item.e1rm || 0));
  const previousBestWeight = Math.max(0, ...previousEntries.map((item) => item.bestWeight || 0));
  const prs = [];
  if ((entry.e1rm || 0) > previousBestE1rm) {
    prs.push({ exercise: exercise.name, type: "e1RM", value: `${entry.e1rm.toFixed(1)} kg` });
  }
  if ((entry.bestWeight || 0) > previousBestWeight) {
    prs.push({ exercise: exercise.name, type: "Weight", value: `${entry.bestWeight.toFixed(1)} kg` });
  }
  return prs;
}

function renderPrBadges(prs, limit = 3) {
  if (!prs.length) return "";
  const shown = prs.slice(0, limit);
  const extra = prs.length - shown.length;
  return `
    <div class="pr-badges">
      ${shown
        .map((pr) => `<span class="pr-chip"><strong>${escapeHtml(pr.exercise)}</strong><span>${escapeHtml(pr.type)} ${escapeHtml(pr.value)}</span></span>`)
        .join("")}
      ${extra > 0 ? `<span class="pr-chip more">+${extra}</span>` : ""}
    </div>
  `;
}

function renderPrList(prs) {
  if (!prs.length) return "";
  return `
    <div class="pr-list">
      ${prs
        .map(
          (pr) => `
            <div class="pr-row">
              <span>${escapeHtml(pr.exercise)}</span>
              <strong>${escapeHtml(pr.type)} ${escapeHtml(pr.value)}</strong>
            </div>
          `,
        )
        .join("")}
    </div>
  `;
}

function formatDate(value) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

function formatDateTime(value) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function toDateTimeLocalValue(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function fromDateTimeLocalValue(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function formatDuration(seconds) {
  if (!seconds) return "0m";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function formatClock(seconds) {
  const safeSeconds = Math.max(0, Math.floor(seconds || 0));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const secs = safeSeconds % 60;
  if (hours) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }
  return `${minutes}:${String(secs).padStart(2, "0")}`;
}

function formatSetValue(value) {
  return Number.isFinite(Number(value)) ? String(value) : "";
}

function formatSetInputValue(value) {
  return Number.isFinite(Number(value)) ? String(value) : "";
}

function kg(value) {
  return `${Math.round(value).toLocaleString()} kg`;
}

function render(options = {}) {
  const previousScrollTop = options.preserveScroll
    ? document.querySelector(".main")?.scrollTop
    : null;
  const data = state.data;
  app.innerHTML = `
    <div class="app-shell">
      <aside class="sidebar">
        <div class="brand-row">
          <div class="brand-mark">GT</div>
          <div class="brand-copy">
            <strong>GymTrack</strong>
            <span>Workout log</span>
          </div>
        </div>
        <nav class="nav-list">${renderNav()}</nav>
        <div class="sidebar-card">
          <strong>${data ? `${data.workouts.length} workouts imported` : "No data yet"}</strong>
          <div class="sidebar-meta">${data ? `Last import ${formatDate(data.importedAt)}` : "Import a workout CSV to begin."}</div>
        </div>
      </aside>
      <main class="main">
        ${renderTopbar()}
        ${renderCurrentTab()}
      </main>
      <nav class="bottom-nav">${renderNav()}</nav>
      ${state.toast ? `<div class="toast">${escapeHtml(state.toast)}</div>` : ""}
    </div>
  `;

  bindEvents();
  drawVisibleChart();
  syncTimerInterval();

  if (previousScrollTop !== null && previousScrollTop !== undefined) {
    const main = document.querySelector(".main");
    if (main) main.scrollTop = previousScrollTop;
  }
}

function renderNav() {
  return navItems
    .map(
      (item) => `
      <button class="nav-button ${state.tab === item.id ? "active" : ""}" data-tab="${item.id}" title="${item.label}">
        <span class="nav-icon">${item.icon}</span>
        <span>${item.label}</span>
      </button>
    `,
    )
    .join("");
}

function renderTopbar() {
  const titles = {
    start: [state.activeWorkout ? "Active Workout" : "Start Workout", state.activeWorkout ? "Your workout is still running" : "Templates from your recent sessions"],
    history: ["History", "Every imported and logged workout"],
    exercises: ["Exercises", "Lift history and personal records"],
    progress: ["Progress", "Trends by exercise"],
    import: ["Import", "Bring in workout CSV exports"],
  };
  const [title, kicker] = titles[state.tab];
  const actions = [];
  if (state.tab === "start" && !state.activeWorkout) {
    actions.push(`<button class="button primary" data-action="start-empty">Start Empty</button>`);
  }
  if (state.tab !== "start" && state.activeWorkout) {
    actions.push(`<button class="button primary" data-tab="start">Resume</button>`);
  }
  return `
    <header class="topbar">
      <div>
        <h1 class="page-title">${title}</h1>
        <p class="page-kicker">${kicker}</p>
      </div>
      ${actions.length ? `<div class="actions">${actions.join("")}</div>` : ""}
    </header>
  `;
}

function renderStats(data) {
  const totalVolume = data.workouts.reduce((sum, workout) => sum + workout.volume, 0);
  const totalSets = data.workouts.reduce((sum, workout) => sum + workout.totalSets, 0);
  const latest = data.workouts[0];
  return `
    <section class="stats-grid">
      ${statCard("Workouts", data.workouts.length.toLocaleString())}
      ${statCard("Exercises", getExerciseCatalog().length.toLocaleString())}
      ${statCard("Total Volume", kg(totalVolume))}
      ${statCard("Latest", latest ? formatDate(latest.date) : "-")}
    </section>
    <div class="small muted">${totalSets.toLocaleString()} logged sets</div>
  `;
}

function statCard(label, value) {
  return `<div class="stat-card"><div class="stat-label">${label}</div><div class="stat-value">${value}</div></div>`;
}

function renderCurrentTab() {
  if (!state.data && state.tab !== "import" && state.tab !== "exercises" && state.tab !== "start") return renderImport(true);

  switch (state.tab) {
    case "history":
      return renderHistory();
    case "exercises":
      return renderExercises();
    case "progress":
      return renderProgress();
    case "import":
      return renderImport(false);
    default:
      if (state.activeWorkout) return renderActiveWorkout();
      return renderStart();
  }
}

function renderStart() {
  if (!state.data) return renderImport(true);
  const routines = getRoutines();
  return `
    <section class="stack">
      <div class="section-head">
        <h2>Routines</h2>
        <span class="pill green">${routines.length} templates</span>
      </div>
      <div class="routine-grid">
        ${routines
          .map(
            (routine) => `
            <article class="routine-card">
              <div>
                <h3>${escapeHtml(routine.name)}</h3>
                <div class="meta-line">
                  <span>${routine.timesPerformed} times</span>
                  <span>${routine.exercises.length} exercises</span>
                  <span>${routine.totalSets} sets</span>
                </div>
              </div>
              <div class="routine-exercises">
                ${routine.exercises
                  .map((item) => `<span>${escapeHtml(item.name)}</span>`)
                  .join("")}
              </div>
              <button class="button primary" data-start-routine="${escapeAttr(routine.id)}">Start Routine</button>
            </article>
          `,
          )
          .join("")}
      </div>
    </section>
  `;
}

function getRoutines() {
  const seen = new Set();
  const counts = state.data.workouts.reduce((acc, workout) => {
    const key = workout.name.toLowerCase();
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  return state.data.workouts
    .filter((workout) => {
      const key = workout.name.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((workout) => ({
      ...workout,
      timesPerformed: counts[workout.name.toLowerCase()] || 1,
    }))
    .slice(0, 12);
}

function renderHistory() {
  const workouts = getFilteredWorkouts();
  const selected = state.data.workouts.find((workout) => workout.id === state.selectedWorkoutId) || workouts[0];
  return `
    <section class="grid-two">
      ${selected ? renderWorkoutDetail(selected) : ""}
      <div>
        <div class="toolbar">
          <input class="field" data-input="search" placeholder="Search workouts" value="${escapeAttr(state.search)}" />
          <select class="select" data-input="workout-filter">
            <option value="all" ${state.workoutFilter === "all" ? "selected" : ""}>All workouts</option>
            ${[...new Set(state.data.workouts.map((workout) => workout.name))]
              .sort()
              .map((name) => `<option value="${escapeAttr(name)}" ${state.workoutFilter === name ? "selected" : ""}>${escapeHtml(name)}</option>`)
              .join("")}
          </select>
        </div>
        <div class="stack">${workouts.map(renderWorkoutRow).join("") || `<div class="empty">No matching workouts.</div>`}</div>
      </div>
    </section>
  `;
}

function getFilteredWorkouts() {
  const query = state.search.trim().toLowerCase();
  return state.data.workouts.filter((workout) => {
    const matchesFilter = state.workoutFilter === "all" || workout.name === state.workoutFilter;
    const haystack = `${workout.name} ${workout.exercises.map((item) => item.name).join(" ")}`.toLowerCase();
    return matchesFilter && (!query || haystack.includes(query));
  });
}

function renderWorkoutRow(workout) {
  const prs = getWorkoutPrs(workout);
  return `
    <button class="workout-row" data-select-workout="${escapeAttr(workout.id)}">
      <span>
        <span class="workout-title">${escapeHtml(workout.name)}</span>
        <span class="meta-line">
          <span>${formatDate(workout.date)}</span>
          <span>${workout.exercises.length} exercises</span>
          ${prs.length ? `<span class="pr-text">${prs.length} PR</span>` : ""}
        </span>
      </span>
      <span class="pill blue">${kg(workout.volume)}</span>
    </button>
  `;
}

function renderWorkoutDetail(workout) {
  const prs = getWorkoutPrs(workout);
  return `
    <aside class="detail-panel">
      <div class="detail-header">
        <h2>${escapeHtml(workout.name)}</h2>
        <div class="meta-line">
          <span>${formatDateTime(workout.date)}</span>
          <span>${formatDuration(workout.durationSec)}</span>
          <span>${kg(workout.volume)}</span>
        </div>
      </div>
      <div class="detail-body">
        <div class="actions" style="justify-content:flex-start">
          <button class="button primary" data-edit-workout="${escapeAttr(workout.id)}">Edit</button>
          <button class="button danger" data-delete-workout="${escapeAttr(workout.id)}">Delete</button>
        </div>
        ${renderPrList(prs)}
        ${workout.notes ? `<div class="card">${escapeHtml(workout.notes)}</div>` : ""}
        ${workout.exercises.map(renderExerciseBlock).join("")}
      </div>
    </aside>
  `;
}

function renderExerciseBlock(exercise) {
  return `
    <div class="exercise-block">
      <div class="exercise-block-header">
        <strong>${escapeHtml(exercise.name)}</strong>
        <span class="pill">${exercise.sets.length} sets</span>
      </div>
      <table class="set-table">
        <thead><tr><th>Set</th><th>kg</th><th>Reps</th><th>RPE</th></tr></thead>
        <tbody>
          ${exercise.sets
            .map(
              (set) => `
              <tr>
                <td>${set.order || ""}</td>
                <td>${formatSetValue(set.weight)}</td>
                <td>${set.reps || ""}</td>
                <td>${set.rpe || ""}</td>
              </tr>
            `,
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderExercises() {
  const exercises = getFilteredExercises();
  const selected = state.exerciseDetailOpen
    ? exercises.find((exercise) => exercise.name === state.selectedExercise)
    : null;
  return `
    <section class="stack">
      <div>
        <div class="card create-exercise-card">
          <input class="field" data-new-catalog-exercise placeholder="New exercise name" />
          <button class="button primary" data-action="add-catalog-exercise">Add</button>
        </div>
        <div class="toolbar">
          <input class="field" data-input="search" placeholder="Search exercises" value="${escapeAttr(state.search)}" />
          <select class="select" data-input="exercise-category">
            <option value="all">All categories</option>
            ${getExerciseCategories().map((category) => `<option value="${escapeAttr(category)}" ${state.exerciseCategory === category ? "selected" : ""}>${escapeHtml(category)}</option>`).join("")}
            <option value="custom" ${state.exerciseCategory === "custom" ? "selected" : ""}>Custom</option>
          </select>
          <select class="select" data-input="exercise-sort">
            <option value="name" ${state.exerciseSort === "name" ? "selected" : ""}>Name</option>
            <option value="sessions" ${state.exerciseSort === "sessions" ? "selected" : ""}>Times performed</option>
          </select>
        </div>
        <div class="stack" data-exercise-list>
          ${renderExerciseRows(exercises)}
        </div>
      </div>
      ${
        selected
          ? `<div class="exercise-detail-overlay">
              <div class="exercise-detail-toolbar">
                <button class="button" data-action="close-exercise-detail" aria-label="Back to exercise list">← Exercises</button>
              </div>
              ${renderExerciseDetail(selected)}
            </div>`
          : ""
      }
    </section>
  `;
}

function renderExerciseDetail(exercise) {
  const hasHistory = exercise.history.length > 0;
  const definition = exercise.definition || getBuiltInExercise(exercise.name);
  return `
    <aside class="detail-panel">
      <div class="detail-header">
        <div class="exercise-detail-heading">
          ${definition ? `<img class="exercise-thumbnail" src="${escapeAttr(`${EXERCISE_DATASET.mediaRoot}/${definition.image}`)}" alt="${escapeAttr(exercise.name)} demonstration" loading="lazy" />` : `<div class="exercise-thumbnail custom-thumbnail" aria-hidden="true">C</div>`}
          <div>
            <h2>${escapeHtml(exercise.name)}</h2>
            ${definition ? `<div class="exercise-tags"><span class="pill green">${escapeHtml(definition.bodyPart)}</span><span class="pill">${escapeHtml(definition.equipment)}</span><span class="pill blue">${escapeHtml(definition.target)}</span></div>` : `<span class="pill">Custom exercise</span>`}
          </div>
        </div>
        <div class="meta-line">
          <span>${exercise.sessions} sessions</span>
          <span>${exercise.sets} sets</span>
          <span>Best e1RM ${exercise.bestE1rm.toFixed(1)} kg</span>
        </div>
      </div>
      <div class="detail-body">
        ${
          definition
            ? `<section class="exercise-guide">
                <div class="exercise-animation-wrap">
                  <img class="exercise-animation" src="${escapeAttr(`${EXERCISE_DATASET.mediaRoot}/${definition.animation}`)}" alt="Animated demonstration of ${escapeAttr(exercise.name)}" loading="eager" />
                </div>
                <div class="section-head"><h3>How to do it</h3></div>
                <ol>${definition.steps.map((step) => `<li>${escapeHtml(step)}</li>`).join("")}</ol>
                ${definition.secondaryMuscles.length ? `<p class="small muted"><strong>Also works:</strong> ${escapeHtml(definition.secondaryMuscles.join(", "))}</p>` : ""}
                <a class="media-attribution" href="https://gymvisual.com/" target="_blank" rel="noopener noreferrer">${escapeHtml(EXERCISE_DATASET.attribution)}</a>
              </section>`
            : ""
        }
        ${hasHistory ? `<div class="chart-wrap"><canvas id="exerciseChart"></canvas></div>` : `<div class="empty">No logged sets yet.</div>`}
        <div class="stack">
          ${exercise.history
            .slice()
            .reverse()
            .slice(0, 12)
            .map(
              (entry) => `
              <button class="workout-row" data-select-workout="${escapeAttr(entry.workoutId)}" data-go-history="true">
                <span>
                  <span class="workout-title">${formatDate(entry.date)}</span>
                  <span class="meta-line">
                    <span>${escapeHtml(entry.workoutName)}</span>
                    <span>${entry.sets} sets</span>
                  </span>
                  ${renderPrBadges(getExerciseEntryPrs(exercise, entry), 2)}
                </span>
                <span class="pill blue">${entry.e1rm.toFixed(1)} kg</span>
              </button>
            `,
            )
            .join("")}
        </div>
      </div>
    </aside>
  `;
}

function renderProgress() {
  const exercises = state.data?.exercises || [];
  const selected = exercises.find((exercise) => exercise.name === state.selectedExercise) || exercises[0];
  const recentPrs = getRecentPrs(8);
  return `
    <section class="stack">
      ${state.data ? renderStats(state.data) : ""}
      ${
        recentPrs.length
          ? `
            <div class="card">
              <div class="section-head">
                <h2>Recent PRs</h2>
              </div>
              <div class="pr-list">
                ${recentPrs
                  .map(
                    (pr) => `
                      <button class="pr-row button-row" data-select-workout="${escapeAttr(pr.workoutId)}" data-go-history="true">
                        <span>${escapeHtml(pr.exercise)}</span>
                        <strong>${escapeHtml(pr.type)} ${escapeHtml(pr.value)}</strong>
                        <small>${formatDate(pr.date)}</small>
                      </button>
                    `,
                  )
                  .join("")}
              </div>
            </div>
          `
          : ""
      }
      ${
        state.data
          ? `
            <div class="card">
              <div class="section-head">
                <h2>Workouts per week</h2>
                <span class="pill">13 weeks</span>
              </div>
              <div class="chart-wrap bar-chart"><canvas id="weeklyWorkoutChart"></canvas></div>
            </div>
          `
          : ""
      }
      <div class="toolbar">
        <select class="select" data-input="selected-exercise">
          ${exercises
            .map((exercise) => `<option value="${escapeAttr(exercise.name)}" ${selected?.name === exercise.name ? "selected" : ""}>${escapeHtml(exercise.name)}</option>`)
            .join("")}
        </select>
      </div>
      ${selected ? renderExerciseDetail(selected) : `<div class="empty">Import data to see progress.</div>`}
    </section>
  `;
}

function renderImport(isFirstRun) {
  return `
    <section class="grid-two">
      <div class="card">
        <div class="section-head">
          <h2>Import Data</h2>
          ${state.data ? `<span class="pill green">${state.data.workouts.length} workouts loaded</span>` : ""}
        </div>
        <div class="import-box">
          <label class="button file-button">
            Choose CSV or JSON
            <input type="file" accept=".csv,.json,text/csv,application/json" data-input="csv-file" />
          </label>
          <div class="actions" style="justify-content:flex-start">
            ${state.data ? `<button class="button danger" data-action="clear-data">Clear data</button>` : ""}
          </div>
          <div class="small muted">Import a workout CSV or a GymTrack JSON export.</div>
          <div class="small muted">${EXERCISE_DATASET.uniqueNames.toLocaleString()} built-in exercises from ${EXERCISE_DATASET.count.toLocaleString()} source records are always available.</div>
        </div>
      </div>
      <div class="card">
        <h2>${isFirstRun ? "Ready when your export is" : "Storage"}</h2>
        <p class="muted">Data stays on this device. JSON export/import is useful for backups or moving phones.</p>
        <div class="actions" style="justify-content:flex-start">
          <button class="button" data-action="export-json">Export JSON</button>
        </div>
      </div>
    </section>
  `;
}

function renderActiveWorkout() {
  const workout = state.activeWorkout;
  const isEditing = Boolean(workout.editingWorkoutId);
  const workoutClock = isEditing ? formatClock(workout.durationSec) : formatClock(elapsedSince(workout.startedAt));
  return `
    <section class="active-workout">
      <div class="sticky-timer-strip">
        <div class="mini-timer">
          <span>${isEditing ? "Duration" : "Workout"}</span>
          <strong data-workout-timer>${workoutClock}</strong>
        </div>
        <div class="mini-timer recovery">
          <span>Recovery</span>
          <strong data-recovery-timer>${workout.recoveryStartedAt ? formatClock(elapsedSince(workout.recoveryStartedAt)) : "0:00"}</strong>
        </div>
      </div>
      <div class="detail-panel">
        <div class="detail-header">
          <input class="field" data-active-name value="${escapeAttr(workout.name)}" />
        </div>
        <div class="detail-body">
          ${
            isEditing
              ? `
                <div class="card edit-meta-card">
                  <label>
                    <span class="field-label">Date and time</span>
                    <input class="field" type="datetime-local" data-active-date value="${escapeAttr(toDateTimeLocalValue(workout.date))}" />
                  </label>
                  <label>
                    <span class="field-label">Duration (min)</span>
                    <input class="field" type="number" min="0" step="1" data-active-duration value="${Math.round((workout.durationSec || 0) / 60)}" />
                  </label>
                </div>
              `
              : ""
          }
          ${workout.exercises.map(renderActiveExercise).join("")}
          <div class="card">
            <div class="exercise-picker">
              <select class="select" data-exercise-picker-category>
                <option value="all">All categories</option>
                ${getExerciseCategories().map((category) => `<option value="${escapeAttr(category)}" ${state.exercisePickerCategory === category ? "selected" : ""}>${escapeHtml(category)}</option>`).join("")}
                <option value="custom" ${state.exercisePickerCategory === "custom" ? "selected" : ""}>Custom</option>
              </select>
              <div class="add-exercise-grid">
                <input class="field" type="search" data-new-exercise autocomplete="off" placeholder="Search exercise, muscle, or equipment" value="${escapeAttr(state.exercisePickerSearch)}" />
                <button class="button primary" data-action="add-exercise">Add</button>
              </div>
              <div class="exercise-picker-results" data-exercise-picker-results>
                ${renderExercisePickerResults()}
              </div>
            </div>
          </div>
          <textarea class="textarea" data-active-notes placeholder="Workout notes">${escapeHtml(workout.notes || "")}</textarea>
          <div class="actions" style="justify-content:flex-start">
            <button class="button primary" data-action="finish-workout">${isEditing ? "Save Changes" : "Finish"}</button>
            <button class="button danger" data-action="discard-workout">${isEditing ? "Cancel" : "Discard"}</button>
          </div>
        </div>
      </div>
    </section>
  `;
}

function renderActiveExercise(exercise, exerciseIndex) {
  return `
    <div class="exercise-block">
      <div class="exercise-block-header">
        <strong>${escapeHtml(exercise.name)}</strong>
        <div class="exercise-actions">
          <button class="button compact icon-button move-button move-up" data-move-exercise="${exerciseIndex}:-1" title="Move exercise up" aria-label="Move exercise up" ${exerciseIndex === 0 ? "disabled" : ""}></button>
          <button class="button compact icon-button move-button move-down" data-move-exercise="${exerciseIndex}:1" title="Move exercise down" aria-label="Move exercise down" ${exerciseIndex === state.activeWorkout.exercises.length - 1 ? "disabled" : ""}></button>
          <button class="button compact icon-button remove-exercise-button danger" data-remove-exercise="${exerciseIndex}" title="Remove exercise" aria-label="Remove exercise"></button>
        </div>
      </div>
      <div class="detail-body">
        ${exercise.sets
          .map(
            (set, setIndex) => `
            <div class="active-set-grid ${set.finishedAt ? "finished" : ""}">
              <span class="pill">Set ${setIndex + 1}</span>
              <input class="field" type="number" inputmode="decimal" autocomplete="off" autocorrect="off" spellcheck="false" step="0.5" data-set-weight="${exerciseIndex}:${setIndex}" value="${formatSetInputValue(set.weight)}" placeholder="kg" />
              <input class="field" type="number" inputmode="numeric" autocomplete="off" autocorrect="off" spellcheck="false" step="1" data-set-reps="${exerciseIndex}:${setIndex}" value="${set.reps || ""}" placeholder="reps" />
              <button class="button compact icon-button done-button ${set.finishedAt ? "done" : ""}" data-toggle-set="${exerciseIndex}:${setIndex}" title="${set.finishedAt ? "Set finished" : "Mark set finished"}" aria-label="${set.finishedAt ? "Set finished" : "Mark set finished"}"></button>
              <button class="button compact icon-button delete-button danger" data-remove-set="${exerciseIndex}:${setIndex}" title="Remove set" aria-label="Remove set"></button>
            </div>
          `,
          )
          .join("")}
        <button class="button" data-add-set="${exerciseIndex}">Add Set</button>
      </div>
    </div>
  `;
}

function bindExerciseSelectionButtons(root = document) {
  root.querySelectorAll("[data-select-exercise]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedExercise = button.dataset.selectExercise;
      state.exerciseDetailOpen = state.tab === "exercises";
      render({ preserveScroll: true });
    });
  });
}

function bindEvents() {
  document.querySelectorAll("[data-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      state.tab = button.dataset.tab;
      state.search = "";
      state.exerciseDetailOpen = false;
      render();
    });
  });

  document.querySelectorAll("[data-action]").forEach((button) => {
    button.addEventListener("click", () => handleAction(button.dataset.action));
  });

  document.querySelectorAll("[data-select-workout]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedWorkoutId = button.dataset.selectWorkout;
      if (button.dataset.goHistory) state.tab = "history";
      render();
    });
  });

  bindExerciseSelectionButtons();

  document.querySelectorAll("[data-edit-workout]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      editWorkout(button.dataset.editWorkout);
    });
  });

  document.querySelectorAll("[data-delete-workout]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      deleteWorkout(button.dataset.deleteWorkout);
    });
  });

  document.querySelectorAll("[data-start-routine]").forEach((button) => {
    button.addEventListener("click", () => startFromRoutine(button.dataset.startRoutine));
  });

  document.querySelectorAll("[data-add-set]").forEach((button) => {
    button.addEventListener("click", () => {
      state.activeWorkout.exercises[Number(button.dataset.addSet)].sets.push(activeSet({ weight: 0, reps: 0 }));
      saveActiveWorkout();
      render({ preserveScroll: true });
    });
  });

  document.querySelectorAll("[data-toggle-set]").forEach((button) => {
    button.addEventListener("click", () => {
      const [exerciseIndex, setIndex] = button.dataset.toggleSet.split(":").map(Number);
      toggleSetFinished(exerciseIndex, setIndex);
    });
  });

  document.querySelectorAll("[data-remove-exercise]").forEach((button) => {
    button.addEventListener("click", () => {
      const [removed] = state.activeWorkout.exercises.splice(Number(button.dataset.removeExercise), 1);
      clearRecoveryIfExercise(removed);
      saveActiveWorkout();
      render({ preserveScroll: true });
    });
  });

  document.querySelectorAll("[data-move-exercise]").forEach((button) => {
    button.addEventListener("click", () => {
      const [index, direction] = button.dataset.moveExercise.split(":").map(Number);
      moveActiveExercise(index, direction);
    });
  });

  document.querySelectorAll("[data-remove-set]").forEach((button) => {
    button.addEventListener("click", () => {
      const [exerciseIndex, setIndex] = button.dataset.removeSet.split(":").map(Number);
      const [removed] = state.activeWorkout.exercises[exerciseIndex].sets.splice(setIndex, 1);
      clearRecoveryIfSet(removed);
      saveActiveWorkout();
      render({ preserveScroll: true });
    });
  });

  document.querySelectorAll("[data-input]").forEach((input) => {
    const eventName = input.tagName === "SELECT" ? "change" : "input";
    input.addEventListener(eventName, () => {
      if (input.dataset.input === "search") {
        state.search = input.value;
        if (state.tab === "exercises") {
          const list = document.querySelector("[data-exercise-list]");
          if (list) {
            list.innerHTML = renderExerciseRows();
            bindExerciseSelectionButtons(list);
          }
          return;
        }
      }
      if (input.dataset.input === "workout-filter") state.workoutFilter = input.value;
      if (input.dataset.input === "exercise-sort") state.exerciseSort = input.value;
      if (input.dataset.input === "exercise-category") state.exerciseCategory = input.value;
      if (input.dataset.input === "selected-exercise") state.selectedExercise = input.value;
      render();
    });
  });

  const fileInput = document.querySelector('[data-input="csv-file"]');
  if (fileInput) {
    fileInput.addEventListener("change", async () => {
      const file = fileInput.files[0];
      if (!file) return;
      importFileText(await file.text(), file.name);
    });
  }

  const catalogExerciseInput = document.querySelector("[data-new-catalog-exercise]");
  if (catalogExerciseInput) {
    catalogExerciseInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") handleAction("add-catalog-exercise");
    });
  }

  bindActiveWorkoutInputs();
}

function bindActiveWorkoutInputs() {
  const name = document.querySelector("[data-active-name]");
  const notes = document.querySelector("[data-active-notes]");
  const newExercise = document.querySelector("[data-new-exercise]");
  const exerciseCategory = document.querySelector("[data-exercise-picker-category]");
  const date = document.querySelector("[data-active-date]");
  const duration = document.querySelector("[data-active-duration]");

  if (name) {
    name.addEventListener("input", () => {
      state.activeWorkout.name = name.value;
      saveActiveWorkout();
    });
  }

  if (notes) {
    notes.addEventListener("input", () => {
      state.activeWorkout.notes = notes.value;
      saveActiveWorkout();
    });
  }

  if (date) {
    date.addEventListener("input", () => {
      state.activeWorkout.date = fromDateTimeLocalValue(date.value);
      state.activeWorkout.startedAt = state.activeWorkout.date;
      saveActiveWorkout();
    });
  }

  if (duration) {
    duration.addEventListener("input", () => {
      state.activeWorkout.durationSec = Math.max(0, toNumber(duration.value) * 60);
      saveActiveWorkout();
      updateTimerText();
    });
  }

  if (newExercise) {
    const bindPickerResults = () => {
      document.querySelectorAll("[data-pick-exercise]").forEach((button) => {
        button.addEventListener("click", () => addExerciseToActiveWorkout(button.dataset.pickExercise));
      });
    };
    const updatePickerResults = () => {
      const results = document.querySelector("[data-exercise-picker-results]");
      if (results) {
        results.innerHTML = renderExercisePickerResults(newExercise.value);
        bindPickerResults();
      }
    };
    bindPickerResults();
    newExercise.addEventListener("input", () => {
      state.exercisePickerSearch = newExercise.value;
      updatePickerResults();
    });
    newExercise.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        handleAction("add-exercise");
      }
    });
    exerciseCategory?.addEventListener("change", () => {
      state.exercisePickerCategory = exerciseCategory.value;
      updatePickerResults();
    });
  }

  document.querySelectorAll("[data-set-weight]").forEach((input) => {
    input.addEventListener("focus", () => input.select());
    input.addEventListener("contextmenu", (event) => event.preventDefault());
    input.addEventListener("input", () => {
      const [exerciseIndex, setIndex] = input.dataset.setWeight.split(":").map(Number);
      state.activeWorkout.exercises[exerciseIndex].sets[setIndex].weight = toNumber(input.value);
      saveActiveWorkout();
    });
  });

  document.querySelectorAll("[data-set-reps]").forEach((input) => {
    input.addEventListener("focus", () => input.select());
    input.addEventListener("contextmenu", (event) => event.preventDefault());
    input.addEventListener("input", () => {
      const [exerciseIndex, setIndex] = input.dataset.setReps.split(":").map(Number);
      state.activeWorkout.exercises[exerciseIndex].sets[setIndex].reps = toNumber(input.value);
      saveActiveWorkout();
    });
  });
}

function addExerciseToActiveWorkout(name) {
  if (!state.activeWorkout || !name) return;
  const lastSet = getLastExerciseSet(name);
  state.activeWorkout.exercises.push({ name, sets: [activeSet({ weight: lastSet.weight, reps: lastSet.reps })] });
  state.exercisePickerSearch = "";
  saveActiveWorkout();
  render({ preserveScroll: true });
}

async function handleAction(action) {
  if (action === "close-exercise-detail") {
    state.exerciseDetailOpen = false;
    render({ preserveScroll: true });
  }

  if (action === "clear-data") {
    localStorage.removeItem(STORAGE_KEY);
    state.data = null;
    state.selectedWorkoutId = null;
    state.selectedExercise = "";
    showToast("Workout data cleared.");
    render();
  }

  if (action === "export-json") {
    if (!state.data) return showToast("Import data first.");
    await exportJson();
  }

  if (action === "start-empty") {
    state.activeWorkout = {
      name: "New Workout",
      startedAt: new Date().toISOString(),
      recoveryStartedAt: "",
      recoverySetId: "",
      recoverySetLabel: "",
      notes: "",
      exercises: [],
    };
    saveActiveWorkout();
    showWorkoutNotification();
    render();
  }

  if (action === "add-exercise") {
    const input = document.querySelector("[data-new-exercise]");
    const query = input?.value.trim() || "";
    const exact = getExerciseCatalog().find((name) => name.toLocaleLowerCase() === query.toLocaleLowerCase());
    const name = exact || getExercisePickerResults(query)[0]?.name;
    if (!name) return;
    addExerciseToActiveWorkout(name);
  }

  if (action === "add-catalog-exercise") {
    const input = document.querySelector("[data-new-catalog-exercise]");
    const name = input?.value.trim();
    if (!name) return;
    const exists = getExerciseCatalog().some((exercise) => exercise.toLowerCase() === name.toLowerCase());
    if (exists) {
      state.selectedExercise = getExerciseCatalog().find((exercise) => exercise.toLowerCase() === name.toLowerCase()) || name;
      showToast("Exercise already exists.");
      render();
      return;
    }
    state.customExercises.push(name);
    saveCustomExercises();
    state.selectedExercise = name;
    showToast("Exercise created.");
    render();
  }

  if (action === "finish-workout") finishActiveWorkout();

  if (action === "discard-workout") {
    state.activeWorkout = null;
    saveActiveWorkout();
    clearWorkoutNotification();
    render();
  }
}

async function exportJson() {
  const json = JSON.stringify({ ...state.data, customExercises: state.customExercises }, null, 2);
  const fileName = `gymtrack-export-${new Date().toISOString().slice(0, 10)}.json`;
  const filesystem = window.Capacitor?.Plugins?.Filesystem;
  const share = window.Capacitor?.Plugins?.Share;

  if (filesystem) {
    try {
      await filesystem.writeFile({
        path: fileName,
        data: json,
        directory: "DOCUMENTS",
        encoding: "utf8",
      });
      const uri = await filesystem.getUri({
        path: fileName,
        directory: "DOCUMENTS",
      });
      if (share && uri?.uri) {
        await share.share({
          title: "GymTrack export",
          text: "GymTrack workout export",
          url: uri.uri,
          dialogTitle: "Export GymTrack data",
        });
      }
      showToast("Export saved.");
      return;
    } catch (error) {
      console.error(error);
      showToast("Native export failed. Trying browser export.");
    }
  }

  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

function importCsvText(text, name) {
  try {
    const data = parseWorkoutCsv(text);
    registerCustomExercises(data.workouts);
    saveData(data);
    state.selectedExercise = data.exercises[0]?.name || "";
    state.selectedWorkoutId = data.workouts[0]?.id || null;
    state.tab = "history";
    showToast(`Imported ${data.workouts.length} workouts from ${name}.`);
    render();
  } catch (error) {
    console.error(error);
    showToast("That CSV could not be imported.");
  }
}

function importJsonText(text, name) {
  try {
    const parsed = JSON.parse(text);
    const workouts = Array.isArray(parsed.workouts) ? parsed.workouts : null;
    if (!workouts) throw new Error("Missing workouts");
    normalizeWorkoutExerciseNames(workouts);
    registerCustomExercises(workouts, Array.isArray(parsed.customExercises) ? parsed.customExercises : []);
    const data = buildDataModel(workouts);
    data.importedAt = parsed.importedAt || new Date().toISOString();
    saveData(data);
    state.selectedExercise = data.exercises[0]?.name || "";
    state.selectedWorkoutId = data.workouts[0]?.id || null;
    state.tab = "history";
    showToast(`Imported ${data.workouts.length} workouts from ${name}.`);
    render();
  } catch (error) {
    console.error(error);
    showToast("That JSON could not be imported.");
  }
}

function importFileText(text, name) {
  if (name.toLowerCase().endsWith(".json") || text.trim().startsWith("{")) {
    importJsonText(text, name);
  } else {
    importCsvText(text, name);
  }
}

function startFromRoutine(id) {
  const routine = state.data.workouts.find((workout) => workout.id === id);
  if (!routine) return;
  state.activeWorkout = {
    name: routine.name,
    startedAt: new Date().toISOString(),
    recoveryStartedAt: "",
    recoverySetId: "",
    recoverySetLabel: "",
    notes: "",
    exercises: routine.exercises.map((exercise) => ({
      name: exercise.name,
      sets: exercise.sets.map((set) => activeSet({ weight: set.weight, reps: set.reps })),
    })),
  };
  saveActiveWorkout();
  showWorkoutNotification();
  render({ preserveScroll: true });
}

function editWorkout(id) {
  const workout = state.data?.workouts.find((item) => item.id === id);
  if (!workout) return;

  state.activeWorkout = {
    editingWorkoutId: workout.id,
    sourceWorkoutNo: workout.sourceWorkoutNo,
    name: workout.name,
    date: workout.date,
    startedAt: workout.date,
    durationSec: workout.durationSec,
    recoveryStartedAt: "",
    recoverySetId: "",
    recoverySetLabel: "",
    notes: workout.notes || "",
    exercises: workout.exercises.map((exercise) => ({
      name: exercise.name,
      sets: exercise.sets.map((set) => activeSet({
        weight: set.weight,
        reps: set.reps,
        rpe: set.rpe || 0,
        distance: set.distance || 0,
        seconds: set.seconds || 0,
        notes: set.notes || "",
        finishedAt: workout.date,
      })),
    })),
  };

  saveActiveWorkout();
  state.tab = "start";
  render();
}

function deleteWorkout(id) {
  const workout = state.data?.workouts.find((item) => item.id === id);
  if (!workout) return;
  const ok = window.confirm(`Delete "${workout.name}" from history?`);
  if (!ok) return;

  const workouts = state.data.workouts.filter((item) => item.id !== id);
  saveWorkouts(workouts);
  state.selectedWorkoutId = workouts[0]?.id || null;
  showToast("Workout deleted.");
  render();
}

function moveActiveExercise(index, direction) {
  const exercises = state.activeWorkout?.exercises;
  if (!exercises) return;
  const nextIndex = index + direction;
  if (nextIndex < 0 || nextIndex >= exercises.length) return;
  const [exercise] = exercises.splice(index, 1);
  exercises.splice(nextIndex, 0, exercise);
  saveActiveWorkout();
  render({ preserveScroll: true });
}

function finishActiveWorkout() {
  const active = state.activeWorkout;
  if (!active.exercises.length) return showToast("Add at least one exercise.");

  const now = new Date();
  const exercises = active.exercises
    .map((exercise) => ({
      name: exercise.name,
      sets: exercise.sets.filter((set) => set.finishedAt),
    }))
    .filter((exercise) => exercise.sets.length > 0);

  if (!exercises.length) return showToast("Check at least one set before saving.");

  const workout = {
    id: active.editingWorkoutId || `local-${now.getTime()}`,
    sourceWorkoutNo: active.sourceWorkoutNo || "local",
    name: active.name || "Workout",
    date: active.editingWorkoutId ? active.date : now.toISOString(),
    durationSec: active.editingWorkoutId
      ? toNumber(active.durationSec)
      : Math.round((now - new Date(active.startedAt)) / 1000),
    notes: active.notes || "",
    exercises: exercises.map((exercise) => ({
      name: exercise.name,
      sets: exercise.sets.map((set, index) => ({
        order: index + 1,
        weight: toNumber(set.weight),
        reps: toNumber(set.reps),
        rpe: toNumber(set.rpe),
        distance: toNumber(set.distance),
        seconds: active.editingWorkoutId
          ? toNumber(set.seconds)
          : Math.round((new Date(set.finishedAt) - new Date(active.startedAt)) / 1000),
        notes: set.notes || "",
      })),
    })),
  };

  const workouts = active.editingWorkoutId
    ? (state.data?.workouts || []).map((item) => (item.id === active.editingWorkoutId ? workout : item))
    : [workout, ...(state.data?.workouts || [])];
  saveWorkouts(workouts);
  state.activeWorkout = null;
  saveActiveWorkout();
  clearWorkoutNotification();
  state.selectedWorkoutId = workout.id;
  state.tab = "history";
  showToast(active.editingWorkoutId ? "Workout updated." : "Workout saved.");
  render();
}

function toggleSetFinished(exerciseIndex, setIndex) {
  const workout = state.activeWorkout;
  const exercise = workout.exercises[exerciseIndex];
  const set = exercise?.sets[setIndex];
  if (!set) return;

  if (set.finishedAt) {
    set.finishedAt = "";
    if (workout.recoverySetId === set.id) {
      workout.recoveryStartedAt = "";
      workout.recoverySetId = "";
      workout.recoverySetLabel = "";
    }
  } else {
    const now = new Date().toISOString();
    set.id ||= nextSetId();
    set.finishedAt = now;
    workout.recoveryStartedAt = now;
    workout.recoverySetId = set.id;
    workout.recoverySetLabel = `${exercise.name} set ${setIndex + 1}`;
  }

  saveActiveWorkout();
  showWorkoutNotification();
  render({ preserveScroll: true });
}

function elapsedSince(value) {
  if (!value) return 0;
  return (Date.now() - new Date(value).getTime()) / 1000;
}

function syncTimerInterval() {
  const shouldRun =
    state.activeWorkout &&
    state.tab === "start" &&
    document.visibilityState !== "hidden" &&
    document.querySelector("[data-workout-timer]");

  if (!shouldRun) {
    window.clearInterval(timerInterval);
    timerInterval = null;
    return;
  }

  updateTimerText();
  if (!timerInterval) {
    timerInterval = window.setInterval(updateTimerText, 1000);
  }
}

function updateTimerText() {
  if (!state.activeWorkout) return;
  const workoutTimer = document.querySelector("[data-workout-timer]");
  const recoveryTimer = document.querySelector("[data-recovery-timer]");
  const recoveryLabel = document.querySelector("[data-recovery-label]");

  if (workoutTimer) {
    workoutTimer.textContent = state.activeWorkout.editingWorkoutId
      ? formatClock(state.activeWorkout.durationSec)
      : formatClock(elapsedSince(state.activeWorkout.startedAt));
  }
  if (recoveryTimer) {
    recoveryTimer.textContent = state.activeWorkout.recoveryStartedAt
      ? formatClock(elapsedSince(state.activeWorkout.recoveryStartedAt))
      : "0:00";
  }
}

function normalizeActiveWorkout(workout) {
  if (!workout) return null;
  workout.recoveryStartedAt ||= "";
  workout.recoverySetId ||= "";
  workout.recoverySetLabel ||= "";
  workout.exercises ||= [];
  workout.exercises.forEach((exercise) => {
    exercise.sets ||= [];
    exercise.sets.forEach((set, setIndex) => {
      set.id ||= nextSetId();
      set.finishedAt ||= "";
      if (
        workout.recoverySetLabel &&
        !workout.recoverySetId &&
        workout.recoverySetLabel === `${exercise.name} set ${setIndex + 1}`
      ) {
        workout.recoverySetId = set.id;
      }
    });
  });
  return workout;
}

function drawVisibleChart() {
  const weeklyCanvas = document.querySelector("#weeklyWorkoutChart");
  if (weeklyCanvas && state.data) drawWeeklyWorkoutChart(weeklyCanvas, state.data.workouts);

  const canvas = document.querySelector("#exerciseChart");
  if (!canvas || !state.data) return;
  const selected = state.data.exercises.find((exercise) => exercise.name === state.selectedExercise) || state.data.exercises[0];
  if (!selected) return;
  drawChart(canvas, selected.history);
}

function setupCanvas(canvas) {
  const ctx = canvas.getContext("2d");
  const rect = canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.floor(rect.width));
  const height = Math.max(1, Math.floor(rect.height));
  canvas.width = Math.floor(width * ratio);
  canvas.height = Math.floor(height * ratio);
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, width, height);
  ctx.font = "12px system-ui";
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  return { ctx, width, height };
}

function drawChart(canvas, history) {
  const { ctx, width, height } = setupCanvas(canvas);
  const padding = { top: 18, right: 12, bottom: 28, left: 42 };

  if (history.length < 2) {
    ctx.fillStyle = "#8f9aa8";
    ctx.fillText("More sessions needed for a trend.", 18, 34);
    return;
  }

  const values = history.map((entry) => entry.e1rm);
  const min = Math.max(0, Math.min(...values) * 0.9);
  const max = Math.max(...values) * 1.08;
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const xStep = plotWidth / Math.max(1, history.length - 1);
  const yFor = (value) => padding.top + (1 - (value - min) / Math.max(1, max - min)) * plotHeight;

  ctx.strokeStyle = "#26313d";
  ctx.lineWidth = 1;
  for (let i = 0; i < 4; i += 1) {
    const y = padding.top + (plotHeight / 3) * i;
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(width - padding.right, y);
    ctx.stroke();
  }

  ctx.strokeStyle = "#34d399";
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  history.forEach((entry, index) => {
    const x = padding.left + xStep * index;
    const y = yFor(entry.e1rm);
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  if (history.length <= 40) {
    ctx.fillStyle = "#7bf0bf";
    history.forEach((entry, index) => {
      const x = padding.left + xStep * index;
      const y = yFor(entry.e1rm);
      ctx.beginPath();
      ctx.arc(x, y, 3.5, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  ctx.fillStyle = "#8f9aa8";
  ctx.fillText(`${max.toFixed(0)} kg`, 6, padding.top + 4);
  ctx.fillText(`${min.toFixed(0)} kg`, 6, height - padding.bottom + 4);
}

function getWeeklyWorkoutBuckets(workouts) {
  if (!workouts.length) return [];

  const latestWorkoutDate = new Date(Math.max(...workouts.map((workout) => new Date(workout.date).getTime())));
  const endWeekStart = startOfWeekMonday(latestWorkoutDate);
  const start = new Date(endWeekStart);
  start.setDate(endWeekStart.getDate() - 7 * 12);
  start.setHours(0, 0, 0, 0);
  const end = new Date(endWeekStart);
  end.setDate(endWeekStart.getDate() + 6);
  end.setHours(23, 59, 59, 999);

  const buckets = Array.from({ length: 13 }, (_, index) => {
    const weekStart = new Date(start);
    weekStart.setDate(start.getDate() + index * 7);
    return { start: weekStart, count: 0 };
  });

  workouts.forEach((workout) => {
    const date = new Date(workout.date);
    if (date < start || date > end) return;
    const weekStart = startOfWeekMonday(date);
    const index = Math.min(12, Math.floor((weekStart - start) / (7 * 24 * 60 * 60 * 1000)));
    buckets[index].count += 1;
  });

  return buckets;
}

function startOfWeekMonday(date) {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  const daysSinceMonday = (result.getDay() + 6) % 7;
  result.setDate(result.getDate() - daysSinceMonday);
  return result;
}

function drawWeeklyWorkoutChart(canvas, workouts) {
  const { ctx, width, height } = setupCanvas(canvas);
  const buckets = getWeeklyWorkoutBuckets(workouts);
  const padding = { top: 18, right: 10, bottom: 32, left: 26 };
  if (!buckets.length) {
    ctx.fillStyle = "#8f9aa8";
    ctx.fillText("No workouts yet.", 18, 34);
    return;
  }
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const max = Math.max(1, ...buckets.map((bucket) => bucket.count));
  const barGap = 5;
  const barWidth = Math.max(8, (plotWidth - barGap * (buckets.length - 1)) / buckets.length);

  ctx.strokeStyle = "#26313d";
  ctx.lineWidth = 1;
  for (let i = 0; i < 3; i += 1) {
    const y = padding.top + (plotHeight / 2) * i;
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(width - padding.right, y);
    ctx.stroke();
  }

  buckets.forEach((bucket, index) => {
    const x = padding.left + index * (barWidth + barGap);
    const barHeight = (bucket.count / max) * plotHeight;
    const y = padding.top + plotHeight - barHeight;
    ctx.fillStyle = bucket.count ? "#34d399" : "#1b222c";
    ctx.fillRect(x, y, barWidth, Math.max(2, barHeight));
  });

  ctx.fillStyle = "#8f9aa8";
  ctx.fillText(`${max}`, 6, padding.top + 4);
  ctx.fillText("0", 10, padding.top + plotHeight + 4);
  ctx.fillText(formatDate(buckets[0].start), padding.left, height - 8);
  ctx.fillText(formatDate(buckets[12].start), Math.max(padding.left, width - 86), height - 8);
}

function showToast(message) {
  state.toast = message;
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => {
    state.toast = "";
    render();
  }, 3000);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value);
}

state.activeWorkout = normalizeActiveWorkout(state.activeWorkout);
if (state.activeWorkout && !state.activeWorkout.editingWorkoutId) showWorkoutNotification();
window.addEventListener("pagehide", flushStorage);
window.addEventListener("beforeunload", flushStorage);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    flushStorage();
  }
  syncTimerInterval();
});
document.addEventListener("freeze", () => {
  flushStorage();
  window.clearInterval(timerInterval);
  timerInterval = null;
});
render();
restoreNativeBackup().catch(() => {});
