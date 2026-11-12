/**
 * @file plugin-host/index.ts
 * @description The plugin host, as the application shell uses it.
 *
 * Plugins themselves import `plugin-host/api` instead; this barrel is the
 * core side (mount the registry, read the contributions).
 */

export { PluginProvider, usePluginContributions, usePlugins } from './PluginProvider'
export { PluginRoots } from './PluginRoots'
export { insertAfterId } from './pluginSelect'
export { onRevealBottomTab } from './bottomTabReveal'
export type {
  BottomTabComponent,
  PaneComponent,
  PluginContributions,
  PluginFileOpener,
  PluginToolbarContribution,
  ResolvedPluginBottomTab,
  ResolvedPluginPane,
  ResolvedPluginSetting,
  ResolvedPluginView,
  RendererPlugin,
} from './types'
