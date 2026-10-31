/**
 * Cinematography vocabulary shared by the director UI, the scene API and the
 * video-provider prompt builder.
 *
 * These are closed vocabularies on purpose: a free-text "camera angle" cannot
 * be validated, routed or shown as a real control. Every value here maps to a
 * phrase that is injected into the provider prompt, so choosing "low_angle"
 * or an 85mm lens actually changes what is generated.
 */

export const SHOT_SIZES = [
  'extreme_wide', 'wide', 'medium_wide', 'medium', 'medium_close',
  'close_up', 'extreme_close_up', 'over_the_shoulder', 'two_shot', 'insert',
];

export const CAMERA_ANGLES = [
  'eye_level', 'low_angle', 'high_angle', 'birds_eye', 'worms_eye',
  'dutch_angle', 'overhead', 'point_of_view',
];

export const CAMERA_MOVEMENTS = [
  'static', 'pan_left', 'pan_right', 'tilt_up', 'tilt_down', 'dolly_in',
  'dolly_out', 'truck_left', 'truck_right', 'crane_up', 'crane_down',
  'handheld', 'steadicam', 'zoom_in', 'zoom_out', 'drone_orbit', 'drone_flyover',
];

export const LENSES = ['14mm', '18mm', '24mm', '35mm', '50mm', '85mm', '100mm', '135mm'];

export const LIGHTING = [
  'natural', 'golden_hour', 'blue_hour', 'high_key', 'low_key', 'backlit',
  'rim_light', 'neon', 'candlelight', 'moonlight', 'studio_softbox', 'practical',
];

export const COLOR_GRADES = [
  'neutral', 'warm', 'cool', 'teal_orange', 'desaturated', 'high_contrast',
  'sepia', 'noir', 'vibrant',
];

const PHRASES = {
  shotSize: {
    extreme_wide: 'extreme wide establishing shot',
    wide: 'wide shot',
    medium_wide: 'medium wide shot',
    medium: 'medium shot',
    medium_close: 'medium close-up',
    close_up: 'close-up',
    extreme_close_up: 'extreme close-up',
    over_the_shoulder: 'over-the-shoulder shot',
    two_shot: 'two-shot',
    insert: 'insert shot',
  },
  angle: {
    eye_level: 'eye-level angle',
    low_angle: 'low angle looking up at the subject',
    high_angle: 'high angle looking down at the subject',
    birds_eye: "bird's-eye view",
    worms_eye: "worm's-eye view",
    dutch_angle: 'dutch tilted angle',
    overhead: 'overhead top-down framing',
    point_of_view: 'point-of-view framing',
  },
  movement: {
    static: 'locked-off static camera',
    pan_left: 'smooth pan left',
    pan_right: 'smooth pan right',
    tilt_up: 'tilt up',
    tilt_down: 'tilt down',
    dolly_in: 'dolly pushing in',
    dolly_out: 'dolly pulling out',
    truck_left: 'trucking left',
    truck_right: 'trucking right',
    crane_up: 'crane rising up',
    crane_down: 'crane descending',
    handheld: 'handheld camera',
    steadicam: 'smooth steadicam follow',
    zoom_in: 'slow zoom in',
    zoom_out: 'slow zoom out',
    drone_orbit: 'drone orbit around the subject',
    drone_flyover: 'drone flyover',
  },
  lighting: {
    natural: 'natural available light',
    golden_hour: 'warm golden-hour light',
    blue_hour: 'cool blue-hour light',
    high_key: 'bright high-key lighting',
    low_key: 'moody low-key lighting with deep shadows',
    backlit: 'backlit silhouette',
    rim_light: 'rim lighting separating the subject from the background',
    neon: 'neon practical lighting',
    candlelight: 'flickering candlelight',
    moonlight: 'soft moonlight',
    studio_softbox: 'studio softbox lighting',
    practical: 'motivated practical lights in frame',
  },
  grade: {
    neutral: 'neutral colour grade',
    warm: 'warm colour grade',
    cool: 'cool colour grade',
    teal_orange: 'teal and orange blockbuster grade',
    desaturated: 'desaturated grade',
    high_contrast: 'high-contrast grade',
    sepia: 'sepia-toned grade',
    noir: 'black-and-white film-noir grade',
    vibrant: 'vibrant saturated grade',
  },
};

const DEPTH_OF_FIELD = {
  '14mm': 'deep focus, ultra-wide perspective',
  '18mm': 'wide perspective with deep focus',
  '24mm': 'wide establishing perspective',
  '35mm': 'natural documentary perspective',
  '50mm': 'natural human-eye perspective',
  '85mm': 'shallow depth of field with creamy background bokeh',
  '100mm': 'very shallow depth of field, compressed background',
  '135mm': 'telephoto compression with strong subject isolation',
};

/** Human label for a stored value, e.g. `over_the_shoulder` → `Over the shoulder`. */
export function labelFor(value) {
  return String(value || '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

/**
 * Build the cinematography sentence for a scene.
 * Unknown/empty values are skipped rather than invented.
 */
export function describeShot(scene = {}) {
  const parts = [];
  if (PHRASES.shotSize[scene.shot_size]) parts.push(PHRASES.shotSize[scene.shot_size]);
  if (PHRASES.angle[scene.camera_angle]) parts.push(PHRASES.angle[scene.camera_angle]);
  if (scene.lens) parts.push(`${scene.lens} lens${DEPTH_OF_FIELD[scene.lens] ? `, ${DEPTH_OF_FIELD[scene.lens]}` : ''}`);
  if (PHRASES.movement[scene.camera_movement]) parts.push(PHRASES.movement[scene.camera_movement]);
  if (PHRASES.lighting[scene.lighting]) parts.push(PHRASES.lighting[scene.lighting]);
  if (PHRASES.grade[scene.color_grade]) parts.push(PHRASES.grade[scene.color_grade]);
  if (scene.composition) parts.push(`composition: ${String(scene.composition).slice(0, 300)}`);
  return parts.join(', ');
}

/** Catalogue for the UI: every control, its label and its prompt phrase. */
export function cinematographyCatalog() {
  return {
    shotSizes: SHOT_SIZES.map((id) => ({ id, label: labelFor(id) })),
    cameraAngles: CAMERA_ANGLES.map((id) => ({ id, label: labelFor(id) })),
    cameraMovements: CAMERA_MOVEMENTS.map((id) => ({ id, label: labelFor(id) })),
    lenses: LENSES.map((id) => ({ id, label: id, depthOfField: DEPTH_OF_FIELD[id] || '' })),
    lighting: LIGHTING.map((id) => ({ id, label: labelFor(id) })),
    colorGrades: COLOR_GRADES.map((id) => ({ id, label: labelFor(id) })),
  };
}
