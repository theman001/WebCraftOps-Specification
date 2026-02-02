import type { LuckPermsAdapter, PermissionAdapter, PlayerIdentity } from "./adapters";

export type PermissionServiceOptions = {
  permissionAdapter: PermissionAdapter;
  luckPermsAdapter?: LuckPermsAdapter;
};

// Bridge 권한 체크 흐름을 단일 서비스로 통합
export const createPermissionService = (options: PermissionServiceOptions) => {
  const { permissionAdapter, luckPermsAdapter } = options;

  return {
    async hasPermission(player: PlayerIdentity, node: string) {
      if (luckPermsAdapter) {
        return luckPermsAdapter.hasPermission(player, node);
      }
      return permissionAdapter.hasPermission(player, node);
    },
    async isOperator(player: PlayerIdentity) {
      if (luckPermsAdapter) {
        return luckPermsAdapter.isOperator(player);
      }
      return permissionAdapter.isOperator(player);
    },
  };
};
