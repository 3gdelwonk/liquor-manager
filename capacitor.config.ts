import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.liquormanager.app',
  appName: 'Liquor Manager',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
};

export default config;
