import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const UPSTOX_API = "https://api.upstox.com/v2";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const code = body?.code;
  if (!code) {
    return NextResponse.json({ error: "Missing code" }, { status: 400 });
  }

  const clientId = process.env.UPSTOX_CLIENT_ID;
  const clientSecret = process.env.UPSTOX_CLIENT_SECRET;
  const redirectUri = process.env.UPSTOX_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    return NextResponse.json(
      { error: "Missing UPSTOX_CLIENT_ID, UPSTOX_CLIENT_SECRET, or UPSTOX_REDIRECT_URI" },
      { status: 400 }
    );
  }

  const form = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: "authorization_code"
  });

  const res = await fetch(`${UPSTOX_API}/login/authorization/token`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Api-Version": "2.0",
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: form
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return NextResponse.json(
      { error: data?.message || "Upstox token exchange failed", details: data },
      { status: 502 }
    );
  }

  const accessToken = data?.access_token;
  if (!accessToken) {
    return NextResponse.json(
      { error: "No access_token in response" },
      { status: 502 }
    );
  }

  await prisma.upstoxSession.create({
    data: { accessToken }
  });

  return NextResponse.json({ success: true });
}
