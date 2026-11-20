export interface DownloadSetting {
  enabled: boolean;
  revision: number;
  purgeRevision: number;
}

export interface DownloadAccessRecord extends DownloadSetting {
  checkedAt: number;
  expiresAt: number;
  purgePending: boolean;
}

declare const access: {
  read(): Promise<DownloadAccessRecord | null>;
  remember(setting: DownloadSetting, checkedAt?: number): Promise<DownloadAccessRecord>;
  isAllowed(record: DownloadAccessRecord | null, now?: number): boolean;
  onChange(listener: (record: DownloadAccessRecord) => void): () => void;
  checkOnline(apiBase: string): Promise<DownloadAccessRecord>;
  requireEnabled(apiBase: string): Promise<DownloadAccessRecord>;
  commitDownload<T>(expectedPurgeRevision: number, action: () => Promise<T>): Promise<T>;
  rejectIfDisabledResponse(response: Response): Promise<void>;
  errorCode: "DOWNLOADS_DISABLED";
  errorMessage: string;
};
export default access;
