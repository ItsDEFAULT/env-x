export * from './parse.js';
export * from './vault.js';
export * from './memory.js';
export * from './folders.js';

/** Vault methods that may be called remotely (daemon RPC, web app). */
export const VAULT_METHODS = [
  'listProjects',
  'getProject',
  'findProjectForPath',
  'importProject',
  'updateProject',
  'removeProject',
  'status',
  'listEnvs',
  'readEnv',
  'saveEnv',
  'createEnv',
  'renameEnv',
  'deleteEnv',
  'setVars',
  'unsetVars',
  'diffEnvs',
  'switchEnv',
  'setSecure',
  'pull',
] as const;

export type VaultMethod = (typeof VAULT_METHODS)[number];
