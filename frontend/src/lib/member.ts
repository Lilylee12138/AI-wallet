import { ethers } from "ethers";

/**
 * Stable DAO memberId derived from connected EOA address.
 * Avoid relying on IdentityFacet.currentMemberId() which may be uninitialized / inconsistent.
 */
export async function getStableMemberId(
  provider: ethers.providers.Web3Provider
): Promise<{ eoa: string; memberId: string }> {
  const signer = provider.getSigner();
  const eoa = await signer.getAddress();
  const memberId = ethers.utils.hexZeroPad(eoa, 32);
  return { eoa, memberId };
}
