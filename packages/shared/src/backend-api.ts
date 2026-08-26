// Backend API 계약 정의

export type ServerProfile = {
  id: string;
  name: string;
  bridgeUrl: string;
  pinned: boolean;
  lastConnectedAt?: string;
};

