import { getTeamModuleAccess } from '@/lib/modules/module-access';

async function main() {
  const access = await getTeamModuleAccess(94);
  console.log(JSON.stringify({
    isTeamAccessActive: access.isTeamAccessActive,
    isBranchesModuleActive: access.isBranchesModuleActive,
    isConnectChannelsModuleActive: access.isConnectChannelsModuleActive,
    isBranchesRuntimeActive: (access as any).isBranchesRuntimeActive,
    activeChannelModuleKeys: (access as any).activeChannelModuleKeys,
    isWebChatModuleActive: (access as any).isWebChatModuleActive,
    isAnyOmnichannelChannelActive: (access as any).isAnyOmnichannelChannelActive,
  }, null, 1));
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
