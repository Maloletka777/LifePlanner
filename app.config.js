/**
 * The variant layer over `app.json`, and it exists for one reason.
 *
 * **iOS keeps exactly one app per bundle identifier on a device.** The development build
 * and the TestFlight build carried the same one, so installing either required deleting
 * the other — and deleting an iOS app deletes its container, `lifeplanner.db` with it.
 * That is a data loss caused by a build setting, on a product whose first rule is that
 * SQLite is the source of truth and nothing silently resets it.
 *
 * A development build is a different application now: its own identifier, its own icon,
 * its own database. The two live side by side and neither can evict the other.
 *
 * **Production is untouched and must stay so.** `com.olegkotikov.lifeplanner.alpha` is the
 * identifier App Store Connect knows (`ascAppId` 6793826774) and builds 36–38 shipped under
 * it; changing it would orphan the App Store listing. Only the `development` profiles set
 * `APP_VARIANT`, and every other path — including a bare `expo start` and `expo export` —
 * resolves to production exactly as before.
 *
 * `app.json` stays the base. Expo reads it first and hands it here as `config`, so there is
 * one place that states the app and one small place that varies it, rather than two files
 * that can disagree about everything else.
 */
const DEVELOPMENT = 'development';

module.exports = ({ config }) => {
  const isDevelopment = process.env.APP_VARIANT === DEVELOPMENT;
  if (!isDevelopment) return config;

  return {
    ...config,
    // A different name as well as a different identifier: two identical icons on a home
    // screen is a way to record a day's work in the wrong database.
    name: `${config.name} Dev`,
    ios: {
      ...config.ios,
      bundleIdentifier: `${config.ios.bundleIdentifier}.dev`,
    },
    android: {
      ...config.android,
      package: `${config.android?.package ?? config.ios.bundleIdentifier}.dev`,
    },
  };
};
