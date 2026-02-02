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
        try {
          return await luckPermsAdapter.hasPermission(player, node);
        } catch {
          return permissionAdapter.hasPermission(player, node);
        }
      }
      return permissionAdapter.hasPermission(player, node);
    },
    async isOperator(player: PlayerIdentity) {
      if (luckPermsAdapter) {
        try {
          return await luckPermsAdapter.isOperator(player);
        } catch {
          return permissionAdapter.isOperator(player);
        }
      }
      return permissionAdapter.isOperator(player);
    },
  };
};
