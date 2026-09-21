// Run after `npm run build`. These checks exercise the deployable output, not
// Astro's source, so missing assets or changed routes are caught before upload.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { DEFAULT_WORD_OPTIONS } from '../src/lib/word-options.js';
import { wordQuery } from '../src/lib/words-api.js';

const dist = new URL('../dist/', import.meta.url);
const pages = ['index.html', 'phrases/index.html'].map(path => readFileSync(new URL(path, dist), 'utf8'));

test('both public routes contain their controls and a pre-paint theme script', () => {
   pages.forEach(html => {
      assert.ok(html.indexOf('id="theme-bootstrap"') < html.indexOf('rel="stylesheet"'));
      assert.match(html, /<nav class="generator-nav"/);
      assert.match(html, /id="rareness"/);
      assert.match(html, /name="min-word-length"/);
      assert.match(html, /id="generate"/);
      const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]);
      assert.equal(new Set(ids).size, ids.length, 'shared components must not introduce duplicate IDs');
   });
   assert.match(pages[0], /id="word-definition-template"/);
   assert.match(pages[1], /id="phrase-slots"/);
   assert.match(pages[1], /id="phrase-definition"/);
});

test('each built page links to existing, hashed bundles and static assets', () => {
   pages.forEach(html => {
      const assets = [...html.matchAll(/(?:src|href)="(\/(?:_astro|assets)\/[^"?#]+)"/g)].map(match => match[1]);
      assert.ok(assets.some(path => path.endsWith('.js')));
      assert.ok(assets.some(path => path.endsWith('.css')));
      assets.forEach(path => assert.ok(existsSync(new URL(path.slice(1), dist)), `Missing ${path}`));
      assert.doesNotMatch(html, /\?v=dev|assets\/javascript|assets\/css/);
   });
});

test('the early request uses the shared default query and runs before stylesheets', () => {
   const html = pages[0];
   const tag = html.match(/<script[^>]*id="first-words"[^>]*>/)?.[0];
   assert.ok(tag);
   const query = tag.match(/data-query="([^"]*)"/)[1].replaceAll('&amp;', '&');
   assert.equal(query, wordQuery(DEFAULT_WORD_OPTIONS));
   assert.ok(html.indexOf(tag) < html.indexOf('rel="stylesheet"'));
});

test('the production web root includes the unchanged PHP endpoint', () => {
   assert.equal(readFileSync(new URL('api/get_words.php', dist), 'utf8'),
      readFileSync(new URL('../public/api/get_words.php', import.meta.url), 'utf8'));
});
