import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.showflow.ledger',
  appName: 'Show Flow',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
};

export default config;
