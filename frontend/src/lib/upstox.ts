import { prisma } from "@/lib/prisma";

function readConfiguredToken() {
  const token =
    process.env.UPSTOX_ANALYTICS_TOKEN ||
    process.env.UPSTOX_ACCESS_TOKEN ||
    null;

  return token?.trim() || null;
}

export async function getUpstoxAccessToken() {
  const configuredToken = readConfiguredToken();
  if (configuredToken) {
    return configuredToken;
  }

  const latest = await prisma.upstoxSession.findFirst({
    orderBy: { createdAt: "desc" }
  });

  return latest?.accessToken || null;
}
