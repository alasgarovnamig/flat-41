// Metro config for the pnpm monorepo (root .npmrc uses node-linker=hoisted).
// https://docs.expo.dev/guides/monorepos/
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// 1. Watch the whole workspace so changes in packages/shared hot-reload.
config.watchFolders = [workspaceRoot];
// 2. Resolve modules from the app first, then from the hoisted workspace root.
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];
// 3. Honour package.json "exports" — @evtap/shared exposes a "react-native" condition → src/index.ts
//    (Metro adds the "react-native" condition on iOS/Android; on web it resolves the built dist/).
config.resolver.unstable_enablePackageExports = true;

module.exports = config;
