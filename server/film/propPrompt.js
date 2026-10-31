/**
 * Prop prompt helpers.
 *
 * Kept in its own module (only the database, no film services) so the scene
 * generator, the storyboard renderer and the props API can all use it without
 * creating an import cycle.
 */
import { db } from '../db.js';

export function propClause(props = []) {
  if (!props.length) return '';
  return `Continuity props — identical object, material and colour: ${props
    .map((prop) => `${prop.name}${prop.state ? ` (${prop.state})` : ''}${prop.description ? ` — ${prop.description}` : ''}${prop.color ? `, ${prop.color}` : ''}`)
    .join('; ')}.`;
}

/** Props linked to one scene, ready for the prompt. */
export async function scenePropsForPrompt(filmId, sceneId) {
  const links = await db('film_scene_props').where({ film_id: filmId, scene_id: sceneId });
  if (!links.length) return [];
  const rows = await db('film_props').whereIn('id', links.map((link) => link.prop_id));
  const byId = new Map(rows.map((row) => [row.id, row]));
  return links
    .map((link) => {
      const prop = byId.get(link.prop_id);
      if (!prop) return null;
      return {
        name: prop.name, description: prop.description, color: prop.color,
        material: prop.material, state: link.state || '',
      };
    })
    .filter(Boolean);
}
