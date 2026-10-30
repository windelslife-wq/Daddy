import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Build a database that looks like it was created by the pre-long-form release,
// then upgrade it in place. This is the guarantee behind "preserve existing
// functionality and database records": the migration is additive only.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'film-migration-'));
process.env.SQLITE_PATH = path.join(dir, 'legacy.sqlite3');
delete process.env.DATABASE_URL;
delete process.env.PGDATABASE;

const BetterSqlite = (await import('better-sqlite3')).default;
const legacy = new BetterSqlite(process.env.SQLITE_PATH);
legacy.exec(`
  CREATE TABLE film_projects (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    title TEXT,
    status TEXT,
    screenplay TEXT,
    created_at TEXT,
    updated_at TEXT
  );
  CREATE TABLE film_scenes (
    id TEXT PRIMARY KEY,
    film_id TEXT NOT NULL,
    scene_number INTEGER,
    prompt TEXT,
    status TEXT,
    created_at TEXT,
    updated_at TEXT
  );
  INSERT INTO film_projects (id, user_id, title, status, screenplay, created_at, updated_at)
  VALUES ('flm_legacy', 'usr_legacy', 'Shot before the upgrade', 'draft', '{"scenes":[]}',
          '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
  INSERT INTO film_scenes (id, film_id, scene_number, prompt, status, created_at, updated_at)
  VALUES ('scn_legacy', 'flm_legacy', 1, 'A legacy scene', 'ready',
          '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
`);
legacy.close();

const { db, initializeDatabase } = await import('../server/db.js');

test.after(async () => {
  await db.destroy();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the long-form migration upgrades an existing install without losing records', async () => {
  await initializeDatabase(db, { seedDemo: false, adminEmail: null, adminPassword: null });

  const projectColumns = ['run_state', 'scene_provider', 'assembly_cancel_requested', 'run_started_at', 'run_stopped_at', 'progress', 'detail'];
  for (const column of projectColumns) {
    assert.equal(await db.schema.hasColumn('film_projects', column), true, `film_projects.${column} is added`);
  }
  const sceneColumns = ['cast', 'sfx', 'cancel_requested', 'queued_at', 'provider_handle', 'progress', 'detail'];
  for (const column of sceneColumns) {
    assert.equal(await db.schema.hasColumn('film_scenes', column), true, `film_scenes.${column} is added`);
  }

  const project = await db('film_projects').where({ id: 'flm_legacy' }).first();
  assert.equal(project.title, 'Shot before the upgrade');
  assert.equal(project.screenplay, '{"scenes":[]}');
  assert.equal(project.run_state, 'idle', 'pre-existing runs start idle instead of mid-run');
  assert.equal(project.assembly_cancel_requested, 0);
  assert.equal(project.progress, 0);

  const scene = await db('film_scenes').where({ id: 'scn_legacy' }).first();
  assert.equal(scene.prompt, 'A legacy scene');
  assert.equal(scene.status, 'ready', 'finished scenes keep their status and clip');
  assert.equal(scene.cast, '[]');
  assert.equal(scene.sfx, '[]');
  assert.equal(scene.cancel_requested, 0);
});

test('re-running the migration is idempotent', async () => {
  await initializeDatabase(db, { seedDemo: false, adminEmail: null, adminPassword: null });
  const projects = await db('film_projects').where({ id: 'flm_legacy' });
  assert.equal(projects.length, 1);
  const scenes = await db('film_scenes').where({ film_id: 'flm_legacy' });
  assert.equal(scenes.length, 1);
  assert.equal(scenes[0].cast, '[]');
});
