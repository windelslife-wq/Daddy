import test from 'node:test';
import assert from 'node:assert/strict';
import {
  APP_PAGES, FOOTER_GROUPS, NAV_GROUPS, PRIMARY_NAV, PUBLIC_PAGES,
  SITE, documentTitleForPath, pageForPath,
} from '../src/config/site.js';

function assertUnique(items, label) {
  const paths = items.map((item) => item.path || item.to);
  assert.equal(new Set(paths).size, paths.length, `${label} contains duplicate paths`);
}

test('public site map is complete and internally consistent', () => {
  assert.equal(SITE.name, 'Faceless Studio');
  assert.ok(PUBLIC_PAGES.length >= 20, 'Expected a complete public website');
  assertUnique(PUBLIC_PAGES, 'PUBLIC_PAGES');
  assertUnique(APP_PAGES, 'APP_PAGES');
  for (const page of PUBLIC_PAGES) {
    assert.match(page.path, /^\/[\w/-]*$/, `${page.path} must be an internal route`);
    assert.ok(page.label && page.title && page.description && page.icon, `${page.path} is missing metadata`);
    assert.ok(NAV_GROUPS.some((group) => group.id === page.group), `${page.path} has an unknown group`);
  }
  assert.equal(PUBLIC_PAGES.filter((page) => page.path === '/').length, 1, 'Exactly one home page is required');
  assert.equal(PRIMARY_NAV.length, 5);
  assert.ok(PRIMARY_NAV.some((page) => page.path === '/filmmaking'));
  assert.ok(PRIMARY_NAV.every(Boolean));
});

test('header menu and generated footer include every non-home page', () => {
  const expected = PUBLIC_PAGES.filter((page) => page.path !== '/').map((page) => page.path).sort();
  const menu = NAV_GROUPS.flatMap((group) => group.links.map((link) => link.path)).sort();
  const footer = FOOTER_GROUPS.flatMap((group) => group.links.map((link) => link.path)).sort();
  assert.deepEqual(menu, expected);
  assert.deepEqual(footer, expected);
  for (const group of NAV_GROUPS) assert.ok(group.links.length > 0, `${group.label} menu is empty`);
  for (const group of FOOTER_GROUPS) assert.ok(group.links.length > 0, `${group.label} footer column is empty`);
});

test('document titles resolve for public pages and special routes', () => {
  for (const page of PUBLIC_PAGES) {
    const title = documentTitleForPath(page.path);
    assert.ok(title.includes(SITE.name), `${page.path} title should include the product name`);
    assert.equal(pageForPath(page.path)?.label, page.label);
  }
  assert.equal(documentTitleForPath('/'), `${SITE.name} — ${SITE.tagline}`);
  assert.equal(pageForPath('/does-not-exist'), null);
});
