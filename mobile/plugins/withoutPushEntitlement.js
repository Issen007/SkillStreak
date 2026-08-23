const { withEntitlementsPlist } = require('expo/config-plugins');

/**
 * Removes iOS's `aps-environment` entitlement, which `expo-notifications`
 * adds whether or not the app uses push.
 *
 * ADR-0033 chose **local notifications only**: the daily training reminder
 * is scheduled on the device, there is no push token anywhere in this app,
 * and no server-side send path exists. `expo-notifications` does not know
 * that. Its config plugin is applied automatically because the package is
 * installed, and it sets `aps-environment` unconditionally — see
 * `node_modules/expo-notifications/plugin/build/withNotificationsIOS.js`,
 * which only skips when the key is already truthy.
 *
 * That broke iOS build 15 outright:
 *
 *   Provisioning profile "…" doesn't support the Push Notifications
 *   capability. … doesn't include the aps-environment entitlement.
 *
 * The easy fix would have been to let EAS regenerate the profile with push
 * enabled. That is the wrong fix. The entitlement is a declaration that
 * this app receives remote notifications, on a Kids Category app whose
 * store data-safety answers rest partly on there being no push surface at
 * all. Claiming a capability nothing uses makes the paperwork untrue for
 * no benefit.
 *
 * Local notifications need no entitlement — `aps-environment` is purely
 * APNs. Removing it changes nothing the reminder depends on.
 *
 * Listed in app.json's `plugins` so it runs *after* the autolinked one and
 * therefore has something to delete.
 */
module.exports = function withoutPushEntitlement(config) {
  return withEntitlementsPlist(config, (cfg) => {
    delete cfg.modResults['aps-environment'];
    return cfg;
  });
};
