/**
 * Folder browser data, served by the local envx server for the CLI vault. Browsers never reveal
 * a picked folder's real path, so the server (which sees the filesystem) lists folders instead.
 */

export interface FolderEntry {
  name: string;
  path: string;
  /** Contains .env files that envx would import. */
  hasEnv: boolean;
  /** Name of the envx project already at this path. */
  project?: string;
}

export interface FolderListing {
  /** Absolute path, or '' for the list of drives on Windows. */
  path: string;
  /** Folder above this one; '' is the Windows drive list, null means this is the top. */
  parent: string | null;
  /** Path segments, from the top, for breadcrumbs. */
  crumbs: { name: string; path: string }[];
  folders: FolderEntry[];
  /** .env files in this folder that envx would import. */
  envFiles: string[];
  /** Name of the envx project already at this path. */
  project?: string;
  shortcuts: { label: string; path: string }[];
  /** True when there were more folders than listed. */
  truncated: boolean;
}
