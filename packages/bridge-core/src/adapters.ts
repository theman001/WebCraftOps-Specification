// BridgeCore용 어댑터 인터페이스 정의

export type PlayerIdentity = {
  uuid: string;
  name: string;
};

export type WorldDescriptor = {
  id: string;
  name: string;
  dimension: string;
};

export interface PermissionAdapter {
  // 사용자 권한 여부를 확인한다.
  hasPermission(player: PlayerIdentity, node: string): Promise<boolean>;

  // OP 권한 여부를 확인한다.
  isOperator(player: PlayerIdentity): Promise<boolean>;
}

export interface RegistryAdapter {
  // 블록 레지스트리 덤프를 반환한다.
  getRegistryDump(): Promise<unknown>;
}

export interface WorldAccessAdapter {
  // 월드 목록을 반환한다.
  listWorlds(): Promise<WorldDescriptor[]>;
}
