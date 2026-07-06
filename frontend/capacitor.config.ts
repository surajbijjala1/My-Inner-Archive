import type { CapacitorConfig } from '@capacitor/cli';

// appId MUST match the package_name registered in Firebase (google-services.json)
const config: CapacitorConfig = {
  appId: 'com.myinnerarchive.app',
  appName: 'My Inner Archive',
  webDir: 'dist',
  plugins: {
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
  },
};

export default config;
