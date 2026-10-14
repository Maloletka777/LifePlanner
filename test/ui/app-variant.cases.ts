import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

/**
 * The variant layer, asserted as arithmetic rather than run through a build.
 *
 * `app.config.js` is a pure function of `(config, APP_VARIANT)`, so it can be called
 * directly. That matters: the thing being protected is an identity the App Store already
 * knows, and «we resolved it once by hand and it looked right» is not a guard.
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const appConfig = require('../../app.config.js') as (input: { config: Record<string, unknown> }) => Record<string, unknown>;
const base = JSON.parse(readFileSync('app.json', 'utf8')).expo as Record<string, unknown>;

const resolve = (variant: string | undefined) => {
  const previous = process.env.APP_VARIANT;
  if (variant === undefined) delete process.env.APP_VARIANT; else process.env.APP_VARIANT = variant;
  try {
    return appConfig({ config: structuredClone(base) });
  } finally {
    if (previous === undefined) delete process.env.APP_VARIANT; else process.env.APP_VARIANT = previous;
  }
};
const ios = (config: Record<string, unknown>) => config.ios as { bundleIdentifier: string };

test('the production identity cannot drift, because the App Store already knows it', () => {
  // `com.olegkotikov.lifeplanner.alpha` is what `ascAppId` 6793826774 is bound to and what
  // builds 36–38 shipped under. Moving it orphans the listing, and nothing about a
  // *development* convenience is allowed to reach it.
  assert.equal(ios(base).bundleIdentifier, 'com.olegkotikov.lifeplanner.alpha');
  for (const variant of [undefined, 'production', 'preview', '', 'Development', 'dev']) {
    const resolved = resolve(variant);
    assert.equal(
      ios(resolved).bundleIdentifier,
      'com.olegkotikov.lifeplanner.alpha',
      `APP_VARIANT=${String(variant)} moved the production identity`,
    );
    assert.equal(resolved.name, base.name, `APP_VARIANT=${String(variant)} renamed the app`);
  }
  // Only the exact word does anything, so a typo in a build profile fails safe — towards
  // production being production rather than towards a release built as a dev app.
  assert.equal(ios(resolve('development')).bundleIdentifier, 'com.olegkotikov.lifeplanner.alpha.dev');
});

test('a development build is a different application, so neither can evict the other', () => {
  // **iOS keeps exactly one app per bundle identifier on a device.** The development build
  // and the TestFlight build carried the same one, so installing either required deleting
  // the other — and deleting an iOS app deletes its container, `lifeplanner.db` with it.
  // That is data loss caused by a build setting, on a product whose first rule is that
  // SQLite is the source of truth and nothing silently resets it.
  const dev = resolve('development');
  assert.notEqual(ios(dev).bundleIdentifier, ios(base).bundleIdentifier);
  // A different name as well: two identical icons on a home screen is a way to record a
  // day's work in the wrong database.
  assert.notEqual(dev.name, base.name);
  assert.match(String(dev.name), /Dev$/);
  // The slug is the EAS project's own handle and must not move, or the build stops
  // resolving to this project at all.
  assert.equal(dev.slug, base.slug);
  // Android is kept in step even though it is post-MVP, because a package that silently
  // stayed shared would be the same defect waiting on the other platform.
  assert.match(String((dev.android as { package?: string }).package), /\.dev$/);
});

test('only the development profiles carry the variant, and every other path is production', () => {
  const eas = JSON.parse(readFileSync('eas.json', 'utf8')) as {
    build: Record<string, { env?: Record<string, string> }>;
  };
  for (const [name, profile] of Object.entries(eas.build)) {
    const variant = profile.env?.APP_VARIANT;
    if (name.startsWith('development')) {
      assert.equal(variant, 'development', `${name} must build the development app`);
    } else {
      assert.equal(variant, undefined, `${name} must build the production app`);
    }
  }
  // And a bare `expo start` — which is how the day is actually spent — is production too,
  // so the development identity exists on EAS and nowhere else.
  assert.equal(ios(resolve(undefined)).bundleIdentifier, 'com.olegkotikov.lifeplanner.alpha');
});
