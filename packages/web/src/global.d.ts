// File System Access API members not yet in TypeScript's DOM lib.
type FsPermissionMode = { mode?: 'read' | 'readwrite' };

interface FileSystemHandle {
  queryPermission(desc?: FsPermissionMode): Promise<PermissionState>;
  requestPermission(desc?: FsPermissionMode): Promise<PermissionState>;
}

interface Window {
  showDirectoryPicker(opts?: FsPermissionMode & { id?: string; startIn?: string }): Promise<FileSystemDirectoryHandle>;
}

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}
