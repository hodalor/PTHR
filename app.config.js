const baseConfig = require('./app.json');

const googleMapsApiKey = (process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY || '').trim();

const expoConfig = {
  ...baseConfig.expo,
  ios: {
    ...(baseConfig.expo.ios || {}),
    config: {
      ...((baseConfig.expo.ios && baseConfig.expo.ios.config) || {}),
      ...(googleMapsApiKey ? { googleMapsApiKey } : {}),
    },
  },
  android: {
    ...(baseConfig.expo.android || {}),
    config: {
      ...((baseConfig.expo.android && baseConfig.expo.android.config) || {}),
      ...(googleMapsApiKey ? { googleMaps: { apiKey: googleMapsApiKey } } : {}),
    },
  },
};

module.exports = {
  expo: expoConfig,
};
