const { withGradleProperties } = require('expo/config-plugins');

const upsertProperty = (properties, key, value) => {
  const existing = properties.find((item) => item.type === 'property' && item.key === key);
  if (existing) {
    existing.value = value;
    return;
  }
  properties.push({ type: 'property', key, value });
};

module.exports = function with16KbPageSize(config) {
  return withGradleProperties(config, (modConfig) => {
    upsertProperty(modConfig.modResults, 'expo.useLegacyPackaging', 'false');
    upsertProperty(modConfig.modResults, 'android.bundle.enableUncompressedNativeLibs', 'true');
    upsertProperty(modConfig.modResults, 'android.native.buildOutput', 'verbose');
    return modConfig;
  });
};
