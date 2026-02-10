import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const UPSTOX_API = "https://api.upstox.com/v2";

export async function GET(req: Request) {
  const latest = await prisma.upstoxSession.findFirst({
    orderBy: { createdAt: "desc" }
  });
  if (!latest?.accessToken) {
    return NextResponse.json(
      { error: "No access token found. Please login via /upstox/login." },
      { status: 401 }
    );
  }

  const { searchParams } = new URL(req.url);
  const keys = searchParams.get("keys");
  if (!keys) {
    return NextResponse.json(
      { error: "Missing keys param. Example: ?keys=NSE_INDEX|Nifty 50,NSE_INDEX|India VIX" },
      { status: 400 }
    );
  }

  const url = new URL(`${UPSTOX_API}/market-quote/ltp`);
  url.searchParams.set("instrument_key", keys);
  const res = await fetch(url.toString(), {
    headers: {
      Accept: "application/json",
      "Api-Version": "2.0",
      Authorization: `Bearer ${latest.accessToken}`
    }
  });
  const data = await res.json().catch(() => ({}));
  return NextResponse.json({ ok: res.ok, data });
}
